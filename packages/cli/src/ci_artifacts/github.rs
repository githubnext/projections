//! GitHub's side of CI artifacts, through `gh`: which runs' artifacts are the
//! repository's own CI output, downloading one, and authenticating an imported
//! artifact by its attestation.
//!
//! A run's artifact is the repository's own CI output only when GitHub's API
//! says the run succeeded, ran in this repository for a `push` or a
//! `pull_request` whose head is this repository (never a fork), and ran a
//! workflow file of this repository that runs the Projections Action: one the
//! user configuration's `ciWorkflows` (or `--ci-workflow`) names, else one
//! whose file on the default branch uses `githubnext/projections`.

use super::Origin;
use crate::{artifact, runtime::Runner};
use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

/// The events the Projections Action runs on.
const EVENTS: [&str; 2] = ["push", "pull_request"];

/// `gh` for this checkout's `origin` repository.
pub struct GitHub<'a> {
    runner: &'a Runner,
    host: String,
    repository: String,
    program: String,
    environment: BTreeMap<String, String>,
    root: PathBuf,
    workflows: &'a [String],
    /// Whether a workflow file on the default branch uses the Action, by path.
    uses_action: RefCell<BTreeMap<String, bool>>,
}

impl<'a> GitHub<'a> {
    /// `gh` for the `origin` repository, accepting the workflow files
    /// `workflows` names (paths or file names), or, when it names none, those
    /// that use the Projections Action on the default branch.
    pub fn new(runner: &'a Runner, workflows: &'a [String]) -> Result<Self> {
        let (host, repository) = super::origin(runner)?;
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
        Ok(Self {
            runner,
            host,
            repository,
            program,
            environment,
            root: runner.repository_root()?,
            workflows,
            uses_action: RefCell::default(),
        })
    }

    /// The host and `OWNER/REPO` it reads.
    pub fn origin(&self) -> (&str, &str) {
        (&self.host, &self.repository)
    }

    fn gh(&self, arguments: &[&str]) -> Result<String> {
        let mut argv = vec![self.program.clone()];
        argv.extend(arguments.iter().map(|argument| (*argument).to_owned()));
        Ok(self
            .runner
            .run_argv(&argv, &self.root, None, 60_000, &self.environment)
            .with_context(|| format!("gh {} failed", arguments.join(" ")))?
            .stdout)
    }

    fn api(&self, path: &str) -> Result<Value> {
        artifact::parse(&self.gh(&["api", "--hostname", &self.host, path])?)
    }

    /// The workflow file of `run` (an Actions run from GitHub's API) when its
    /// artifact is this repository's own CI output, with the basis it was
    /// accepted on ([`Basis`]), else `None`.
    pub fn accepted(&self, run: &Value) -> Option<(String, Basis)> {
        let workflow = candidate(run, &self.repository)?;
        let basis = if self.workflows.is_empty() {
            self.runs_action(&workflow).then_some(Basis::UsesAction)
        } else {
            names(self.workflows, &workflow).then_some(Basis::Configured)
        };
        basis.map(|basis| (workflow, basis))
    }

