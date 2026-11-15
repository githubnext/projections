//! Reading artifacts and documents from disk without following symlinks, and
//! their encodings.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail, ensure};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{parse, validate_comparison, validate_extraction};

pub const MAX_ARTIFACT_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_DOCUMENT_BYTES: usize = 32 * 1024 * 1024;

/// Standard padded base64, for bytes in JSON responses.
pub fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut text = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let value = chunk
            .iter()
            .enumerate()
            .fold(0u32, |value, (index, byte)| value | u32::from(*byte) << (16 - 8 * index));
        for index in 0..4 {
            if index <= chunk.len() {
                text.push(ALPHABET[(value >> (18 - 6 * index) & 63) as usize] as char);
            } else {
                text.push('=');
            }
        }
    }
    text
}

pub fn byte_sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn read_artifact(path: &Path, max_bytes: usize) -> Result<Vec<u8>> {
    filesystem::read_artifact(path, max_bytes)
}

pub fn read_document(path: &Path) -> Result<Value> {
    let bytes = read_artifact(path, MAX_DOCUMENT_BYTES)?;
    let value = parse(std::str::from_utf8(&bytes).context("Document must be valid UTF-8")?)?;
    match value["format"].as_str() {
        Some("projections.extraction") => {
            ensure!(bytes.len() <= MAX_ARTIFACT_BYTES, "Extraction artifact exceeds byte limit");
            validate_extraction(&value)
        }
        Some("projections.comparison") => validate_comparison(&value),
        None if value.get("protocolVersion").is_some() && value.get("entities").is_some() => bail!(
            "{} is extractor output, not a saved document: name its projection with -p ID, whose working-tree definition then applies to it",
            path.display()
        ),
        _ => bail!("Unsupported document format: expected a projections.extraction or projections.comparison document"),
    }
}

#[cfg(unix)]
mod filesystem {
    use std::{
        ffi::{CString, OsStr},
        fs::File,
        io::Read,
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::ffi::OsStrExt,
        },
    };

    use super::*;

    fn cstring(value: &OsStr) -> Result<CString> {
        CString::new(value.as_bytes()).context("Artifact path contains NUL")
    }

    fn open_at(parent: &File, name: &OsStr, flags: libc::c_int, mode: libc::mode_t) -> Result<File> {
        let name = cstring(name)?;
        let descriptor = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                flags | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
                mode as libc::c_uint,
            )
        };
        if descriptor < 0 {
            return Err(std::io::Error::last_os_error()).context("Artifact paths must not traverse symlinks; failed to open file");
        }
        Ok(unsafe { File::from_raw_fd(descriptor) })
    }

    fn canonical_parent(path: &Path) -> Result<(PathBuf, std::ffi::OsString)> {
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()?.join(path)
        };
        let name = path.file_name().context("Artifact path must name a file or new directory")?;
        let parent = path.parent().context("Artifact path must have a parent")?.canonicalize()?;
        Ok((parent, name.to_owned()))
    }

    fn directory(path: &Path) -> Result<File> {
        let path = cstring(path.as_os_str())?;
        let descriptor = unsafe {
            libc::open(
                path.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if descriptor < 0 {
            return Err(std::io::Error::last_os_error()).context("Failed to open artifact directory");
        }
        Ok(unsafe { File::from_raw_fd(descriptor) })
    }

    fn read(mut file: File, max_bytes: usize) -> Result<Vec<u8>> {
        let metadata = file.metadata()?;
        ensure!(
            metadata.is_file() && metadata.len() <= max_bytes as u64,
            "Artifact must be a regular file <= {max_bytes} bytes"
        );
        let mut result = Vec::with_capacity((metadata.len() as usize).min(64 * 1024));
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            ensure!(
                count <= max_bytes.saturating_sub(result.len()),
                "Artifact exceeded {max_bytes} bytes while reading"
            );
            result.extend_from_slice(&buffer[..count]);
        }
        Ok(result)
    }

    pub(super) fn read_artifact(path: &Path, max_bytes: usize) -> Result<Vec<u8>> {
        let (parent, name) = canonical_parent(path)?;
        read(open_at(&directory(&parent)?, &name, libc::O_RDONLY, 0)?, max_bytes)
    }
}

/// Windows has no `openat`; instead the canonical parent directory is opened (not
/// followed) and held without delete sharing, so it can't be renamed or replaced by a
/// symlink or junction while the file in it is read. Neither may be a reparse point.
#[cfg(windows)]
mod filesystem {
    use std::{
        fs::{File, OpenOptions},
        io::Read,
        os::windows::fs::{MetadataExt, OpenOptionsExt},
    };

    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    use super::*;

    pub(super) struct Directory {
        path: PathBuf,
        _handle: File,
    }

    fn open(path: &Path, directory: bool) -> Result<File> {
        let file = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | if directory { FILE_FLAG_BACKUP_SEMANTICS } else { 0 })
            .open(path)
            .context("Failed to open artifact path")?;
        let metadata = file.metadata()?;
        ensure!(
            metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0,
            "Artifact paths must not traverse symlinks or junctions"
        );
        ensure!(
            metadata.is_dir() == directory,
            "Artifact path {} is not a {}",
            path.display(),
            if directory { "directory" } else { "file" }
        );
        Ok(file)
    }

    fn directory(path: &Path) -> Result<Directory> {
        Ok(Directory {
            path: path.to_owned(),
            _handle: open(path, true)?,
        })
    }

    fn canonical_parent(path: &Path) -> Result<(PathBuf, std::ffi::OsString)> {
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()?.join(path)
        };
        let name = path.file_name().context("Artifact path must name a file or new directory")?;
        let parent = path.parent().context("Artifact path must have a parent")?.canonicalize()?;
        Ok((parent, name.to_owned()))
    }

    fn read(mut file: File, max_bytes: usize) -> Result<Vec<u8>> {
        let metadata = file.metadata()?;
        ensure!(
            metadata.is_file() && metadata.len() <= max_bytes as u64,
            "Artifact must be a regular file <= {max_bytes} bytes"
        );
        let mut result = Vec::with_capacity((metadata.len() as usize).min(64 * 1024));
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            ensure!(
                count <= max_bytes.saturating_sub(result.len()),
                "Artifact exceeded {max_bytes} bytes while reading"
            );
            result.extend_from_slice(&buffer[..count]);
        }
        Ok(result)
    }

    pub(super) fn read_artifact(path: &Path, max_bytes: usize) -> Result<Vec<u8>> {
        let (parent, name) = canonical_parent(path)?;
        let parent = directory(&parent)?;
        read(open(&parent.path.join(name), false)?, max_bytes)
    }
}

#[cfg(not(any(unix, windows)))]
mod filesystem {
    use super::*;

    pub(super) fn read_artifact(_: &Path, _: usize) -> Result<Vec<u8>> {
        bail!("Secure no-follow artifact I/O is not supported on this platform")
    }
}
