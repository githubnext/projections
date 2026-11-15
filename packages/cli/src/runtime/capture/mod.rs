//! Locating revisions in Git and reading or materializing their files.

mod locate;
mod materialize;
mod read;

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, ensure};
use serde_json::Value;

use super::{
    Runner,
    revision::{Revision, Storage, safe_path},
};

/// A revision's files as Git (or the working tree) lists them.
#[derive(Default)]
struct Listing {
    files: Vec<String>,
    /// Each file's Git mode and, read from Git objects, its blob.
    entries: BTreeMap<String, (String, Option<String>)>,
    /// Submodule gitlinks and other special entries.
    skipped: Vec<String>,
}

impl Listing {
    fn add(&mut self, filename: &str, mode: &str, object: Option<String>) {
        self.entries.insert(filename.to_owned(), (mode.to_owned(), object));
        self.files.push(filename.to_owned());
    }

    fn revision(self, storage: Storage, repository: Value, tree: Option<String>) -> Revision {
        Revision {
            storage,
            files: self.files,
            entries: self.entries,
            skipped: self.skipped,
            repository,
            tree,
            identity: std::sync::OnceLock::new(),
        }
    }
}

/// A commit's file listed by `git ls-tree`: its mode, blob and path.
struct TreeEntry {
    mode: String,
    object: String,
    filename: String,
}

/// A `--`-led pathspec of `paths`, each checked to be safe; none for the whole revision.
fn pathspec(paths: Option<&[String]>) -> Result<Vec<&str>> {
    let Some(paths) = paths else {
        return Ok(Vec::new());
    };
    for path in paths {
        safe_path(path)?;
    }
    Ok(std::iter::once("--").chain(paths.iter().map(String::as_str)).collect())
}

/// The NUL-separated names or lines Git printed, without empty ones.
fn names(bytes: &[u8]) -> Result<impl Iterator<Item = &str>> {
    Ok(std::str::from_utf8(bytes)?.split('\0').filter(|name| !name.is_empty()))
}

/// Untracked nested repositories are listed as directories: skips one.
fn skip_nested(filename: &str, skipped: &mut Vec<String>) -> Result<bool> {
    let Some(directory) = filename.strip_suffix('/') else {
        return Ok(false);
    };
    safe_path(directory)?;
    skipped.push(directory.to_owned());
    Ok(true)
}

impl Runner {
    /// The repository's Git common directory, canonical: shared by its worktrees.
    pub fn common_directory(&self) -> Result<PathBuf> {
        let root = self.repository_root()?;
        let directory = PathBuf::from(self.git_text(&root, &["rev-parse", "--git-common-dir"])?);
        let directory = if directory.is_absolute() { directory } else { root.join(directory) };
        Ok(projections_extractor_sdk::canonical(&directory)?)
    }

    /// The Git tree a revision (a commit or ref) holds.
    pub fn tree(&self, root: &Path, reference: &str) -> Result<String> {
        Ok(self
            .git_text(
                root,
                &["rev-parse", "--verify", "--end-of-options", &format!("{reference}^{{tree}}")],
            )?
            .trim()
            .to_owned())
    }

    pub fn repository_root(&self) -> Result<PathBuf> {
        let root = projections_extractor_sdk::canonical(&self.repo)?;
        let bare = self.git_text(&root, &["rev-parse", "--is-bare-repository"])? == "true";
        let reported = self.git_text(&root, &["rev-parse", if bare { "--absolute-git-dir" } else { "--show-toplevel" }])?;
        ensure!(
            projections_extractor_sdk::canonical(Path::new(&reported))? == root,
            "Repository path must identify the Git root"
        );
        Ok(root)
    }

    pub fn resolve(&self, root: &Path, reference: &str) -> Result<String> {
        ensure!(
            !reference.is_empty() && reference.len() <= 1024 && !reference.contains('\0'),
            "Invalid Git revision"
        );
        let revision = format!("{reference}^{{commit}}");
        let commit = self
            .git_text(
                root,
                &["rev-parse", "--verify", "--end-of-options", &revision],
            )
            .with_context(|| {
                if reference == "HEAD" {
                    "This repository has no commits yet, and Projections records the commit every working tree is based on. Commit once (for example git commit --allow-empty -m Start), then retry".to_owned()
                } else {
                    format!("Unknown Git revision {reference}")
                }
            })?;
        ensure!(
            [40, 64].contains(&commit.len()) && commit.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
            "Expected immutable Git commit"
        );
        Ok(commit)
    }

    /// The working tree's Git tree hash: the tree `git add -A` would commit,
    /// written with a temporary index seeded from the real one, so Git rehashes
    /// only files whose stat information changed. The user's index and refs are
    /// untouched; changed files' blobs are written to the object store, as
    /// `git stash` would, and `git gc` collects them.
    pub fn working_tree(&self) -> Result<String> {
        let root = self.repository_root()?;
        let index = PathBuf::from(self.git_text(&root, &["rev-parse", "--git-path", "index"])?);
        let index = if index.is_absolute() { index } else { root.join(index) };
        let directory = tempfile::Builder::new().prefix("projections-index-").tempdir()?;
        let temporary = directory.path().join("index");
        if index.is_file() {
            fs::copy(&index, &temporary)?;
        }
        let environment = [("GIT_INDEX_FILE", temporary.to_str().context("Non-UTF-8 temporary path")?)];
        self.git_with(&root, &["add", "-A", "--", "."], None, 1024 * 1024, &environment)?;
        let tree = self.git_with(&root, &["write-tree"], None, 1024, &environment)?;
        Ok(String::from_utf8(tree)?.trim().to_owned())
    }

    /// Whether `reference` is the working tree, and the commit it is (or is based on).
    fn revision_commit(&self, repository: &Path, reference: &str) -> Result<(bool, String)> {
        let working = reference == "working-tree";
        ensure!(
            !working || self.git_text(repository, &["rev-parse", "--is-bare-repository"])? != "true",
            "Bare repository has no working tree"
        );
        let commit = self.resolve(repository, if working { "HEAD" } else { reference })?;
        Ok((working, commit))
    }

    /// A commit's regular files and symlinks under `pathspec`, from `git ls-tree`,
    /// and the submodule gitlinks and other special entries it skips.
    fn tree_entries(&self, repository: &Path, commit: &str, pathspec: &[&str], maximum: usize) -> Result<(Vec<TreeEntry>, Vec<String>)> {
        let mut arguments = vec!["--literal-pathspecs", "ls-tree", "-rz", "--full-tree", commit];
        arguments.extend(pathspec);
        let listed = self.git(repository, &arguments, None, maximum)?;
        let mut entries = Vec::new();
        let mut skipped = Vec::new();
        for line in names(&listed)? {
            let (record, filename) = line.split_once('\t').context("Invalid Git tree entry")?;
            let parts: Vec<_> = record.split(' ').collect();
            ensure!(parts.len() == 3, "Invalid Git tree entry");
            safe_path(filename)?;
            if !(parts[1] == "blob" && ["100644", "100755", "120000"].contains(&parts[0])) {
                // Submodule gitlinks (160000 commit) and other special entries.
                skipped.push(filename.to_owned());
                continue;
            }
            entries.push(TreeEntry {
                mode: parts[0].to_owned(),
                object: parts[2].to_owned(),
                filename: filename.to_owned(),
            });
        }
        Ok((entries, skipped))
    }
}
