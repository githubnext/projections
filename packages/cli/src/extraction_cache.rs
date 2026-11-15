//! The persistent extraction cache: saved extraction documents keyed by what
//! they depend on, shared by every command and `serve --stdio`.
//!
//! A key is the SHA-256 of the definition digest, the examined Git tree (and the
//! definition revision's, when it differs), the access mode and an environment
//! fingerprint ([`Runner`](crate::runtime::Runner) computes it). Entries live
//! under the per-user cache directory, `extractions/<repository>/`, where the
//! repository is named by its Git common directory, and are written atomically.
//! The cache is capped (512 MiB by default, `PROJECTIONS_EXTRACTION_CACHE_BYTES`)
//! across repositories, evicting the least recently used. Removing it is always
//! safe; an entry is revalidated before use.

use anyhow::{Context, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Overrides the cache's size cap in bytes.
pub const LIMIT_VARIABLE: &str = "PROJECTIONS_EXTRACTION_CACHE_BYTES";
const DEFAULT_LIMIT: u64 = 512 * 1024 * 1024;

/// One repository's extraction cache.
#[derive(Clone, Debug)]
pub struct ExtractionCache {
    root: PathBuf,
    directory: PathBuf,
    limit: u64,
}

/// A short, stable name for a repository: its Git common directory, hashed.
pub fn repository_name(common_directory: &Path) -> String {
    let digest = Sha256::digest(common_directory.to_string_lossy().as_bytes());
    format!("{:x}", digest)[..24].to_owned()
}

impl ExtractionCache {
    /// The cache for the repository whose Git common directory is `common_directory`.
    pub fn open(common_directory: &Path) -> Result<Self> {
        Self::open_in(&crate::cache::base()?, common_directory)
    }

    /// The cache under another per-user cache base, for tests.
    pub fn open_in(base: &Path, common_directory: &Path) -> Result<Self> {
        let root = base.join("extractions");
        let limit = std::env::var(LIMIT_VARIABLE)
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_LIMIT);
        Ok(Self {
            directory: root.join(repository_name(common_directory)),
            root,
            limit,
        })
    }

    fn path(&self, key: &str) -> PathBuf {
        self.directory.join(&key[..2]).join(format!("{key}.json"))
    }

    /// The document saved under `key`, if any, marked as recently used.
    pub fn get(&self, key: &str) -> Option<Value> {
        let path = self.path(key);
        let bytes = crate::runtime::read_regular(&path, 32 * 1024 * 1024).ok()?;
        let document = serde_json::from_slice(&bytes).ok();
        if document.is_none() {
            let _ = fs::remove_file(&path);
        }
        if let Ok(file) = fs::OpenOptions::new().append(true).open(&path) {
            let _ = file.set_modified(SystemTime::now());
        }
        document
    }

    /// Saves `document` under `key`, then evicts the least recently used
    /// entries beyond the cap.
    pub fn put(&self, key: &str, document: &Value) -> Result<()> {
        let path = self.path(key);
        let parent = path.parent().context("Cache entry has no directory")?;
        for directory in [&self.root, &self.directory, &parent.to_path_buf()] {
            crate::cache::private_directory(directory)?;
        }
        let mut staged = tempfile::Builder::new().prefix(".staging-").tempfile_in(parent)?;
        staged.write_all(&serde_json::to_vec(document)?)?;
        staged.as_file().sync_all()?;
        staged
            .persist(&path)
            .map_err(|error| error.error)
            .with_context(|| format!("Cannot save the cache entry {}", path.display()))?;
        self.evict();
        Ok(())
    }

    /// Removes this repository's entries.
    pub fn clear(&self) -> Result<()> {
        if self.directory.exists() {
            fs::remove_dir_all(&self.directory)?;
        }
        Ok(())
    }

    /// The number of entries and their bytes, for this repository.
    pub fn usage(&self) -> (usize, u64) {
        let entries = entries(&self.directory);
        (entries.len(), entries.iter().map(|entry| entry.1).sum())
    }

    /// Deletes the least recently used entries, across repositories, until the
    /// cache is within its cap.
    fn evict(&self) {
        let mut all: Vec<(PathBuf, u64, SystemTime)> = fs::read_dir(&self.root)
            .into_iter()
            .flatten()
            .flatten()
            .flat_map(|repository| entries(&repository.path()))
            .collect();
        let mut total: u64 = all.iter().map(|entry| entry.1).sum();
        if total <= self.limit {
            return;
        }
        all.sort_by_key(|entry| entry.2);
        for (path, size, _) in all {
            if total <= self.limit {
                break;
            }
            if fs::remove_file(&path).is_ok() {
                total = total.saturating_sub(size);
            }
        }
    }
}

/// Every entry under a repository's directory: path, size and last use.
fn entries(directory: &Path) -> Vec<(PathBuf, u64, SystemTime)> {
    fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|shard| fs::read_dir(shard.path()).into_iter().flatten().flatten())
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().is_none_or(|extension| extension != "json") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            Some((path, metadata.len(), metadata.modified().ok()?))
        })
        .collect()
}
