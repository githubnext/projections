//! The per-user cache that embedded extractor helpers are unpacked into on first use.
//!
//! A distribution build embeds its helpers in the executable. Interpreters such as
//! `node`, `python` and `dotnet` need them as files, so the first extraction that uses
//! one unpacks the complete set into a directory named by the CLI version and the
//! digest of every embedded file. The directory is written under a private staging
//! name and renamed into place, so it is either absent or complete. Every process
//! verifies the directory before using it: exactly the embedded files, byte for byte
//! (SHA-256), with no other entries, no symlinks and, on Unix, only owner-writable
//! directories owned by the current user. Anything else is replaced, never trusted.

use anyhow::{Context, Result, bail, ensure};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// One embedded file: a `/`-separated relative path and its bytes.
pub type Entry = (&'static str, &'static [u8]);

/// Overrides the cache base directory, for development and isolated tests.
pub const VARIABLE: &str = "PROJECTIONS_CACHE_DIR";

/// The per-user cache base directory: `PROJECTIONS_CACHE_DIR`, otherwise
/// `%LOCALAPPDATA%\projections` on Windows, `~/Library/Caches/projections` on macOS
/// and `$XDG_CACHE_HOME/projections` (default `~/.cache/projections`) elsewhere.
pub fn base() -> Result<PathBuf> {
    let absolute = |name: &str| std::env::var_os(name).map(PathBuf::from).filter(|path| path.is_absolute());
    if let Some(value) = std::env::var_os(VARIABLE) {
        let path = PathBuf::from(value);
        ensure!(path.is_absolute(), "{VARIABLE} must be an absolute path");
        return Ok(path);
    }
    let base = if cfg!(windows) {
        absolute("LOCALAPPDATA")
    } else if cfg!(target_os = "macos") {
        absolute("HOME").map(|home| home.join("Library").join("Caches"))
    } else {
        absolute("XDG_CACHE_HOME").or_else(|| absolute("HOME").map(|home| home.join(".cache")))
    };
    match base {
        Some(base) => Ok(base.join("projections")),
        None => bail!(
            "Cannot locate a per-user cache directory for the embedded extractor helpers \
             ({}); set {VARIABLE} to an absolute directory",
            if cfg!(windows) {
                "LOCALAPPDATA is not set"
            } else {
                "HOME is not set"
            }
        ),
    }
}

/// The directory name for one version and set of embedded files.
pub fn identity(version: &str, files: &[Entry]) -> String {
    let mut digest = Sha256::new();
    let mut sorted: Vec<_> = files.iter().collect();
    sorted.sort_by_key(|(path, _)| *path);
    for (path, bytes) in sorted {
        digest.update((path.len() as u64).to_le_bytes());
        digest.update(path.as_bytes());
        digest.update(Sha256::digest(bytes));
    }
    let hex = format!("{:x}", digest.finalize());
    format!("{version}-{}", &hex[..32])
}

/// Returns the verified directory holding exactly `files`, unpacking it first if it
/// is missing, incomplete or altered.
pub fn unpack(base: &Path, version: &str, files: &[Entry]) -> Result<PathBuf> {
    ensure!(!files.is_empty(), "No embedded files to unpack");
    let expected = expected(files)?;
    let helpers = base.join("helpers");
    private_directory(base)?;
    private_directory(&helpers)?;
    let target = helpers.join(identity(version, files));
    if verify(&target, &expected).is_ok() {
        return Ok(target);
    }
    let staging = tempfile::Builder::new()
        .prefix(".staging-")
        .tempdir_in(&helpers)
        .context("Cannot create a staging directory for the extractor helpers")?;
    // A helper set is readable by anyone who reaches it (the base and `helpers` stay private): a container engine
    // whose user namespace maps the container's user away from the owner, as rootless Podman's does, mounts it.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(staging.path(), fs::Permissions::from_mode(0o755))?;
    }
    for (path, bytes) in files {
        write(staging.path(), path, bytes)?;
    }
    verify(staging.path(), &expected).context("Staged extractor helpers do not verify")?;
    let staged = staging.keep();
    let result = (|| {
        if fs::rename(&staged, &target).is_ok() {
            return verify(&target, &expected);
        }
        // Another process may have just unpacked the same set.
        if verify(&target, &expected).is_ok() {
            return Ok(());
        }
        // An altered or incomplete directory is moved aside and replaced, never repaired in place.
        let stale = helpers.join(format!(".stale-{}", uuid::Uuid::new_v4()));
        if fs::symlink_metadata(&target).is_ok() {
            fs::rename(&target, &stale)
                .with_context(|| format!("Cannot replace the altered extractor helper cache {}", target.display()))?;
            remove(&stale);
        }
        fs::rename(&staged, &target).with_context(|| format!("Cannot install the extractor helper cache {}", target.display()))?;
        verify(&target, &expected)
    })();
    if staged.exists() {
        remove(&staged);
    }
    result.with_context(|| format!("The extractor helper cache {} could not be verified", target.display()))?;
    Ok(target)
}

