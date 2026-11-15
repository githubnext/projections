//! Inspector fixtures mode: `projections.scenarios` documents, the extractions
//! and comparator files they reference, and local renderer bundles. Nothing
//! here executes extractors. Every failure is reported on the source, scenario
//! or renderer it belongs to, so one broken file never hides the others.

mod loader;
mod manifest;
mod read;
mod scenario;

pub use manifest::renderer_manifest;

use anyhow::{Context, Result, bail, ensure};
use loader::Loader;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::artifact;

pub const MAX_SCENARIOS_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_SCENARIOS: usize = 1000;
pub const MAX_EXTRACTION_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_RULES_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_RENDERER_BYTES: usize = 64 * 1024 * 1024;
/// The only files a renderer bundle serves.
pub const RENDERER_FILES: [&str; 2] = ["index.html", "renderer.json"];

/// Loaded fixtures: the `/api/fixtures` response without its generation.
pub struct Fixtures {
    pub value: Value,
    /// Files whose changes reload the fixtures, including ones that don't exist yet.
    pub watched: Vec<PathBuf>,
    /// Usable renderer bundle directories by renderer key.
    pub bundles: HashMap<String, PathBuf>,
}

impl Fixtures {
    /// Every error the sources, renderers and scenarios report, as `kind key: message`.
    pub fn errors(&self) -> Vec<String> {
        [("sources", "scenarios file"), ("renderers", "renderer"), ("scenarios", "scenario")]
            .iter()
            .flat_map(|(collection, kind)| {
                self.value[collection].as_array().into_iter().flatten().filter_map(move |entry| {
                    let error = entry["error"].as_str()?;
                    let key = entry["key"].as_str().unwrap_or_default();
                    Some(format!("{kind} {key}: {error}"))
                })
            })
            .collect()
    }
}

/// A file's change fingerprint: whether it exists, its length, its mtime and,
/// for files up to [`HASHED_LIMIT`], a hash of its content, so an edit that
/// keeps the length within the file system's mtime granularity (a second on
/// some) is still a change.
pub type Fingerprint = Vec<Option<(u64, Option<SystemTime>, u64)>>;

/// Larger files are fingerprinted by length and mtime alone.
const HASHED_LIMIT: u64 = 1024 * 1024;

pub fn fingerprint(paths: &[PathBuf]) -> Fingerprint {
    paths
        .iter()
        .map(|path| {
            let metadata = std::fs::metadata(path).ok()?;
            let content = if metadata.is_file() && metadata.len() <= HASHED_LIMIT {
                std::fs::read(path).map_or(0, |bytes| {
                    let mut hasher = std::hash::DefaultHasher::new();
                    std::hash::Hash::hash(&bytes, &mut hasher);
                    std::hash::Hasher::finish(&hasher)
                })
            } else {
                0
            };
            Some((metadata.len(), metadata.modified().ok(), content))
        })
        .collect()
}

/// Resolves command-line fixture paths: a directory means its `scenarios.json`.
/// Paths that don't exist fail here, before the Inspector starts.
pub fn resolve(sources: &[PathBuf], renderers: &[PathBuf]) -> Result<(Vec<PathBuf>, Vec<PathBuf>)> {
    let mut files = Vec::new();
    for source in sources {
        let path = std::fs::canonicalize(source).with_context(|| format!("Fixture path {} does not exist", source.display()))?;
        let path = if path.is_dir() {
            let file = path.join("scenarios.json");
            ensure!(file.is_file(), "Fixture directory {} has no scenarios.json", source.display());
            file
        } else {
            path
        };
        if !files.contains(&path) {
            files.push(path);
        }
    }
    let mut directories = Vec::new();
    for renderer in renderers {
        let path = std::fs::canonicalize(renderer).with_context(|| format!("Renderer path {} does not exist", renderer.display()))?;
        ensure!(
            path.is_dir(),
            "Renderer path {} must be a bundle or package directory",
            renderer.display()
        );
        if !directories.contains(&path) {
            directories.push(path);
        }
    }
    Ok((files, directories))
}

/// Loads scenario documents and renderer bundles. `renderer_base` prefixes
/// renderer bundle URLs (`<base><key>/index.html?v=<digest>`). With `compare`,
/// every comparison scenario is also compared with its comparator, as
/// `projections validate` does; the Inspector compares in the browser instead.
pub fn load(sources: &[PathBuf], renderers: &[PathBuf], renderer_base: &str, compare: bool) -> Fixtures {
    let mut loader = Loader {
        base: renderer_base,
        compare,
        watched: Vec::new(),
        renderers: Vec::new(),
        bundles: HashMap::new(),
        renderer_keys: HashMap::new(),
        extractions: HashMap::new(),
        rules: HashMap::new(),
    };
    for directory in renderers {
        loader.renderer(directory, true);
    }
    let mut names = HashSet::new();
    let mut source_entries = Vec::new();
    let mut scenarios = Vec::new();
    for path in sources {
        let base = source_name(path);
        let mut name = base.clone();
        let mut suffix = 1;
        while !names.insert(name.clone()) {
            suffix += 1;
            name = format!("{base}-{suffix}");
        }
        let (entry, entries) = loader.source(path, &name);
        source_entries.push(entry);
        scenarios.extend(entries);
    }
    let mut watched = Vec::new();
    for path in loader.watched {
        if !watched.contains(&path) {
            watched.push(path);
        }
    }
    Fixtures {
        value: json!({"sources": source_entries, "renderers": loader.renderers, "scenarios": scenarios}),
        watched,
        bundles: loader.bundles,
    }
}

/// Validates a scenarios document and everything it references, comparing
/// every comparison scenario. Returns the number of scenarios.
pub fn validate(path: &Path) -> Result<usize> {
    let (sources, _) = resolve(&[path.to_path_buf()], &[])?;
    let fixtures = load(&sources, &[], "", true);
    let errors = fixtures.errors();
    if !errors.is_empty() {
        bail!("Scenarios document is invalid:\n  {}", errors.join("\n  "));
    }
    Ok(fixtures.value["scenarios"].as_array().map_or(0, Vec::len))
}

/// One renderer bundle file, read without following symlinks.
pub fn bundle_file(directory: &Path, name: &str) -> Result<Vec<u8>> {
    ensure!(
        RENDERER_FILES.contains(&name),
        "Renderer bundles serve only index.html and renderer.json"
    );
    artifact::read_artifact(&directory.join(name), MAX_RENDERER_BYTES)
}

/// A scenarios file's source key: its directory's name for `scenarios.json`,
/// otherwise its file name without `.json` and a trailing `.scenarios`.
fn source_name(path: &Path) -> String {
    let file = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    if file == "scenarios.json"
        && let Some(parent) = path.parent().and_then(Path::file_name)
    {
        return parent.to_string_lossy().into_owned();
    }
    let name = file.strip_suffix(".json").unwrap_or(&file);
    let name = name.strip_suffix(".scenarios").unwrap_or(name);
    if name.is_empty() { "scenarios".to_owned() } else { name.to_owned() }
}

#[cfg(test)]
mod tests;
