//! Replacing a file with a staged temporary one in a single rename, so a
//! reader sees the old content or the new, never a partial write.
//!
//! [`tempfile::NamedTempFile::persist`] renames with `MoveFileExW`, which on
//! Windows refuses to replace a file any process has open, even a reader that
//! allows deletion, with "Access is denied". Files that are replaced are read
//! all the time: the service polls the working tree's definitions (reading
//! them, and running `git status` and `git add` over them), as do editors and
//! other processes. [`std::fs::rename`] retries that refusal with POSIX
//! semantics, which replace the name while open readers keep the old file.

use std::{io, path::Path};

use tempfile::NamedTempFile;

/// Moves `staged` over `path`. The staged file is closed first, and removed
/// when the rename fails.
pub fn replace(staged: NamedTempFile, path: &Path) -> io::Result<()> {
    // Closes the handle and clears Windows' temporary attribute; from here on
    // the staged file is ours to remove.
    let staged = staged.into_temp_path().keep().map_err(|error| error.error)?;
    std::fs::rename(&staged, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&staged);
    })
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};

    use super::*;

    #[test]
    fn replaces_a_file_another_handle_is_reading() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("definition.json");
        std::fs::write(&path, "before").unwrap();
        let mut reader = std::fs::File::open(&path).unwrap();
        let mut staged = NamedTempFile::new_in(directory.path()).unwrap();
        staged.write_all(b"after").unwrap();
        replace(staged, &path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "after");
        // The open reader keeps the file it opened.
        let mut read = String::new();
        reader.read_to_string(&mut read).unwrap();
        assert_eq!(read, "before");
        drop(reader);
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_failed_replace_leaves_no_staged_file() {
        let directory = tempfile::tempdir().unwrap();
        let mut staged = NamedTempFile::new_in(directory.path()).unwrap();
        staged.write_all(b"after").unwrap();
        // A directory with an entry can't be replaced by a file.
        let target = directory.path().join("occupied");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("entry"), "").unwrap();
        assert!(replace(staged, &target).is_err());
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