fn remove(path: &Path) {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => {
            let _ = fs::remove_dir_all(path);
        }
        Ok(_) => {
            let _ = fs::remove_file(path);
        }
        Err(_) => {}
    }
}

struct Expected {
    files: BTreeMap<PathBuf, [u8; 32]>,
    directories: BTreeSet<PathBuf>,
}

fn expected(files: &[Entry]) -> Result<Expected> {
    let mut expected = Expected {
        files: BTreeMap::new(),
        directories: BTreeSet::new(),
    };
    for (path, bytes) in files {
        let parts: Vec<_> = path.split('/').collect();
        ensure!(
            parts
                .iter()
                .all(|part| !part.is_empty() && *part != "." && *part != ".." && !part.contains(['\\', ':', '\0'])),
            "Unsafe embedded helper path {path}"
        );
        let relative: PathBuf = parts.iter().collect();
        for ancestor in relative.ancestors().skip(1) {
            if !ancestor.as_os_str().is_empty() {
                expected.directories.insert(ancestor.to_owned());
            }
        }
        ensure!(
            expected.files.insert(relative, Sha256::digest(bytes).into()).is_none(),
            "Duplicate embedded helper path {path}"
        );
    }
    Ok(expected)
}

/// Creates `path` if missing and requires a real directory that only its owner,
/// the current user, can write.
pub(crate) fn private_directory(path: &Path) -> Result<()> {
    if fs::symlink_metadata(path).is_err() {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(path)
            .with_context(|| format!("Cannot create the cache directory {}", path.display()))?;
    }
    let metadata = fs::symlink_metadata(path)?;
    ensure!(
        metadata.is_dir() && !metadata.is_symlink(),
        "The cache directory {} must be a directory, not a symlink",
        path.display()
    );
    owner_only(path, &metadata)
}

#[cfg(unix)]
fn owner_only(path: &Path, metadata: &fs::Metadata) -> Result<()> {
    use std::os::unix::fs::MetadataExt;
    ensure!(
        metadata.uid() == unsafe { libc::geteuid() } && metadata.mode() & 0o022 == 0,
        "The cache directory {} must be owned by the current user and writable only by them",
        path.display()
    );
    Ok(())
}

// Windows per-user directories such as %LOCALAPPDATA% are private by their ACLs.
#[cfg(not(unix))]
fn owner_only(_: &Path, _: &fs::Metadata) -> Result<()> {
    Ok(())
}

fn write(root: &Path, path: &str, bytes: &[u8]) -> Result<()> {
    let destination = path.split('/').fold(root.to_owned(), |path, part| path.join(part));
    let mut parent = root.to_owned();
    for part in path.split('/').take(path.split('/').count() - 1) {
        parent.push(part);
        if fs::symlink_metadata(&parent).is_err() {
            #[cfg_attr(not(unix), allow(unused_mut))]
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o755);
            }
            builder.create(&parent)?;
        }
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o644);
    }
    let mut file = options
        .open(&destination)
        .with_context(|| format!("Cannot write {}", destination.display()))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

/// Requires `root` to contain exactly the expected files and directories.
fn verify(root: &Path, expected: &Expected) -> Result<()> {
    let metadata = fs::symlink_metadata(root)?;
    ensure!(metadata.is_dir() && !metadata.is_symlink(), "{} is not a directory", root.display());
    owner_only(root, &metadata)?;
    let mut found = BTreeSet::new();
    let mut pending = vec![PathBuf::new()];
    while let Some(relative) = pending.pop() {
        for entry in fs::read_dir(root.join(&relative))? {
            let entry = entry?;
            let path = relative.join(entry.file_name());
            let metadata = fs::symlink_metadata(entry.path())?;
            if metadata.is_dir() && !metadata.is_symlink() {
                ensure!(expected.directories.contains(&path), "Unexpected directory {}", path.display());
                owner_only(&entry.path(), &metadata)?;
                pending.push(path);
            } else {
                let digest = expected
                    .files
                    .get(&path)
                    .with_context(|| format!("Unexpected entry {}", path.display()))?;
                ensure!(
                    metadata.is_file() && !metadata.is_symlink(),
                    "{} is not a regular file",
                    path.display()
                );
                ensure!(
                    &file_digest(&entry.path())? == digest,
                    "{} does not match the embedded helper",
                    path.display()
                );
                found.insert(path);
            }
        }
    }
    ensure!(found.len() == expected.files.len(), "Incomplete extractor helper cache");
    Ok(())
}

