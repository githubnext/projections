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

/// One extraction an artifact holds.
#[derive(Clone)]
struct Held {
    commit: String,
    id: String,
    digest: String,
    document: Value,
    repository: String,
    run: u64,
}

/// The CI artifacts a runner may reuse.
#[derive(Default)]
pub struct Artifacts {
    directories: Vec<PathBuf>,
    download: bool,
    index: Mutex<Option<Vec<Held>>>,
    attempted: Mutex<BTreeSet<String>>,
}

impl Artifacts {
    /// Artifacts in `directories`, and, when `download`, the repository's own
    /// CI runs' artifacts.
    pub fn new(directories: Vec<PathBuf>, download: bool) -> Self {
        Self {
            directories,
            download,
            ..Self::default()
        }
    }

    /// Whether any artifact source is configured.
    pub fn enabled(&self) -> bool {
        self.download || !self.directories.is_empty()
    }

    /// The verified extraction of projection `id` at `commit` with the
    /// definition digest `digest`, with `provenance.execution` naming its CI run.
    pub fn find(&self, runner: &Runner, commit: &str, id: &str, digest: &str) -> Result<Option<Value>> {
        if !self.enabled() {
            return Ok(None);
        }
        let mut index = self.index.lock().expect("artifact index");
        if index.is_none() {
            let mut held = Vec::new();
            for directory in self.directories.iter().cloned().chain(cached(runner)) {
                held.extend(load(&directory)?);
            }
            *index = Some(held);
        }
        let matching = |held: &[Held]| {
            held.iter()
                .find(|held| held.commit == commit && held.id == id && held.digest == digest)
                .cloned()
        };
        let mut found = matching(index.as_ref().expect("index"));
        if found.is_none()
            && self.download
            && self.attempted.lock().expect("attempts").insert(commit.to_owned())
            && let Some(directory) = download(runner, commit)?
        {
            let loaded = load(&directory)?;
            index.as_mut().expect("index").extend(loaded);
            found = matching(index.as_ref().expect("index"));
        }
        let Some(held) = found else {
            return Ok(None);
        };
        let mut document = held.document;
        let previous = document["provenance"]["execution"].clone();
        // The run CI published is the commit's official extraction.
        let mut execution = json!({
            "source": "ci",
            "fidelity": previous["fidelity"].as_str().unwrap_or("exact"),
            "official": true,
            "ci": {"repository": held.repository, "run": held.run},
        });
        for field in ["tree", "strategy", "prepared", "scope", "determinism", "environment", "at"] {
            if let Some(value) = previous.get(field) {
                execution[field] = value.clone();
            }
        }
        document["provenance"]["execution"] = execution;
        artifact::validate_extraction(&document).map(Some)
    }
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

/// The extractions an artifact directory holds, each checked against the
/// manifest's SHA-256 and its own digest. A directory without a manifest, or
/// with an invalid one, is an error naming it.
fn load(directory: &Path) -> Result<Vec<Held>> {
    let manifest_path = directory.join(MANIFEST);
    let manifest = artifact::parse(std::str::from_utf8(&artifact::read_artifact(&manifest_path, 1024 * 1024)?)?)
        .with_context(|| format!("Invalid CI artifact manifest {}", manifest_path.display()))?;
    ensure!(
        manifest["format"] == "projections.artifact" && manifest["version"] == 0,
        "{} is not a projections.artifact manifest",
        manifest_path.display()
    );
    let repository = format!(
        "{}/{}",
        manifest["repository"]["owner"].as_str().unwrap_or("unknown"),
        manifest["repository"]["name"].as_str().unwrap_or("unknown")
    );
    let run = manifest["run"]["id"].as_u64().unwrap_or(0).max(1);
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
                repository: repository.clone(),
                run,
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

/// Downloads the `projections` artifact of the newest successful run of this
/// repository's workflows for `commit`, if there is one, with `gh`.
fn download(runner: &Runner, commit: &str) -> Result<Option<PathBuf>> {
    let (host, repository) = origin(runner)?;
    let environment = runner.environment(&[
        "HOME".into(),
        "GH_TOKEN".into(),
        "GITHUB_TOKEN".into(),
        "GH_ENTERPRISE_TOKEN".into(),
        "GH_CONFIG_DIR".into(),
        "XDG_CONFIG_HOME".into(),
        "APPDATA".into(),
        "LOCALAPPDATA".into(),
        "USERPROFILE".into(),
        "PROJECTIONS_GH".into(),
    ])?;
    // `PROJECTIONS_GH` names another gh executable.
    let program = environment.get("PROJECTIONS_GH").cloned().unwrap_or_else(|| "gh".into());
    let root = runner.repository_root()?;
    let gh = |arguments: &[String]| -> Result<String> {
        let mut argv = vec![program.clone()];
        argv.extend_from_slice(arguments);
        Ok(runner
            .run_argv(&argv, &root, None, 60_000, &environment)
            .with_context(|| format!("gh {} failed", arguments.join(" ")))?
            .stdout)
    };
    let api = |path: String| -> Result<Value> { artifact::parse(&gh(&["api".into(), "--hostname".into(), host.clone(), path])?) };
    let runs = api(format!(
        "repos/{repository}/actions/runs?head_sha={commit}&status=success&per_page=20"
    ))?;
    for run in runs["workflow_runs"].as_array().into_iter().flatten() {
        let Some(id) = run["id"].as_u64() else {
            continue;
        };
        let artifacts = api(format!("repos/{repository}/actions/runs/{id}/artifacts?name=projections"))?;
        let available = artifacts["artifacts"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|artifact| artifact["expired"] != true);
        if !available {
            continue;
        }
        let base = downloads(runner)?;
        let target = base.join(id.to_string());
        if target.join(MANIFEST).is_file() {
            return Ok(Some(target));
        }
        crate::cache::private_directory(&base)?;
        let staging = tempfile::Builder::new().prefix(".staging-").tempdir_in(&base)?;
        gh(&[
            "run".into(),
            "download".into(),
            id.to_string(),
            "--repo".into(),
            format!("{host}/{repository}"),
            "--name".into(),
            "projections".into(),
            "--dir".into(),
            staging.path().to_string_lossy().into_owned(),
        ])?;
        let staged = staging.keep();
        if fs::rename(&staged, &target).is_err() {
            let _ = fs::remove_dir_all(&staged);
        }
        return Ok(target.join(MANIFEST).is_file().then_some(target));
    }
    Ok(None)
}
