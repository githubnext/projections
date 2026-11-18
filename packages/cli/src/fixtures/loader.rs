//! The fixtures loader: renderer bundle directories, scenarios files and the
//! scenarios documents they hold, each failure kept on its own entry.

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::{
    MAX_SCENARIOS, MAX_SCENARIOS_BYTES, RENDERER_FILES,
    manifest::{bundle, package_bundle},
    read::{bounded_text, json_text, lexical, read, short_sha256},
    scenario::Rules,
};
use crate::artifact::{fields, identifier};

pub(super) struct Loader<'a> {
    pub(super) base: &'a str,
    pub(super) compare: bool,
    /// Whether bundles a scenarios document names, besides the explicit ones, may be served.
    pub(super) trusted: bool,
    pub(super) watched: Vec<PathBuf>,
    pub(super) renderers: Vec<Value>,
    pub(super) bundles: HashMap<String, PathBuf>,
    pub(super) renderer_keys: HashMap<PathBuf, String>,
    pub(super) extractions: HashMap<PathBuf, Result<Value, String>>,
    pub(super) rules: HashMap<PathBuf, Result<Rules, String>>,
}

impl Loader<'_> {
    /// Registers a renderer bundle directory once and returns its key.
    /// `package` allows a package directory whose `package.json` names its
    /// bundle (`"projections": {"renderer": "<dir>"}`), as `--renderer` does.
    pub(super) fn renderer(&mut self, directory: &Path, package: bool) -> String {
        let mut directory = lexical(directory);
        let mut error = None;
        // A package's development server, when one runs, replaces its bundle.
        let development = package.then(|| {
            self.watched.push(directory.join(crate::dev_server::RECORD));
            crate::dev_server::find(&directory)
        });
        if package && !RENDERER_FILES.iter().any(|name| directory.join(name).exists()) {
            let manifest = directory.join("package.json");
            self.watched
                .extend(RENDERER_FILES.iter().map(|name| directory.join(name)).chain([manifest.clone()]));
            match package_bundle(&manifest) {
                Ok(bundle) => directory = lexical(&directory.join(bundle)),
                Err(failure) => error = Some(format!("{failure:#}")),
            }
        }
        let directory = std::fs::canonicalize(&directory).unwrap_or(directory);
        if let Some(key) = self.renderer_keys.get(&directory) {
            return key.clone();
        }
        let key = short_sha256(directory.to_string_lossy().as_bytes());
        self.renderer_keys.insert(directory.clone(), key.clone());
        self.watched.extend(RENDERER_FILES.iter().map(|name| directory.join(name)));
        let mut entry = json!({"key": key, "path": directory.to_string_lossy()});
        if let Some(Some((url, manifest))) = development {
            entry["manifest"] = manifest;
            entry["url"] = json!(url);
            entry["development"] = json!(true);
            self.renderers.push(entry);
            return key;
        }
        match error.map_or_else(|| bundle(&directory), |error| Err(anyhow::anyhow!(error))) {
            Ok((manifest, digest)) => {
                entry["manifest"] = manifest;
                entry["url"] = json!(format!("{}{key}/index.html?v={digest}", self.base));
                self.bundles.insert(key.clone(), directory);
            }
            Err(failure) => entry["error"] = json!(format!("{failure:#}")),
        }
        self.renderers.push(entry);
        key
    }

    /// Registers a bundle directory a scenarios document names and returns its
    /// key. It is repository code, so unless it is one of the explicit bundles
    /// (`--renderer`, registered first) it is served only when trusted;
    /// otherwise its entry says why, and hosts use the built-in renderer.
    pub(super) fn scenario_bundle(&mut self, directory: &Path) -> String {
        let lexical = lexical(directory);
        let canonical = std::fs::canonicalize(&lexical).unwrap_or(lexical);
        if self.trusted || self.renderer_keys.contains_key(&canonical) {
            return self.renderer(directory, false);
        }
        let key = short_sha256(canonical.to_string_lossy().as_bytes());
        self.renderer_keys.insert(canonical.clone(), key.clone());
        self.renderers.push(json!({
            "key": key, "path": canonical.to_string_lossy(),
            "withheld": format!("The renderer bundle {} that the scenarios name is repository code, so it runs only when named with --renderer or with --trust (in VS Code, a trusted workspace).", canonical.display()),
        }));
        key
    }

    pub(super) fn source(&mut self, path: &Path, name: &str) -> (Value, Vec<Value>) {
        self.watched.push(path.to_path_buf());
        let mut entry = json!({"key": name, "path": path.to_string_lossy()});
        let document = read(path, MAX_SCENARIOS_BYTES)
            .and_then(|bytes| json_text(&bytes, "Scenarios document"))
            .and_then(|document| self.document(&document, path, name));
        match document {
            Ok((title, scenarios)) => {
                if let Some(title) = title {
                    entry["title"] = json!(title);
                }
                (entry, scenarios)
            }
            Err(failure) => {
                entry["error"] = json!(format!("{failure:#}"));
                (entry, Vec::new())
            }
        }
    }

    fn document(&mut self, document: &Value, path: &Path, source: &str) -> Result<(Option<String>, Vec<Value>)> {
        fields(
            document,
            &["format", "version", "title", "renderer", "scenarios"],
            "Scenarios document",
        )?;
        ensure!(
            document["format"] == "projections.scenarios" && document["version"].as_f64() == Some(0.0),
            "Unsupported scenarios document format/version"
        );
        let title = document
            .get("title")
            .map(|title| bounded_text(title, "title", 1000).map(str::to_owned))
            .transpose()?;
        let directory = path.parent().unwrap_or(Path::new("/"));
        let renderer = document
            .get("renderer")
            .map(|renderer| self.scenario_renderer(renderer, directory, "renderer"))
            .transpose()?;
        let scenarios = document["scenarios"].as_array().context("scenarios must be an array")?;
        ensure!(
            scenarios.len() <= MAX_SCENARIOS,
            "A scenarios document allows at most {MAX_SCENARIOS} scenarios"
        );
        let group = title.clone().unwrap_or_else(|| source.to_owned());
        let mut ids = HashSet::new();
        let entries = scenarios
            .iter()
            .enumerate()
            .map(|(index, scenario)| {
                let label = format!("scenarios[{index}]");
                let (id, key, mut error) = match identifier(&scenario["id"], &format!("{label}.id")) {
                    Ok(id) if ids.insert(id.to_owned()) => (id.to_owned(), id.to_owned(), None),
                    Ok(id) => (id.to_owned(), format!("#{index}"), Some(format!("Duplicate scenario id {id}"))),
                    Err(failure) => (
                        scenario["id"].as_str().map_or_else(|| format!("#{index}"), str::to_owned),
                        format!("#{index}"),
                        Some(failure.to_string()),
                    ),
                };
                let mut entry = json!({
                    "key": format!("{source}/{key}"), "source": source, "id": id,
                    "title": scenario["title"].as_str().filter(|title| !title.trim().is_empty()).unwrap_or(&id),
                    "group": scenario["group"].as_str().unwrap_or(&group),
                });
                if error.is_none()
                    && let Err(failure) = self.scenario(scenario, directory, renderer.as_ref(), &label, &mut entry)
                {
                    error = Some(format!("{failure:#}"));
                }
                if let Some(error) = error {
                    let fields = entry.as_object_mut().unwrap();
                    fields.remove("subject");
                    fields.remove("comparator");
                    fields.insert("error".into(), json!(error));
                }
                entry
            })
            .collect();
        Ok((title, entries))
    }
}
