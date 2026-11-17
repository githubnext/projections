//! Discovering and validating the projection definitions a revision holds.

use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
};

use anyhow::{Context, Result, anyhow, bail, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::{ENVIRONMENT_FILE, Runner, definition_directories, revision::Revision};
use crate::{artifact, collectors};

impl Runner {
    pub(super) fn definitions(&self, revision: &Revision) -> Result<Vec<Value>> {
        Ok(self.scan(revision)?.0)
    }

    /// The valid definitions in a revision's definition directories (or the
    /// built-in defaults when it has no definition files), and each definition
    /// file that isn't valid, with its diagnostics: one invalid file never hides
    /// the others.
    fn scan(&self, revision: &Revision) -> Result<(Vec<Value>, Vec<Value>)> {
        let mut definitions = BTreeMap::new();
        let mut invalid = Vec::new();
        for relative in definition_directories() {
            // A symlinked definition directory, or parent of one, is refused.
            let mut parent = String::new();
            for component in relative.split('/') {
                if !parent.is_empty() {
                    parent.push('/');
                }
                parent.push_str(component);
                ensure!(
                    !revision.entries.contains_key(&parent),
                    "Definition path must be a regular directory"
                );
            }
            let prefix = format!("{relative}/");
            let names: Vec<String> = revision
                .files
                .iter()
                .filter(|file| {
                    file.strip_prefix(&prefix)
                        .is_some_and(|name| !name.contains('/') && name.ends_with(".json") && name != ENVIRONMENT_FILE)
                })
                .cloned()
                .collect();
            let contents = self.read_files(revision, &names, 1024 * 1024)?;
            for (file, raw) in names.into_iter().zip(contents) {
                let path = PathBuf::from(&file);
                let text = String::from_utf8_lossy(&raw).into_owned();
                let parsed = artifact::parse(&text);
                let checked = parsed
                    .as_ref()
                    .map_err(|error| anyhow!("{error:#}"))
                    .and_then(artifact::validate_definition)
                    .and_then(|definition| {
                        crate::project::check(&definition)?;
                        let id = definition["id"].as_str().context("Missing projection ID")?.to_owned();
                        ensure!(
                            !definitions.contains_key(&id),
                            "Duplicate projection {id}: another definition file defines it"
                        );
                        Ok((id, definition))
                    });
                match checked {
                    Ok((id, definition)) => {
                        definitions.insert(id, definition);
                    }
                    Err(error) => {
                        let id = parsed
                            .ok()
                            .and_then(|value| value["id"].as_str().map(str::to_owned))
                            .or_else(|| path.file_stem().map(|stem| stem.to_string_lossy().into_owned()));
                        invalid.push(invalid_definition(&file, &text, id, &error));
                    }
                }
            }
        }
        for trial in self.trials.iter() {
            let id = trial["id"].as_str().unwrap_or_default().to_owned();
            definitions.entry(id).or_insert_with(|| trial.clone());
        }
        // A repository whose definition files are all invalid defines projections
        // (broken ones), so the defaults don't stand in for them.
        Ok(if definitions.is_empty() && !invalid.is_empty() {
            (Vec::new(), invalid)
        } else if definitions.is_empty() {
            // The workspace-dependencies default fails without a root package.json,
            // so it only applies to revisions that have one.
            let manifest = revision.is_regular(&crate::project::path("package.json"));
            let defaults = collectors::default_definitions()
                .into_iter()
                .filter(|definition| manifest || definition["extractor"] != "workspace-dependencies")
                .collect();
            (defaults, invalid)
        } else {
            (definitions.into_values().collect(), invalid)
        })
    }

    /// The valid definitions at a revision and its invalid definition files
    /// (see `scan`).
    pub fn discover_all(&self, reference: &str) -> Result<(Vec<Value>, Vec<Value>)> {
        let revision = self.capture_paths(reference, Some(&definition_paths()))?;
        self.scan(&revision)
    }

    /// The definitions at a revision, reading only the definition directories.
    pub fn discover(&self, reference: &str) -> Result<Vec<Value>> {
        let revision = self.capture_paths(reference, Some(&definition_paths()))?;
        self.definitions(&revision)
    }

    /// The validated definitions at a revision, with their execution policy,
    /// without running anything.
    pub fn list(&self, reference: &str) -> Result<Value> {
        let revision = self.capture_paths(reference, Some(&definition_paths()))?;
        let (definitions, invalid) = self.scan(&revision)?;
        let projections = definitions
            .into_iter()
            .map(|definition| {
                let mut item = json!({"id": definition["id"],
                    "title": definition.get("title").unwrap_or(&definition["id"]),
                    "renderer": definition["renderer"]});
                for (key, value) in self.policy(&definition, reference)?.as_object().context("Invalid policy")? {
                    item[key] = value.clone();
                }
                item["definition"] = definition;
                Ok(item)
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(json!({"format": "projections.list", "version": 0,
            "revision": revision.repository, "projections": projections, "invalid": invalid}))
    }

    pub(super) fn definition(&self, revision: &Revision, id: &str) -> Result<Value> {
        let (definitions, invalid) = self.scan(revision)?;
        if let Some(failure) = invalid.iter().find(|failure| failure["id"] == id) {
            bail!("{}", invalid_summary(failure));
        }
        definitions
            .into_iter()
            .find(|definition| definition["id"] == id)
            .or_else(|| builtin_default(id))
            .with_context(|| format!("Projection {id} is not defined in {}", revision.repository["ref"]))
    }

    /// Whether a revision defines projection `id`, validly or not; a built-in
    /// default always counts.
    pub(super) fn has_definition(&self, revision: &Revision, id: &str) -> bool {
        self.definition(revision, id).is_ok()
            || self
                .scan(revision)
                .is_ok_and(|(_, invalid)| invalid.iter().any(|failure| failure["id"] == id))
    }

    /// `sha256:` digest of the canonical definition, its project when it isn't
    /// the repository's root (its paths are relative to it, so a definition
    /// means something else in another project), and, in sorted order, the
    /// repository path and bytes of every file under its declared component sources.
    pub(super) fn definition_digest(&self, definition: &Value, revision: &Revision) -> Result<String> {
        let mut hasher = Sha256::new();
        hasher.update(
            projections_engine::canonical(&artifact::semantic_definition(definition))
                .map_err(|failure| anyhow!("Cannot canonicalize the definition: {}", failure[0]))?,
        );
        let project = crate::project::prefix();
        if !project.is_empty() {
            hasher.update(b"\0project\0");
            hasher.update(project.as_bytes());
        }
        let mut files = BTreeSet::new();
        for source in artifact::definition_sources(definition) {
            revision.require_materialized(&source, "Declared source")?;
            let before = files.len();
            for filename in &revision.files {
                if filename == &source || filename.starts_with(&format!("{source}/")) {
                    files.insert(filename.clone());
                }
            }
            ensure!(
                files.len() > before || revision.files.iter().any(|name| name == &source),
                "Declared source {source} does not exist in {}",
                revision.repository["ref"]
            );
        }
        let files: Vec<String> = files.into_iter().collect();
        let contents = self.read_entries(revision, &files)?;
        for (filename, bytes) in files.iter().zip(contents) {
            hasher.update(b"\0");
            hasher.update(filename.as_bytes());
            hasher.update(b"\0");
            hasher.update((bytes.len() as u64).to_be_bytes());
            hasher.update(&bytes);
        }
        Ok(format!("sha256:{:x}", hasher.finalize()))
    }

    /// What using a definition at `reference` requires, shared by `list` and
    /// the Inspector: `requiresTrust` when its extractor runs repository code,
    /// `rendererRequiresTrust` when its custom renderer needs explicit trust.
    pub fn policy(&self, definition: &Value, reference: &str) -> Result<Value> {
        Ok(json!({
            "requiresTrust": collectors::requires_trust(definition),
            "rendererRequiresTrust": self.renderer_requires_trust(definition, reference)?,
        }))
    }
}

/// The built-in default definition `id` (`workspace-dependencies`,
/// `repository-map`). A repository that defines its own projections no longer
/// lists them, but they stay addressable by ID until a definition of its own
/// uses that ID.
fn builtin_default(id: &str) -> Option<Value> {
    collectors::default_definitions()
        .into_iter()
        .find(|definition| definition["id"] == id)
}

/// The definition directories, plus the project's `package.json` that decides
/// whether the `workspace-dependencies` default applies.
pub(super) fn definition_paths() -> Vec<String> {
    definition_directories()
        .into_iter()
        .chain([crate::project::path("package.json")])
        .collect()
}

/// An invalid definition file: `{id, path, diagnostics}`, each diagnostic with
/// the offending field's pointer and location when it is known.
fn invalid_definition(file: &str, text: &str, id: Option<String>, error: &anyhow::Error) -> Value {
    let pointer = artifact::error_pointer(error);
    let (line, column) = pointer
        .as_deref()
        .and_then(|pointer| artifact::locate(text, pointer))
        .unwrap_or((1, 1));
    let mut diagnostic = json!({"code": "INVALID_DEFINITION", "severity": "error",
        "message": format!("{error:#}"), "path": file,
        "location": {"path": file, "line": line, "column": column}});
    if let Some(pointer) = pointer {
        diagnostic["pointer"] = json!(pointer);
    }
    json!({"id": id, "path": file, "diagnostics": [diagnostic]})
}

/// An invalid definition file as one line: `path:line:column: message`.
pub fn invalid_summary(failure: &Value) -> String {
    failure["diagnostics"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|diagnostic| {
            let location = &diagnostic["location"];
            format!(
                "{}:{}:{}: {}",
                location["path"].as_str().unwrap_or_default(),
                location["line"],
                location["column"],
                diagnostic["message"].as_str().unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}
