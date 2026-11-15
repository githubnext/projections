//! Writing a revision out to a temporary directory: a commit's exact blobs, or
//! a copy of the working tree, for fresh workspaces and container isolation.

use std::{collections::BTreeSet, fs, io::ErrorKind, path::Path};

use anyhow::{Context, Result, ensure};
use serde_json::json;

use super::{Listing, names, pathspec, read::batch_contents, skip_nested};
use crate::runtime::{
    MAX_BYTES, MAX_FILES, Runner, read_regular,
    revision::{Revision, Storage, mode, safe_path, windows_symlink, write_entry},
};

const STATUS: [&str; 4] = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];

impl Runner {
    /// Writes a whole revision out to a temporary directory: a commit's exact
    /// blobs, or a copy of the working tree. Only fresh workspaces and container
    /// isolation need one.
    fn materialize_reference(&self, reference: &str) -> Result<Revision> {
        self.materialize_paths(reference, None)
    }

    /// [`Runner::materialize_reference`], only the files under `paths`.
    pub(in crate::runtime) fn materialize_paths(&self, reference: &str, paths: Option<&[String]>) -> Result<Revision> {
        let repository = self.repository_root()?;
        let pathspec = pathspec(paths)?;
        let (working, commit) = self.revision_commit(&repository, reference)?;
        let temporary = tempfile::Builder::new().prefix("projections-native-").tempdir()?;
        let status = if working {
            self.git(&repository, &STATUS, None, 16 * 1024 * 1024)?
        } else {
            Vec::new()
        };
        let mut listing = Listing::default();
        if working {
            self.copy_working(&repository, &pathspec, temporary.path(), &mut listing)?;
            ensure!(
                status == self.git(&repository, &STATUS, None, 16 * 1024 * 1024)? && commit == self.resolve(&repository, "HEAD")?,
                "Working tree changed during capture"
            );
        } else {
            self.copy_commit(&repository, &commit, &pathspec, temporary.path(), &mut listing)?;
        }
        listing.skipped.sort();
        listing.files.sort();
        let tree = if working { None } else { Some(self.tree(&repository, &commit)?) };
        Ok(listing.revision(
            Storage::Temporary(temporary),
            json!({"kind":if working {"working-tree"} else {"commit"},
            "ref":if working {"working-tree"} else {&commit},"commit":commit,"dirty":!status.is_empty()}),
            tree,
        ))
    }