fn file_digest(path: &Path) -> Result<[u8; 32]> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            return Ok(digest.finalize().into());
        }
        digest.update(&buffer[..count]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILES: &[Entry] = &[
        ("helpers/go/go.mod", b"module helper\n"),
        ("helpers/go/main.go", b"package main\n"),
        ("helpers/node/extractor.mjs", b"export {}\n"),
    ];

    fn base() -> tempfile::TempDir {
        let base = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(base.path(), fs::Permissions::from_mode(0o700)).unwrap();
        }
        base
    }

    #[test]
    fn unpacks_once_and_reuses_the_verified_directory() {
        let base = base();
        let first = unpack(base.path(), "1.2.3", FILES).unwrap();
        assert!(first.starts_with(base.path().join("helpers")));
        assert_eq!(first.file_name().unwrap().to_str().unwrap(), identity("1.2.3", FILES));
        assert_eq!(fs::read(first.join("helpers/go/main.go")).unwrap(), b"package main\n");
        let modified = fs::metadata(first.join("helpers/go/main.go")).unwrap().modified().unwrap();
        assert_eq!(unpack(base.path(), "1.2.3", FILES).unwrap(), first);
        assert_eq!(
            fs::metadata(first.join("helpers/go/main.go")).unwrap().modified().unwrap(),
            modified
        );
        // Only the complete directory remains; staging directories are gone.
        let names: Vec<_> = fs::read_dir(base.path().join("helpers"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, [first.file_name().unwrap()]);
    }

    #[test]
    fn versions_and_contents_select_distinct_directories() {
        let changed: &[Entry] = &[("helpers/go/main.go", b"package other\n")];
        assert_ne!(identity("1.2.3", FILES), identity("1.2.4", FILES));
        assert_ne!(identity("1.2.3", FILES), identity("1.2.3", changed));
        let mut reordered = FILES.to_vec();
        reordered.reverse();
        assert_eq!(identity("1.2.3", FILES), identity("1.2.3", &reordered));
    }

    #[test]
    fn altered_incomplete_or_extended_caches_are_replaced() {
        let base = base();
        let directory = unpack(base.path(), "0.0.0", FILES).unwrap();
        let main = directory.join("helpers/go/main.go");
        let alterations: Vec<Box<dyn Fn()>> = vec![
            Box::new(|| fs::write(&main, b"package hijacked\n").unwrap()),
            Box::new(|| fs::remove_file(&main).unwrap()),
            Box::new(|| fs::write(directory.join("helpers/go/extra.go"), b"package main\n").unwrap()),
            Box::new(|| fs::create_dir(directory.join("helpers/python")).unwrap()),
            #[cfg(unix)]
            Box::new(|| {
                fs::remove_file(&main).unwrap();
                std::os::unix::fs::symlink(directory.join("helpers/go/go.mod"), &main).unwrap();
            }),
        ];
        for alter in alterations {
            alter();
            assert!(verify(&directory, &expected(FILES).unwrap()).is_err());
            assert_eq!(unpack(base.path(), "0.0.0", FILES).unwrap(), directory);
            assert_eq!(fs::read(&main).unwrap(), b"package main\n");
            assert!(!directory.join("helpers/go/extra.go").exists());
            assert!(!directory.join("helpers/python").exists());
        }
    }

    #[cfg(unix)]
    #[test]
    fn shared_writable_cache_directories_are_refused() {
        use std::os::unix::fs::PermissionsExt;
        let base = base();
        fs::set_permissions(base.path(), fs::Permissions::from_mode(0o777)).unwrap();
        let error = unpack(base.path(), "0.0.0", FILES).unwrap_err();
        assert!(format!("{error:#}").contains("writable only by"));
        fs::set_permissions(base.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let directory = unpack(base.path(), "0.0.0", FILES).unwrap();
        fs::set_permissions(directory.join("helpers"), fs::Permissions::from_mode(0o770)).unwrap();
        assert!(verify(&directory, &expected(FILES).unwrap()).is_err());
        assert_eq!(unpack(base.path(), "0.0.0", FILES).unwrap(), directory);
    }

    #[test]
    fn unsafe_embedded_paths_are_rejected() {
        let base = base();
        for path in ["../escape", "helpers//x", "helpers/./x", "C:/x", "a\\b"] {
            let files: &[Entry] = &[(Box::leak(path.to_owned().into_boxed_str()), b"x")];
            assert!(unpack(base.path(), "0.0.0", files).is_err(), "{path}");
        }
    }
}