    /// Whether the workflow file at `path` on the default branch uses the
    /// Projections Action.
    fn runs_action(&self, path: &str) -> bool {
        if let Some(known) = self.uses_action.borrow().get(path) {
            return *known;
        }
        let action = regex::Regex::new(r#"(?m)^\s*(?:-\s+)?uses:\s*["']?githubnext/projections@"#).expect("pattern");
        // Without a ref, the contents API reads the default branch.
        let uses = self
            .gh(&[
                "api",
                "--hostname",
                &self.host,
                "-H",
                "Accept: application/vnd.github.raw+json",
                &format!("repos/{}/contents/{path}", self.repository),
            ])
            .is_ok_and(|text| action.is_match(&text));
        self.uses_action.borrow_mut().insert(path.to_owned(), uses);
        uses
    }

    /// Downloads into `base/<run>` the `name` artifact of the newest
    /// successful run for `commit` whose artifact is this repository's own CI
    /// output, recording the run beside it (`base/<run>.json`).
    pub fn download(&self, commit: &str, base: &Path) -> Result<Option<PathBuf>> {
        let runs = self.api(&format!(
            "repos/{}/actions/runs?head_sha={commit}&status=success&per_page=20",
            self.repository
        ))?;
        for run in runs["workflow_runs"].as_array().into_iter().flatten() {
            let Some(id) = run["id"].as_u64().filter(|id| *id > 0) else {
                continue;
            };
            let Some((workflow, basis)) = self.accepted(run) else {
                continue;
            };
            let artifacts = self.api(&format!("repos/{}/actions/runs/{id}/artifacts?name=projections", self.repository))?;
            let available = artifacts["artifacts"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|artifact| artifact["name"] == "projections" && artifact["expired"] != true);
            if !available {
                continue;
            }
            let target = base.join(id.to_string());
            crate::cache::private_directory(base)?;
            if !target.join(super::MANIFEST).is_file() {
                let staging = tempfile::Builder::new().prefix(".staging-").tempdir_in(base)?;
                let directory = staging.path().to_string_lossy().into_owned();
                let repository = format!("{}/{}", self.host, self.repository);
                let run = id.to_string();
                self.gh(&[
                    "run",
                    "download",
                    &run,
                    "--repo",
                    &repository,
                    "--name",
                    "projections",
                    "--dir",
                    &directory,
                ])?;
                let staged = staging.keep();
                if fs::rename(&staged, &target).is_err() {
                    let _ = fs::remove_dir_all(&staged);
                }
            }
            if !target.join(super::MANIFEST).is_file() {
                return Ok(None);
            }
            // The record, not the artifact's own manifest, says whose run it is,
            // and on what basis its workflow was accepted.
            let record = json!({"host": self.host, "repository": self.repository, "run": id,
                "workflow": workflow, "basis": basis.as_str()});
            fs::write(super::record_path(&target), serde_json::to_vec(&record)?)?;
            return Ok(Some(target));
        }
        Ok(None)
    }

    /// The run that published the imported artifact whose manifest is at
    /// `path`, when its attestation verifies (`gh attestation verify`) and
    /// names a run whose artifact is this repository's own CI output.
    pub fn attested(&self, path: &Path, manifest: &Value) -> Result<Origin> {
        let claimed = format!(
            "{}/{}",
            manifest["repository"]["owner"].as_str().unwrap_or_default(),
            manifest["repository"]["name"].as_str().unwrap_or_default()
        );
        anyhow::ensure!(
            claimed.eq_ignore_ascii_case(&self.repository),
            "its manifest names {claimed}, not {}",
            self.repository
        );
        let id = manifest["run"]["id"]
            .as_u64()
            .filter(|id| *id > 0)
            .context("its manifest names no run")?;
        let file = path.to_string_lossy();
        let verified = artifact::parse(&self.gh(&[
            "attestation",
            "verify",
            &file,
            "--repo",
            &self.repository,
            "--hostname",
            &self.host,
            "--format",
            "json",
        ])?)?;
        let prefix = format!("https://{}/{}", self.host, self.repository).to_ascii_lowercase();
        let signed = verified
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|result| signed_workflow(&result["verificationResult"]["signature"]["certificate"], &prefix, id))
            .collect::<Vec<_>>();
        anyhow::ensure!(!signed.is_empty(), "no attestation names run {id} of {}", self.repository);
        let run = self.api(&format!("repos/{}/actions/runs/{id}", self.repository))?;
        anyhow::ensure!(run["conclusion"] == "success", "run {id} didn't succeed");
        let (workflow, _) = self
            .accepted(&run)
            .with_context(|| format!("run {id} isn't this repository's own Projections workflow"))?;
        anyhow::ensure!(signed.contains(&workflow), "run {id}'s attestation names another workflow");
        Ok(Origin {
            repository: self.repository.clone(),
            run: id,
            workflow: Some(workflow),
            authentication: Some("attestation"),
        })
    }
}

/// Why a run's workflow file was accepted: the configuration named it
/// (`ciWorkflows`, `--ci-workflow`), or, with none named, its file on the
/// default branch uses the Projections Action.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Basis {
    Configured,
    UsesAction,
}

impl Basis {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Configured => "configured",
            Self::UsesAction => "uses-action",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "configured" => Some(Self::Configured),
            "uses-action" => Some(Self::UsesAction),
            _ => None,
        }
    }
}

/// Whether `workflows` (paths or file names) names the workflow file `workflow`.
pub fn names(workflows: &[String], workflow: &str) -> bool {
    workflows
        .iter()
        .any(|named| named == workflow || workflow.rsplit('/').next() == Some(named.as_str()))
}

/// The workflow file of `run` when it ran in `repository` for one of the
/// Action's events, with this repository (not a fork) as its head.
pub fn candidate(run: &Value, repository: &str) -> Option<String> {
    let same = |field: &str| {
        run[field]["full_name"]
            .as_str()
            .is_some_and(|name| name.eq_ignore_ascii_case(repository))
    };
    if !same("repository") || !same("head_repository") || !EVENTS.contains(&run["event"].as_str()?) {
        return None;
    }
    let path = run["path"].as_str()?;
    let path = path.split_once('@').map_or(path, |(path, _)| path);
    let workflow = regex::Regex::new(r"^\.github/workflows/[A-Za-z0-9._-]+\.ya?ml$").expect("pattern");
    workflow.is_match(path).then(|| path.to_owned())
}

/// The workflow file an attestation's signing certificate names, when it was
/// signed by run `id` of the repository at `prefix` for one of the Action's
/// events.
fn signed_workflow(certificate: &Value, prefix: &str, id: u64) -> Option<String> {
    let text = |field: &str| certificate[field].as_str().unwrap_or_default();
    if text("sourceRepositoryURI").to_ascii_lowercase() != prefix || !EVENTS.contains(&text("githubWorkflowTrigger")) {
        return None;
    }
    let invocation = text("runInvocationURI");
    let run = invocation
        .get(..prefix.len())
        .filter(|start| start.eq_ignore_ascii_case(prefix))
        .and_then(|_| invocation[prefix.len()..].strip_prefix("/actions/runs/"))?;
    let run = run.split_once("/attempts/").map_or(run, |(run, _)| run);
    if run.parse::<u64>().ok()? != id {
        return None;
    }
    let config = text("buildConfigURI");
    let workflow = config
        .get(..prefix.len())
        .filter(|start| start.eq_ignore_ascii_case(prefix))
        .and_then(|_| config[prefix.len()..].strip_prefix('/'))?;
    Some(workflow.split_once('@').map_or(workflow, |(path, _)| path).to_owned())
}

#[cfg(test)]
mod tests;