    /// Copies the working tree's files that aren't ignored to `target`.
    fn copy_working(&self, repository: &Path, pathspec: &[&str], target: &Path, listing: &mut Listing) -> Result<()> {
        let mut arguments = vec![
            "--literal-pathspecs",
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ];
        arguments.extend(pathspec);
        let paths = self.git(repository, &arguments, None, 16 * 1024 * 1024)?;
        let names: BTreeSet<_> = names(&paths)?.collect();
        too_large(names.len() <= MAX_FILES, || format!("{MAX_FILES} files"))?;
        let mut total: usize = 0;
        for filename in names {
            self.check_cancelled()?;
            if skip_nested(filename, &mut listing.skipped)? {
                continue;
            }
            safe_path(filename)?;
            if parent_missing(repository, filename)? {
                continue;
            }
            let source = repository.join(filename);
            let before = match fs::symlink_metadata(&source) {
                Ok(value) => value,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            if !before.is_file() && !before.is_symlink() {
                // A submodule's checkout, a FIFO or another special entry.
                listing.skipped.push(filename.to_owned());
                continue;
            }
            total = total
                .checked_add(usize::try_from(before.len())?)
                .context("Working-tree capture size overflow")?;
            too_large(total <= copy_limit(), copy_limit_text)?;
            let bytes = read_unchanged(&source, &before, filename)?;
            if windows_symlink(mode(&before)) {
                listing.skipped.push(filename.to_owned());
                continue;
            }
            write_entry(target, filename, &bytes, mode(&before))?;
            listing.add(filename, mode(&before), None);
        }
        Ok(())
    }

    /// Writes a commit's blobs to `target`, read from Git in one batch.
    fn copy_commit(&self, repository: &Path, commit: &str, pathspec: &[&str], target: &Path, listing: &mut Listing) -> Result<()> {
        let (listed, skipped) = self.tree_entries(repository, commit, pathspec, 16 * 1024 * 1024)?;
        listing.skipped.extend(skipped);
        too_large(listed.len() <= MAX_FILES, || format!("{MAX_FILES} files"))?;
        if listed.is_empty() {
            return Ok(());
        }
        let objects: Vec<&str> = listed.iter().map(|entry| entry.object.as_str()).collect();
        let input = objects.join("\n") + "\n";
        let mut total: usize = 0;
        self.blob_sizes(repository, &input, &objects, |size| {
            total = total.checked_add(size).context("Revision size overflow")?;
            too_large(total <= copy_limit(), copy_limit_text)?;
            Ok(())
        })?;
        let output = self.git(
            repository,
            &["cat-file", "--batch"],
            Some(input.as_bytes()),
            total + listed.len() * 128,
        )?;
        let (contents, end) = batch_contents(&output, &objects)?;
        for (entry, bytes) in listed.iter().zip(contents) {
            self.check_cancelled()?;
            if windows_symlink(&entry.mode) {
                listing.skipped.push(entry.filename.clone());
            } else {
                write_entry(target, &entry.filename, bytes, &entry.mode)?;
                listing.add(&entry.filename, &entry.mode, Some(entry.object.clone()));
            }
        }
        ensure!(end == output.len(), "Trailing Git object bytes");
        Ok(())
    }

    /// [`Runner::materialize`], or, when the whole revision is too large to
    /// copy, only `paths` (a projection's scope and its own files), saying so.
    pub(in crate::runtime) fn materialize_within(
        &self,
        revision: &Revision,
        paths: Option<&[String]>,
    ) -> Result<(Revision, Option<String>)> {
        match self.materialize(revision) {
            Err(error) if error.chain().any(|cause| cause.is::<TooLarge>()) => {
                let Some(paths) = paths else {
                    return Err(error);
                };
                let reference = match revision.repository["kind"].as_str() {
                    Some("commit") => revision.repository["commit"].as_str().unwrap_or_default().to_owned(),
                    _ => "working-tree".to_owned(),
                };
                let copy = self.materialize_paths(&reference, Some(paths))?;
                let note = format!(
                    "The revision is too large to copy whole ({}), so only the projection's scope and its own files were copied: {}.",
                    error
                        .chain()
                        .find_map(|cause| cause.downcast_ref::<TooLarge>())
                        .map_or("", |large| large.0.as_str()),
                    paths.join(", ")
                );
                Ok((copy, Some(note)))
            }
            other => other.map(|copy| (copy, None)),
        }
    }

    /// Writes a revision out to a temporary directory: a fresh workspace, and
    /// what container isolation mounts.
    pub(in crate::runtime) fn materialize(&self, revision: &Revision) -> Result<Revision> {
        match &revision.storage {
            Storage::Temporary(_) => revision.copy(),
            Storage::InPlace(_) => self.materialize_reference("working-tree"),
            Storage::Objects => self.materialize_reference(revision.repository["commit"].as_str().unwrap_or("")),
        }
    }
}

/// Overrides the cap on a revision copied whole, in bytes.
pub const COPY_LIMIT_VARIABLE: &str = "PROJECTIONS_MAX_COPY_BYTES";

/// The most bytes a whole revision may copy: 256 MiB, or `PROJECTIONS_MAX_COPY_BYTES`.
fn copy_limit() -> usize {
    std::env::var(COPY_LIMIT_VARIABLE)
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|limit| *limit > 0)
        .unwrap_or(MAX_BYTES)
}

fn copy_limit_text() -> String {
    let limit = copy_limit();
    if limit.is_multiple_of(1024 * 1024) {
        format!("{} MiB", limit / (1024 * 1024))
    } else {
        format!("{limit} bytes")
    }
}

/// A revision too large to copy whole: more than the limit it names.
#[derive(Debug)]
pub struct TooLarge(pub String);

impl std::fmt::Display for TooLarge {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "Revision exceeds {}, too large to copy. List the files the projection reads in its definition's execution.scope, so only they are copied, or raise {COPY_LIMIT_VARIABLE}",
            self.0
        )
    }
}

impl std::error::Error for TooLarge {}

fn too_large(within: bool, limit: impl FnOnce() -> String) -> Result<()> {
    if within { Ok(()) } else { Err(TooLarge(limit()).into()) }
}

/// Whether a working file's parent directory is missing; a symlink on the way is an error.
fn parent_missing(repository: &Path, filename: &str) -> Result<bool> {
    let mut parent = repository.to_path_buf();
    for segment in filename.split('/').take(filename.split('/').count() - 1) {
        parent.push(segment);
        let metadata = match fs::symlink_metadata(&parent) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == ErrorKind::NotFound || error.kind() == ErrorKind::NotADirectory => {
                return Ok(true);
            }
            Err(error) => return Err(error.into()),
        };
        ensure!(metadata.is_dir() && !metadata.is_symlink(), "Working path traverses a symlink");
    }
    Ok(false)
}

/// A working file's bytes (a symlink's target), checked unchanged since `before`.
fn read_unchanged(source: &Path, before: &fs::Metadata, filename: &str) -> Result<Vec<u8>> {
    let bytes = if before.is_symlink() {
        fs::read_link(source)?
            .to_str()
            .context("Symlink target is not UTF8")?
            .as_bytes()
            .to_vec()
    } else {
        read_regular(source, MAX_BYTES)?
    };
    let after = fs::symlink_metadata(source)?;
    ensure!(
        before.len() == after.len() && before.modified()? == after.modified()? && bytes.len() as u64 == before.len(),
        "Working file changed during capture: {filename}"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        ensure!(
            before.ino() == after.ino() && before.ctime() == after.ctime() && before.ctime_nsec() == after.ctime_nsec(),
            "Working file replaced during capture"
        );
    }
    Ok(bytes)
}
