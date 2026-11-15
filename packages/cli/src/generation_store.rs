//! The generation store: values extractors generated (summaries a language
//! model wrote, say), keyed by their declaration's path and basis digest, so a
//! later run with an equal basis reuses the same text byte for byte.
//!
//! The runner owns it; extractors only read a snapshot. One JSON Lines file
//! per projection lives under the per-user cache directory,
//! `generations/<repository>/<SHA-256 of the projection ID>.jsonl`, each line
//! `{"path", "basis", "value", "used", "source"}`. The runner fills it from
//! extractions that passed validation (its own runs, the extraction cache and
//! verified CI artifacts); a key already stored keeps its earlier value, so
//! text converges on the first generation. Each projection keeps at most
//! 16 MiB, least recently used first out, and the whole store is capped
//! (128 MiB by default, `PROJECTIONS_GENERATION_CACHE_BYTES`). Removing it is
//! always safe. See `docs/design/generated-values.md`.

use anyhow::{Context, Result};
use projections_engine::volatility::generated_values;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Overrides the store's size cap in bytes.
pub const LIMIT_VARIABLE: &str = "PROJECTIONS_GENERATION_CACHE_BYTES";
const DEFAULT_LIMIT: u64 = 128 * 1024 * 1024;
/// The most one projection's entries may take.
const PROJECTION_LIMIT: usize = 16 * 1024 * 1024;
/// The most a store file may be when read.
const MAX_FILE_BYTES: usize = 32 * 1024 * 1024;

/// Where reused values came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Source {
    // In alphabetical order, as provenance lists them.
    Ci,
    Local,
}

impl Source {
    fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Ci => "ci",
        }
    }
}

#[derive(Clone, Debug)]
struct Entry {
    path: String,
    basis: String,
    value: Value,
    used: String,
    source: Source,
}

impl Entry {
    fn line(&self) -> String {
        json!({"path": self.path, "basis": self.basis, "value": self.value,
            "used": self.used, "source": self.source.as_str()})
        .to_string()
    }
}

/// What harvesting an extraction found: its generated values and how many of
/// them the store already held with the same value, from which sources.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Harvest {
    pub values: usize,
    pub reused: usize,
    pub sources: BTreeSet<Source>,
}

impl Harvest {
    /// The extraction's `provenance.generated`, or `None` without generated
    /// values.
    pub fn provenance(&self) -> Option<Value> {
        (self.values > 0).then(|| {
            json!({"values": self.values, "reused": self.reused,
                "sources": self.sources.iter().map(|source| source.as_str()).collect::<Vec<_>>()})
        })
    }
}

/// One projection's generation store in one repository.
#[derive(Clone, Debug)]
pub struct GenerationStore {
    root: PathBuf,
    directory: PathBuf,
    file: PathBuf,
    limit: u64,
}

