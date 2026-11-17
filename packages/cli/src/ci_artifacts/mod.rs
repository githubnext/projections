//! CI artifacts as an extraction source: a commit CI already extracted with
//! the same definition is reused, verified, instead of extracted again.
//!
//! Artifacts come from directories the user names (`--artifact DIR`, such as
//! the Action's download of the merge base's artifact) and, when downloading
//! is enabled (`--ci`), from the repository's own successful GitHub Actions runs
//! for the commit, fetched with `gh` into the per-user cache
//! (`artifacts/<repository>/<run>`). Every reused extraction is verified: its
//! file's SHA-256 against the manifest, its own digest, a clean commit equal to
//! the one asked for, the projection, and the definition digest.
//!
//! Only an authenticated extraction is `official`: one downloaded from a run
//! GitHub's API identifies as the repository's own CI output ([`github`]), or
//! an imported one whose artifact attestation verifies and names such a run.
//! Any other imported extraction is reused but labelled imported
//! (`official: false`), because nothing confirms the run its manifest names.

mod github;

use crate::{artifact, runtime::Runner};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

const MANIFEST: &str = "projections.artifact.json";

/// The run an artifact came from, and how that was established:
/// `authentication` is `download` or `attestation`, or `None` for an
/// unauthenticated import whose manifest alone names the run.
#[derive(Clone)]
pub(crate) struct Origin {
    repository: String,
    run: u64,
    workflow: Option<String>,
    authentication: Option<&'static str>,
}

/// One extraction an artifact holds.
#[derive(Clone)]
struct Held {
    commit: String,
    id: String,
    digest: String,
    document: Value,
    origin: Origin,
}

/// The CI artifacts a runner may reuse.
#[derive(Default)]
pub struct Artifacts {
    directories: Vec<PathBuf>,
    download: bool,
    /// The workflow files whose runs' artifacts count (`ciWorkflows`); empty
    /// accepts those that use the Projections Action on the default branch.
    workflows: Vec<String>,
    index: Mutex<Option<Vec<Held>>>,
    attempted: Mutex<BTreeSet<String>>,
}

impl Artifacts {
    /// Artifacts in `directories`, and, when `download`, the repository's own
    /// CI runs' artifacts, from the workflow files `workflows` names.
    pub fn new(directories: Vec<PathBuf>, download: bool, workflows: Vec<String>) -> Self {
        Self {
            directories,
            download,
            workflows,
            ..Self::default()
        }
    }

    /// Whether any artifact source is configured.
    pub fn enabled(&self) -> bool {
        self.download || !self.directories.is_empty()
    }

    /// The verified extraction of projection `id` at `commit` with the
    /// definition digest `digest`, with `provenance.execution` naming its CI
    /// run and saying whether it is official (authenticated).
    pub fn find(&self, runner: &Runner, commit: &str, id: &str, digest: &str) -> Result<Option<Value>> {
        if !self.enabled() {
            return Ok(None);
        }
        let mut index = self.index.lock().expect("artifact index");
        if index.is_none() {
            *index = Some(self.load_all(runner)?);
        }
        // An authenticated extraction comes before an imported one.
        let matching = |held: &[Held]| {
            let mut candidates = held
                .iter()
                .filter(|held| held.commit == commit && held.id == id && held.digest == digest);
            let first = candidates.clone().find(|held| held.origin.authentication.is_some());
            first.or_else(|| candidates.next()).cloned()
        };
        let mut found = matching(index.as_ref().expect("index"));
        if found.as_ref().is_none_or(|held| held.origin.authentication.is_none())
            && self.download
            && self.attempted.lock().expect("attempts").insert(commit.to_owned())
            && let Some(directory) = github::GitHub::new(runner, &self.workflows)?.download(commit, &downloads(runner)?)?
        {
            let loaded = load(&directory, recorded(&directory, &self.workflows))?;
            index.as_mut().expect("index").extend(loaded);
            found = matching(index.as_ref().expect("index"));
        }
        let Some(held) = found else {
            return Ok(None);
        };
        let mut document = held.document;
        let previous = document["provenance"]["execution"].clone();
        let origin = held.origin;
        let mut ci = json!({"repository": origin.repository, "run": origin.run});
        if let Some(workflow) = origin.workflow {
            ci["workflow"] = json!(workflow);
        }
        if let Some(authentication) = origin.authentication {
            ci["authentication"] = json!(authentication);
        }
        // The run the repository's CI published is the commit's official
        // extraction; an unauthenticated import is reused, labelled imported.
        let mut execution = json!({
            "source": "ci",
            "fidelity": previous["fidelity"].as_str().unwrap_or("exact"),
            "official": origin.authentication.is_some(),
            "ci": ci,
        });
        for field in ["tree", "strategy", "prepared", "scope", "determinism", "environment", "at"] {
            if let Some(value) = previous.get(field) {
                execution[field] = value.clone();
            }
        }
        document["provenance"]["execution"] = execution;
        artifact::validate_extraction(&document).map(Some)
    }

