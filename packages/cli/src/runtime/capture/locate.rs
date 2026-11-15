//! Locating a revision's files without copying them: the working tree in place,
//! a commit from Git objects.

use std::{
    collections::{BTreeSet, HashMap},
    path::Path,
};

use anyhow::{Context, Result};
use serde_json::json;

use super::{Listing, names, pathspec, skip_nested};
use crate::runtime::{
    Runner,
    revision::{Revision, Storage, listed_entry, mode, safe_path, windows_symlink},
};

impl Runner {
    pub(in crate::runtime) fn capture(&self, reference: &str) -> Result<Revision> {
        self.capture_paths(reference, None)
    }

    /// Locates a revision, or only the files under `paths` of it, without
    /// copying anything: the working tree is read in place and a commit from Git
    /// objects. [`Runner::materialize`] writes one out when a toolchain needs it.
    pub(in crate::runtime) fn capture_paths(&self, reference: &str, paths: Option<&[String]>) -> Result<Revision> {
        let repository = self.repository_root()?;
        let pathspec = pathspec(paths)?;
        let (working, commit) = self.revision_commit(&repository, reference)?;
        if working {
            let status = self.git(
                &repository,
                &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                None,
                16 * 1024 * 1024,
            )?;
            let listing = self.working_listing(&repository, &pathspec)?;
            return Ok(listing.revision(
                Storage::InPlace(repository),
                json!({"kind":"working-tree","ref":"working-tree","commit":commit,"dirty":!status.is_empty()}),
                None,
            ));
        }
        let (listed, skipped) = self.tree_entries(&repository, &commit, &pathspec, 64 * 1024 * 1024)?;
        let mut listing = Listing {
            skipped,
            ..Listing::default()
        };
        for entry in listed {
            if windows_symlink(&entry.mode) {
                listing.skipped.push(entry.filename);
            } else {
                listing.add(&entry.filename, &entry.mode, Some(entry.object));
            }
        }
        listing.files.sort();
        listing.skipped.sort();
        let tree = Some(self.tree(&repository, &commit)?);
        Ok(listing.revision(
            Storage::Objects,
            json!({"kind":"commit","ref":commit,"commit":commit,"dirty":false}),
            tree,
        ))
    }

    /// The working tree's files: tracked files with their index modes (Git
    /// itself reports a file beyond a symlinked directory as deleted), less
    /// deleted ones; then untracked files that aren't ignored, checked on disk.
    fn working_listing(&self, repository: &Path, pathspec: &[&str]) -> Result<Listing> {
        let list = |options: &[&str]| -> Result<Vec<u8>> {
            let mut arguments = vec!["--literal-pathspecs", "ls-files", "-z"];
            arguments.extend(options);
            arguments.extend(pathspec);
            self.git(repository, &arguments, None, 64 * 1024 * 1024)
        };
        let mut listing = Listing::default();
        let deleted = list(&["--deleted"])?;
        let deleted: BTreeSet<&str> = names(&deleted)?.collect();
        let tracked = list(&["--cached", "--stage"])?;
        for line in names(&tracked)? {
            let (record, filename) = line.split_once('\t').context("Invalid Git index entry")?;
            let mode = record.split(' ').next().unwrap_or_default();
            if deleted.contains(filename) || listing.entries.contains_key(filename) {
                continue;
            }
            safe_path(filename)?;
            if !["100644", "100755", "120000"].contains(&mode) || windows_symlink(mode) {
                // A submodule's gitlink or another special entry.
                listing.skipped.push(filename.to_owned());
                continue;
            }
            listing.add(filename, mode, None);
        }
        let untracked = list(&["--others", "--exclude-standard"])?;
        // Directories already checked to be real directories, or missing.
        let mut directories = HashMap::new();
        for filename in names(&untracked)? {
            self.check_cancelled()?;
            if skip_nested(filename, &mut listing.skipped)? {
                continue;
            }
            safe_path(filename)?;
            let Some(metadata) = listed_entry(repository, filename, &mut directories)? else {
                continue;
            };
            if (!metadata.is_file() && !metadata.is_symlink()) || windows_symlink(mode(&metadata)) {
                listing.skipped.push(filename.to_owned());
                continue;
            }
            listing.add(filename, mode(&metadata), None);
        }
        listing.files.sort();
        listing.files.dedup();
        listing.skipped.sort();
        Ok(listing)
    }
}