impl GenerationStore {
    /// The store under the per-user cache base `base` for the repository whose
    /// Git common directory is `common_directory`.
    pub fn open_in(base: &Path, common_directory: &Path, projection: &str) -> Self {
        let root = base.join("generations");
        let directory = root.join(crate::extraction_cache::repository_name(common_directory));
        let name = format!("{:x}", Sha256::digest(projection.as_bytes()));
        let limit = std::env::var(LIMIT_VARIABLE)
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_LIMIT);
        Self {
            file: directory.join(format!("{name}.jsonl")),
            directory,
            root,
            limit,
        }
    }

    fn load(&self) -> Vec<Entry> {
        let Ok(bytes) = crate::runtime::read_regular(&self.file, MAX_FILE_BYTES) else {
            return Vec::new();
        };
        String::from_utf8_lossy(&bytes)
            .lines()
            .filter_map(|line| {
                let entry: Value = serde_json::from_str(line).ok()?;
                Some(Entry {
                    path: entry["path"].as_str()?.to_owned(),
                    basis: entry["basis"].as_str()?.to_owned(),
                    value: entry.get("value")?.clone(),
                    used: entry["used"].as_str().unwrap_or_default().to_owned(),
                    source: if entry["source"] == "ci" { Source::Ci } else { Source::Local },
                })
            })
            .collect()
    }

    /// The snapshot an extractor reads: one `{path, basis, value}` per line,
    /// or `None` when the store is empty.
    pub fn snapshot(&self) -> Option<String> {
        let entries = self.load();
        (!entries.is_empty()).then(|| {
            entries
                .iter()
                .map(|entry| json!({"path": entry.path, "basis": entry.basis, "value": entry.value}).to_string() + "\n")
                .collect()
        })
    }

    /// Writes the snapshot to a private temporary file for one run, or
    /// `None` when the store is empty. The file is removed when dropped.
    pub fn snapshot_file(&self) -> Result<Option<tempfile::NamedTempFile>> {
        let Some(text) = self.snapshot() else {
            return Ok(None);
        };
        let mut file = tempfile::Builder::new()
            .prefix("projections-generations-")
            .suffix(".jsonl")
            .tempfile()?;
        file.write_all(text.as_bytes())?;
        file.as_file().sync_all()?;
        Ok(Some(file))
    }

    /// Counts a normalized extraction's generated values and the ones the
    /// store already holds with the same value, without changing the store.
    pub fn assess(&self, extraction: &Value) -> Harvest {
        self.merge(extraction, Source::Local, &crate::runtime::utc_now()).0
    }

    /// Records a validated extraction's generated values (an earlier value
    /// for a key stays), marks the ones it reused as used, trims the
    /// projection to its limit and the store to its cap.
    pub fn harvest(&self, extraction: &Value, source: Source) -> Result<Harvest> {
        let (harvest, entries, changed) = self.merge(extraction, source, &crate::runtime::utc_now());
        if changed {
            self.write(entries)?;
        }
        Ok(harvest)
    }

    fn merge(&self, extraction: &Value, source: Source, now: &str) -> (Harvest, Vec<Entry>, bool) {
        let generated = generated_values(extraction);
        let mut harvest = Harvest {
            values: generated.len(),
            ..Harvest::default()
        };
        if generated.is_empty() {
            return (harvest, Vec::new(), false);
        }
        let mut entries = self.load();
        let mut index: HashMap<(String, String), usize> = entries
            .iter()
            .enumerate()
            .map(|(position, entry)| ((entry.path.clone(), entry.basis.clone()), position))
            .collect();
        for value in generated {
            let key = (value.declared, value.basis);
            match index.get(&key) {
                Some(&position) => {
                    let entry = &mut entries[position];
                    if entry.value == value.value {
                        harvest.reused += 1;
                        harvest.sources.insert(entry.source);
                    }
                    entry.used = now.to_owned();
                }
                None => {
                    index.insert(key.clone(), entries.len());
                    entries.push(Entry {
                        path: key.0,
                        basis: key.1,
                        value: value.value,
                        used: now.to_owned(),
                        source,
                    });
                }
            }
        }
        (harvest, entries, true)
    }

    fn write(&self, mut entries: Vec<Entry>) -> Result<()> {
        // The most recently used first, so trimming keeps them.
        entries.sort_by(|a, b| b.used.cmp(&a.used));
        let mut text = String::new();
        for entry in &entries {
            let line = entry.line();
            if text.len() + line.len() + 1 > PROJECTION_LIMIT {
                break;
            }
            text.push_str(&line);
            text.push('\n');
        }
        for directory in [&self.root, &self.directory] {
            crate::cache::private_directory(directory)?;
        }
        let mut staged = tempfile::Builder::new().prefix(".staging-").tempfile_in(&self.directory)?;
        staged.write_all(text.as_bytes())?;
        staged.as_file().sync_all()?;
        staged
            .persist(&self.file)
            .map_err(|error| error.error)
            .with_context(|| format!("Cannot save the generation store {}", self.file.display()))?;
        self.evict();
        Ok(())
    }

    /// Deletes the least recently written projection files, across
    /// repositories, until the store is within its cap.
    fn evict(&self) {
        let mut all: Vec<(PathBuf, u64, SystemTime)> = fs::read_dir(&self.root)
            .into_iter()
            .flatten()
            .flatten()
            .flat_map(|repository| fs::read_dir(repository.path()).into_iter().flatten().flatten())
            .filter_map(|entry| {
                let path = entry.path();
                if path.extension().is_none_or(|extension| extension != "jsonl") {
                    return None;
                }
                let metadata = entry.metadata().ok()?;
                Some((path, metadata.len(), metadata.modified().ok()?))
            })
            .collect();
        let mut total: u64 = all.iter().map(|entry| entry.1).sum();
        if total <= self.limit {
            return;
        }
        all.sort_by_key(|entry| entry.2);
        for (path, size, _) in all {
            if total <= self.limit || path == self.file {
                continue;
            }
            if fs::remove_file(&path).is_ok() {
                total = total.saturating_sub(size);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extraction(summary: &str, input: &str) -> Value {
        projections_engine::normalize(
            &json!({"protocolVersion": 0, "schema": "graph/v0", "relationships": [],
                "volatile": [{"path": "/data/summary", "generated": true, "basis": "/data/basis"}],
                "entities": [{"id": "a", "kind": "class", "label": "a",
                    "data": {"summary": summary, "basis": {"input": input}}}]}),
            "",
        )
        .unwrap()
    }

    #[test]
    fn harvesting_keeps_the_first_value_and_counts_reuse() {
        let base = tempfile::tempdir().unwrap();
        let store = GenerationStore::open_in(base.path(), Path::new("/repo/.git"), "summaries");
        assert!(store.snapshot().is_none());
        let first = store.harvest(&extraction("Validates orders.", "sha256:a"), Source::Ci).unwrap();
        assert_eq!(
            first,
            Harvest {
                values: 1,
                ..Harvest::default()
            }
        );
        let snapshot = store.snapshot().unwrap();
        assert!(snapshot.contains("\"path\":\"/data/summary\""));
        assert!(snapshot.contains("Validates orders."));
        assert!(!snapshot.contains("used"));
        // The same text from the same basis was reused, from CI's value.
        let again = store.assess(&extraction("Validates orders.", "sha256:a"));
        assert_eq!((again.values, again.reused), (1, 1));
        assert_eq!(again.provenance(), Some(json!({"values": 1, "reused": 1, "sources": ["ci"]})));
        // Rewording from the same basis doesn't replace the stored text.
        let reworded = store.harvest(&extraction("Checks orders.", "sha256:a"), Source::Local).unwrap();
        assert_eq!(reworded.reused, 0);
        assert!(store.snapshot().unwrap().contains("Validates orders."));
        // Another basis is another entry.
        store.harvest(&extraction("Checks orders.", "sha256:b"), Source::Local).unwrap();
        assert_eq!(store.snapshot().unwrap().lines().count(), 2);
        // Other projections and repositories have stores of their own.
        let other = GenerationStore::open_in(base.path(), Path::new("/repo/.git"), "other");
        assert!(other.snapshot().is_none());
        let file = store.snapshot_file().unwrap().unwrap();
        assert_eq!(fs::read_to_string(file.path()).unwrap(), store.snapshot().unwrap());
    }

    #[test]
    fn extractions_without_generated_values_leave_the_store_alone() {
        let base = tempfile::tempdir().unwrap();
        let store = GenerationStore::open_in(base.path(), Path::new("/repo/.git"), "plain");
        let plain = projections_engine::normalize(
            &json!({"protocolVersion": 0, "schema": "graph/v0", "relationships": [],
                "entities": [{"id": "a", "kind": "class", "label": "a"}]}),
            "",
        )
        .unwrap();
        let harvest = store.harvest(&plain, Source::Local).unwrap();
        assert_eq!(harvest.provenance(), None);
        assert!(!base.path().join("generations").exists());
    }
}