    /// The extractions of the named directories (authenticated by their
    /// attestations when downloading is enabled) and of earlier downloads.
    fn load_all(&self, runner: &Runner) -> Result<Vec<Held>> {
        let github = (self.download && !self.directories.is_empty()).then(|| github::GitHub::new(runner, &self.workflows));
        let mut held = Vec::new();
        for directory in &self.directories {
            let manifest_path = directory.join(MANIFEST);
            let manifest = manifest(directory)?;
            let claimed = Origin {
                repository: format!(
                    "{}/{}",
                    manifest["repository"]["owner"].as_str().unwrap_or("unknown"),
                    manifest["repository"]["name"].as_str().unwrap_or("unknown")
                ),
                run: manifest["run"]["id"].as_u64().unwrap_or(0).max(1),
                workflow: None,
                authentication: None,
            };
            let origin = match &github {
                Some(Ok(github)) => github.attested(&manifest_path, &manifest).unwrap_or_else(|error| {
                    eprintln!(
                        "projections: note: {} is reused as imported, not official: its attestation isn't verified ({error:#})",
                        directory.display()
                    );
                    claimed
                }),
                _ => claimed,
            };
            held.extend(extractions(directory, &manifest, &origin)?);
        }
        for directory in cached(runner) {
            if let Some(origin) = recorded(&directory, &self.workflows) {
                held.extend(load(&directory, Some(origin))?);
            }
        }
        Ok(held)
    }
}

/// Where the run a download came from is recorded: beside it, outside the
/// artifact's own files.
fn record_path(directory: &Path) -> PathBuf {
    directory.with_extension("json")
}

/// The run `directory` was downloaded from, as recorded when GitHub's API
/// identified it, if its workflow is still accepted. A download without a
/// record (from an earlier version, which didn't check the run) isn't used.
fn recorded(directory: &Path, workflows: &[String]) -> Option<Origin> {
    let record: Value = serde_json::from_slice(&fs::read(record_path(directory)).ok()?).ok()?;
    let workflow = record["workflow"].as_str()?.to_owned();
    let named = |named: &String| *named == workflow || workflow.rsplit('/').next() == Some(named.as_str());
    if !workflows.is_empty() && !workflows.iter().any(named) {
        return None;
    }
    Some(Origin {
        repository: record["repository"].as_str()?.to_owned(),
        run: record["run"].as_u64().filter(|run| *run > 0)?,
        workflow: Some(workflow),
        authentication: Some("download"),
    })
}

/// Previously downloaded artifacts of this repository.
fn cached(runner: &Runner) -> Vec<PathBuf> {
    let Ok(directory) = downloads(runner) else {
        return Vec::new();
    };
    fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.join(MANIFEST).is_file())
        .collect()
}

fn downloads(runner: &Runner) -> Result<PathBuf> {
    Ok(runner
        .cache_base()?
        .join("artifacts")
        .join(crate::extraction_cache::repository_name(&runner.common_directory()?)))
}

