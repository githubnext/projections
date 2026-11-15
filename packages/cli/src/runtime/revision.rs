//! Revisions as the runner holds them (in place, materialized or as Git
//! objects) and safe handling of the paths and files written for them.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use serde_json::Value;
use tempfile::TempDir;

use super::MAX_BYTES;
pub use super::entries::read_regular;
pub(super) use super::entries::{listed_entry, mode, safe_path, windows_symlink, working_entry, write_entry};

/// Where a revision's bytes are.
pub(super) enum Storage {
    /// A temporary materialization, removed on drop.
    Temporary(TempDir),
    /// The user's checkout, read in place (the working tree, or a commit that
    /// is its clean `HEAD`).
    InPlace(PathBuf),
    /// Git's object store only; nothing on disk.
    Objects,
}

pub(super) struct Revision {
    pub(super) storage: Storage,
    /// Every file, sorted.
    pub(super) files: Vec<String>,
    /// Each file's Git mode and, read from Git objects, its blob.
    pub(super) entries: BTreeMap<String, (String, Option<String>)>,
    /// Submodule gitlinks and other special entries that were not materialized,
    /// as `git archive` omits them.
    pub(super) skipped: Vec<String>,
    pub(super) repository: Value,
    /// The examined Git tree, for a commit.
    pub(super) tree: Option<String>,
    /// The working tree's identity, once taken ([`Runner::identity`]).
    pub(super) identity: std::sync::OnceLock<String>,
}

/// At most this many skipped paths are named in a limitation or notice.
const MAX_NAMED_SKIPPED: usize = 10;

/// Names skipped paths, capped at [`MAX_NAMED_SKIPPED`].
pub(super) fn named_paths(paths: &[String]) -> String {
    let mut named = paths.iter().take(MAX_NAMED_SKIPPED).cloned().collect::<Vec<_>>().join(", ");
    if paths.len() > MAX_NAMED_SKIPPED {
        named.push_str(&format!(" and {} more", paths.len() - MAX_NAMED_SKIPPED));
    }
    named
}

impl Revision {
    /// The directory holding the revision, when it is on disk.
    pub(super) fn directory(&self) -> Option<&Path> {
        match &self.storage {
            Storage::Temporary(temporary) => Some(temporary.path()),
            Storage::InPlace(root) => Some(root),
            Storage::Objects => None,
        }
    }

    /// The directory holding the revision, which callers have put on disk.
    pub(super) fn root(&self) -> &Path {
        self.directory().expect("the revision is materialized before its directory is used")
    }

    pub(super) fn is_commit(&self) -> bool {
        self.repository["kind"] == "commit"
    }

    /// Whether `path` is a regular file (not a symlink) of the revision.
    pub(super) fn is_regular(&self, path: &str) -> bool {
        self.entries.get(path).is_some_and(|(mode, _)| mode != "120000")
    }

    /// The skipped submodule or special entry that contains or is `path`.
    fn skipped_containing(&self, path: &str) -> Option<&str> {
        let path = path.trim_start_matches("./");
        self.skipped
            .iter()
            .find(|skipped| path == skipped.as_str() || path.starts_with(&format!("{skipped}/")))
            .map(String::as_str)
    }

    /// The limitation a materialization of this revision records.
    pub(super) fn materialized_limitation(&self) -> &'static str {
        if self.is_commit() {
            "Historical input is materialized from immutable raw Git blobs without checkout filters."
        } else {
            "Working-tree capture excludes ignored/generated inputs and is not an atomic filesystem transaction."
        }
    }

    /// The skipped submodules and special entries a projection reading
    /// `scope` (everything, when `None`) could have read.
    pub(super) fn skipped_within(&self, scope: Option<&[String]>) -> Vec<String> {
        self.skipped
            .iter()
            .filter(|skipped| {
                scope.is_none_or(|scope| {
                    scope.iter().any(|path| {
                        let path = path.trim_end_matches('/');
                        path == skipped.as_str() || skipped.starts_with(&format!("{path}/")) || path.starts_with(&format!("{skipped}/"))
                    })
                })
            })
            .cloned()
            .collect()
    }

    /// The limitation recorded when entries within `scope` were skipped.
    pub(super) fn skipped_limitation(&self, scope: Option<&[String]>) -> Option<String> {
        let skipped = self.skipped_within(scope);
        (!skipped.is_empty()).then(|| {
            format!(
                "{} submodule or special {} not materialized, as git archive omits them, so extractors did not see {}: {}.",
                skipped.len(),
                if skipped.len() == 1 { "entry was" } else { "entries were" },
                if skipped.len() == 1 { "it" } else { "them" },
                named_paths(&skipped)
            )
        })
    }

    /// Fails clearly when a path the projection explicitly requires lies in a skipped entry.
    pub(super) fn require_materialized(&self, path: &str, purpose: &str) -> Result<()> {
        if let Some(skipped) = self.skipped_containing(path) {
            bail!(
                "{purpose} {path} is inside {skipped}, a submodule or special entry that Projections does not materialize in {}",
                self.repository["ref"]
            );
        }
        Ok(())
    }

    pub(super) fn copy(&self) -> Result<Self> {
        if !matches!(self.storage, Storage::Temporary(_)) {
            return Ok(Self {
                storage: match &self.storage {
                    Storage::InPlace(root) => Storage::InPlace(root.clone()),
                    _ => Storage::Objects,
                },
                files: self.files.clone(),
                entries: self.entries.clone(),
                skipped: self.skipped.clone(),
                repository: self.repository.clone(),
                tree: self.tree.clone(),
                identity: self.identity.clone(),
            });
        }
        let temporary = tempfile::Builder::new().prefix("projections-native-").tempdir()?;
        for filename in &self.files {
            let source = self.root().join(filename);
            let metadata = fs::symlink_metadata(&source)?;
            let bytes = if metadata.is_symlink() {
                fs::read_link(&source)?.to_str().context("Non-UTF8 symlink")?.as_bytes().to_vec()
            } else {
                read_regular(&source, MAX_BYTES)?
            };
            write_entry(temporary.path(), filename, &bytes, mode(&metadata))?;
        }
        Ok(Self {
            storage: Storage::Temporary(temporary),
            files: self.files.clone(),
            entries: self.entries.clone(),
            skipped: self.skipped.clone(),
            repository: self.repository.clone(),
            tree: self.tree.clone(),
            identity: self.identity.clone(),
        })
    }
}
