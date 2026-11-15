//! Reading a revision's files: from the working tree, or as blobs from Git's
//! object store in one batch.

use std::{fs, path::Path};

use anyhow::{Context, Result, bail, ensure};

use crate::runtime::{
    MAX_BYTES, Runner, read_regular,
    revision::{Revision, safe_path, working_entry},
};

impl Runner {
    /// The bytes of a regular file of a revision (never through a symlink), at
    /// most `maximum`.
    pub(in crate::runtime) fn read_file(&self, revision: &Revision, path: &str, maximum: usize) -> Result<Vec<u8>> {
        Ok(self
            .read_files(revision, std::slice::from_ref(&path.to_owned()), maximum)?
            .remove(0))
    }

    /// The bytes of several regular files of a revision, each at most `maximum`,
    /// read from Git in one batch.
    pub(in crate::runtime) fn read_files(&self, revision: &Revision, paths: &[String], maximum: usize) -> Result<Vec<Vec<u8>>> {
        for path in paths {
            safe_path(path)?;
        }
        if let Some(root) = revision.directory() {
            return paths
                .iter()
                .map(|path| {
                    working_entry(root, path)?.with_context(|| format!("{path} does not exist in {}", revision.repository["ref"]))?;
                    read_regular(&root.join(path), maximum).with_context(|| format!("Cannot read {path}"))
                })
                .collect();
        }
        let objects = paths
            .iter()
            .map(|path| match revision.entries.get(path) {
                Some((mode, Some(object))) if mode != "120000" => Ok(object.as_str()),
                Some(_) => bail!("{path} must be a regular file, not a symlink"),
                None => bail!("{path} does not exist in {}", revision.repository["ref"]),
            })
            .collect::<Result<Vec<_>>>()?;
        self.blobs(&objects, maximum)
    }

    /// The bytes of files of a revision as Git stores them: a symlink's are its
    /// target. For digests.
    pub(in crate::runtime) fn read_entries(&self, revision: &Revision, paths: &[String]) -> Result<Vec<Vec<u8>>> {
        if let Some(root) = revision.directory() {
            return paths
                .iter()
                .map(|path| {
                    let path = root.join(path);
                    if fs::symlink_metadata(&path)?.is_symlink() {
                        Ok(fs::read_link(&path)?.to_str().context("Non-UTF8 symlink")?.as_bytes().to_vec())
                    } else {
                        read_regular(&path, MAX_BYTES)
                    }
                })
                .collect();
        }
        let objects = paths
            .iter()
            .map(|path| match revision.entries.get(path) {
                Some((_, Some(object))) => Ok(object.as_str()),
                _ => bail!("{path} does not exist in {}", revision.repository["ref"]),
            })
            .collect::<Result<Vec<_>>>()?;
        self.blobs(&objects, MAX_BYTES)
    }

    /// Blobs from the repository's object store, each at most `maximum` bytes.
    pub(in crate::runtime) fn blobs(&self, objects: &[&str], maximum: usize) -> Result<Vec<Vec<u8>>> {
        if objects.is_empty() {
            return Ok(Vec::new());
        }
        let repository = self.repository_root()?;
        let input = objects.join("\n") + "\n";
        let mut total: usize = 0;
        self.blob_sizes(&repository, &input, objects, |size| {
            ensure!(size <= maximum, "A file exceeds {maximum} bytes");
            total = total.checked_add(size).context("Blob size overflow")?;
            Ok(())
        })?;
        ensure!(total <= MAX_BYTES, "Files exceed 256 MiB");
        let output = self.git(
            &repository,
            &["cat-file", "--batch"],
            Some(input.as_bytes()),
            total + objects.len() * 128,
        )?;
        let (contents, _) = batch_contents(&output, objects)?;
        Ok(contents.into_iter().map(<[u8]>::to_vec).collect())
    }

    /// Checks `git cat-file --batch-check` metadata for `objects` (`input`, one
    /// per line), each a blob, and hands each one's size to `each`.
    pub(super) fn blob_sizes(
        &self,
        repository: &Path,
        input: &str,
        objects: &[&str],
        mut each: impl FnMut(usize) -> Result<()>,
    ) -> Result<()> {
        let metadata = self.git(
            repository,
            &["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
            Some(input.as_bytes()),
            16 * 1024 * 1024,
        )?;
        let sizes: Vec<_> = std::str::from_utf8(&metadata)?.lines().collect();
        ensure!(sizes.len() == objects.len(), "Incomplete Git blob metadata");
        for (line, object) in sizes.iter().zip(objects) {
            let parts: Vec<_> = line.split(' ').collect();
            ensure!(
                parts.len() == 3 && parts[0] == *object && parts[1] == "blob",
                "Invalid Git blob metadata"
            );
            each(parts[2].parse::<usize>()?)?;
        }
        Ok(())
    }
}

/// The contents of `objects` in `git cat-file --batch` output, in order and
/// each header checked, and the offset where the last one ends.
pub(super) fn batch_contents<'a>(output: &'a [u8], objects: &[&str]) -> Result<(Vec<&'a [u8]>, usize)> {
    let mut cursor = 0;
    let mut contents = Vec::with_capacity(objects.len());
    for object in objects {
        let end = output[cursor..]
            .iter()
            .position(|byte| *byte == b'\n')
            .context("Truncated blob header")?
            + cursor;
        let header = std::str::from_utf8(&output[cursor..end])?;
        let parts: Vec<_> = header.split(' ').collect();
        ensure!(
            parts.len() == 3 && parts[0] == *object && parts[1] == "blob",
            "Git blob identity mismatch"
        );
        let size = parts[2].parse::<usize>()?;
        cursor = end + 1;
        ensure!(
            size <= output.len().saturating_sub(cursor) && output.get(cursor + size) == Some(&b'\n'),
            "Truncated Git blob"
        );
        contents.push(&output[cursor..cursor + size]);
        cursor += size + 1;
    }
    Ok((contents, cursor))
}