/// An artifact directory's manifest. A directory without one, or with an
/// invalid one, is an error naming it.
fn manifest(directory: &Path) -> Result<Value> {
    let manifest_path = directory.join(MANIFEST);
    let manifest = artifact::parse(std::str::from_utf8(&artifact::read_artifact(&manifest_path, 1024 * 1024)?)?)
        .with_context(|| format!("Invalid CI artifact manifest {}", manifest_path.display()))?;
    ensure!(
        manifest["format"] == "projections.artifact" && manifest["version"] == 0,
        "{} is not a projections.artifact manifest",
        manifest_path.display()
    );
    Ok(manifest)
}

/// The extractions a downloaded artifact directory holds, from the run
/// `origin` names; none without one.
fn load(directory: &Path, origin: Option<Origin>) -> Result<Vec<Held>> {
    let Some(origin) = origin else {
        return Ok(Vec::new());
    };
    extractions(directory, &manifest(directory)?, &origin)
}

/// The extractions an artifact directory holds, each checked against the
/// manifest's SHA-256 and its own digest.
fn extractions(directory: &Path, manifest: &Value, origin: &Origin) -> Result<Vec<Held>> {
    let manifest_path = directory.join(MANIFEST);
    let path = regex::Regex::new(r"^projections/[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}\.json$")?;
    let mut held = Vec::new();
    for entry in manifest["projections"].as_array().into_iter().flatten() {
        let (Some(file), Some(sha256), Some(id)) = (entry["path"].as_str(), entry["sha256"].as_str(), entry["id"].as_str()) else {
            continue;
        };
        ensure!(path.is_match(file), "Invalid document path {file} in {}", manifest_path.display());
        let bytes = artifact::read_artifact(&directory.join(file), 32 * 1024 * 1024)?;
        if artifact::byte_sha256(&bytes) != sha256 {
            // A document that fails its own checks is skipped, never used.
            continue;
        }
        let Ok(document) = artifact::parse(std::str::from_utf8(&bytes)?) else {
            continue;
        };
        let sides = match document["format"].as_str() {
            Some("projections.extraction") => vec![document],
            Some("projections.comparison") => {
                vec![document["before"].clone(), document["after"].clone()]
            }
            _ => continue,
        };
        for side in sides {
            let Ok(side) = artifact::validate_extraction(&side) else {
                continue;
            };
            let revision = &side["provenance"]["revision"];
            if revision["kind"] != "commit" || revision["dirty"] != false || side["projection"]["id"] != id {
                continue;
            }
            held.push(Held {
                commit: revision["commit"].as_str().unwrap_or_default().to_owned(),
                id: id.to_owned(),
                digest: side["provenance"]["definitionDigest"].as_str().unwrap_or_default().to_owned(),
                document: side,
                origin: origin.clone(),
            });
        }
    }
    Ok(held)
}

/// The GitHub host and `OWNER/REPO` of this checkout's `origin` remote.
pub fn origin(runner: &Runner) -> Result<(String, String)> {
    let root = runner.repository_root()?;
    let remote = runner
        .git_text(&root, &["remote", "get-url", "origin"])
        .context("This checkout has no origin remote, so its CI artifacts can't be found")?;
    let remote = remote.trim_end_matches(".git");
    let path = remote
        .strip_prefix("git@")
        .map(|rest| rest.replacen(':', "/", 1))
        .or_else(|| {
            remote
                .split_once("://")
                .map(|(_, rest)| rest.rsplit_once('@').map_or(rest, |(_, rest)| rest).to_owned())
        })
        .with_context(|| format!("Can't read a GitHub repository from the origin remote {remote}"))?;
    let parts: Vec<&str> = path.split('/').collect();
    let [host, owner, name] = parts[..] else {
        anyhow::bail!("Can't read a GitHub repository from the origin remote {remote}");
    };
    Ok((host.to_owned(), format!("{owner}/{name}")))
}
