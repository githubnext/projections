//! The files a revision is written to and read from: safe paths, modes and
//! entries that never follow a symlink out of the revision.

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Component, Path},
};

use anyhow::{Context, Result, bail, ensure};

/// The metadata of `filename` under `root`, without following symlinks;
/// `None` when it (or a parent) doesn't exist. Fails when a parent is a symlink.
pub(super) fn working_entry(root: &Path, filename: &str) -> Result<Option<fs::Metadata>> {
    let mut parent = root.to_path_buf();
    let segments: Vec<_> = filename.split('/').collect();
    for segment in &segments[..segments.len() - 1] {
        parent.push(segment);
        let Some(metadata) = existing(&parent)? else {
            return Ok(None);
        };
        ensure!(
            metadata.is_dir() && !metadata.is_symlink(),
            "Working path traverses a symlink: {filename}"
        );
    }
    existing(&root.join(filename))
}

/// [`working_entry`], remembering which parent directories were checked
/// (`true`: a real directory; `false`: missing), for listing a whole tree.
pub(super) fn listed_entry(
    root: &Path,
    filename: &str,
    directories: &mut std::collections::HashMap<String, bool>,
) -> Result<Option<fs::Metadata>> {
    let mut end = 0;
    while let Some(offset) = filename[end..].find('/') {
        end += offset;
        let parent = &filename[..end];
        let present = match directories.get(parent) {
            Some(present) => *present,
            None => {
                let metadata = existing(&root.join(parent))?;
                if let Some(metadata) = &metadata {
                    ensure!(
                        metadata.is_dir() && !metadata.is_symlink(),
                        "Working path traverses a symlink: {filename}"
                    );
                }
                let present = metadata.is_some();
                directories.insert(parent.to_owned(), present);
                present
            }
        };
        if !present {
            return Ok(None);
        }
        end += 1;
    }
    existing(&root.join(filename))
}

/// The metadata of `path`, without following symlinks; `None` when it (or a
/// parent) doesn't exist.
fn existing(path: &Path) -> Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound || error.kind() == std::io::ErrorKind::NotADirectory => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn safe_path(filename: &str) -> Result<()> {
    ensure!(
        !filename.is_empty() && !filename.contains(['\\', '\0', ':']),
        "Unsafe repository path"
    );
    ensure!(
        Path::new(filename)
            .components()
            .all(|part| matches!(part, Component::Normal(value) if !value.eq_ignore_ascii_case(".git"))),
        "Unsafe repository path: {filename}"
    );
    ensure!(
        filename.split('/').all(|part| !part.is_empty() && part != "." && part != ".."),
        "Unsafe repository path: {filename}"
    );
    Ok(())
}

#[cfg(unix)]
pub(super) fn mode(metadata: &fs::Metadata) -> &'static str {
    use std::os::unix::fs::PermissionsExt;
    if metadata.is_symlink() {
        "120000"
    } else if metadata.permissions().mode() & 0o111 != 0 {
        "100755"
    } else {
        "100644"
    }
}

#[cfg(not(unix))]
pub(super) fn mode(metadata: &fs::Metadata) -> &'static str {
    if metadata.is_symlink() { "120000" } else { "100644" }
}

/// Creating symlinks on Windows requires Developer Mode or administrator rights, so
/// Windows skips them like other special entries rather than depending on either.
pub(super) fn windows_symlink(mode: &str) -> bool {
    cfg!(windows) && mode == "120000"
}

pub(super) fn write_entry(root: &Path, filename: &str, bytes: &[u8], mode: &str) -> Result<()> {
    safe_path(filename)?;
    let destination = root.join(filename);
    fs::create_dir_all(destination.parent().context("Missing parent")?)?;
    if mode == "120000" {
        let target = std::str::from_utf8(bytes)?;
        ensure!(
            !target.is_empty() && !target.contains(['\\', '\0']) && !Path::new(target).is_absolute(),
            "Unsafe symlink: {filename}"
        );
        let mut depth = filename.split('/').count() as isize - 1;
        for part in Path::new(target).components() {
            match part {
                Component::ParentDir => {
                    depth -= 1;
                    ensure!(depth >= 0, "Symlink escapes the revision: {filename}");
                }
                Component::Normal(_) => depth += 1,
                Component::CurDir => (),
                _ => bail!("Unsafe symlink target"),
            }
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, destination)?;
        #[cfg(not(unix))]
        bail!("Symlinks are materialized only on Unix: {filename}");
    } else {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(if mode == "100755" { 0o755 } else { 0o644 });
        }
        options.open(&destination)?.write_all(bytes)?;
    }
    Ok(())
}

pub fn read_regular(path: &Path, maximum: usize) -> Result<Vec<u8>> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    // Opens a symlink or junction itself, which then fails the regular-file check.
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path)?;
    ensure!(
        file.metadata()?.is_file() && file.metadata()?.len() <= maximum as u64,
        "Input must be a regular bounded file"
    );
    let mut bytes = Vec::new();
    file.take(maximum as u64 + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= maximum, "Input exceeded byte limit during read");
    Ok(bytes)
}
