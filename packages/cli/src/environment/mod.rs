//! A repository's declared environment: how to make a checkout usable for its
//! toolchain extractors, as its CI does (`.github/projections/environment.json`
//! or `.projections/environment.json`).
//!
//! `prepare` steps (such as `npm ci`) run in a workspace before a toolchain
//! extractor runs there, each only when the hash of its key files (typically
//! lockfiles) changed since its last successful run there. They run repository
//! code, so they need trust exactly as extractors do; unlike extraction they may
//! use the network. Nothing runs in the user's working tree unless asked
//! (`projections prepare`), as with tests.

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

mod run;

pub use run::{Options, PrepareTrustRequired, Records, blobs, checkout_keys, files, keys, prepare, status};

/// The environment file's name in a definition directory.
pub const FILE: &str = "environment.json";
/// A step's default timeout: ten minutes.
const DEFAULT_TIMEOUT_MS: u64 = 600_000;
/// The longest a step may run: an hour.
const MAX_TIMEOUT_MS: u64 = 3_600_000;
/// One prepare step.
#[derive(Clone, Debug, PartialEq)]
pub struct Step {
    pub id: String,
    pub run: Vec<String>,
    pub key: Vec<String>,
    pub directory: String,
    pub environment: Vec<String>,
    pub timeout_ms: u64,
}

/// A validated environment file.
#[derive(Clone, Debug)]
pub struct Environment {
    /// Its repository-relative path.
    pub path: String,
    pub prepare: Vec<Step>,
    pub toolchain: Vec<Vec<String>>,
    /// The team's workspace strategy, if it names one.
    pub strategy: Option<String>,
    pub devcontainer: Option<String>,
}

fn relative(value: &str, label: &str) -> Result<String> {
    let value = value.trim_end_matches('/');
    if value.is_empty() || value == "." {
        return Ok(".".into());
    }
    ensure!(
        !value.starts_with('/')
            && !value.contains(['\\', '\0'])
            && value.split('/').all(|part| !part.is_empty() && part != "." && part != ".."),
        "{label} must be a repository-relative path: {value}"
    );
    Ok(value.to_owned())
}

fn argv(value: &Value, label: &str) -> Result<Vec<String>> {
    let items = value.as_array().with_context(|| format!("{label} must be an argv array"))?;
    ensure!((1..=100).contains(&items.len()), "{label} must be an argv of 1-100 strings");
    let argv = items
        .iter()
        .map(|item| {
            item.as_str()
                .filter(|item| !item.contains('\0'))
                .map(str::to_owned)
                .with_context(|| format!("{label} must hold strings without NUL"))
        })
        .collect::<Result<Vec<_>>>()?;
    ensure!(!argv[0].is_empty(), "{label}[0] must name a program");
    Ok(argv)
}

fn only(value: &Value, allowed: &[&str], label: &str) -> Result<()> {
    let object = value.as_object().with_context(|| format!("{label} must be an object"))?;
    for key in object.keys() {
        ensure!(allowed.contains(&key.as_str()), "{label} has unknown field {key}");
    }
    Ok(())
}

/// Parses and validates an environment file's text.
pub fn parse(path: &str, text: &str) -> Result<Environment> {
    let value = crate::artifact::parse(text).with_context(|| format!("Invalid {path}"))?;
    validate(path, &value).with_context(|| format!("Invalid {path}"))
}

/// Validates an environment document.
pub fn validate(path: &str, value: &Value) -> Result<Environment> {
    only(
        value,
        &["$schema", "format", "version", "prepare", "toolchain", "workspace", "devcontainer"],
        "The environment",
    )?;
    ensure!(
        value["format"] == "projections.environment" && value["version"] == 0,
        "format must be projections.environment and version 0"
    );
    let identifier = regex::Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$")?;
    let variable = regex::Regex::new(r"^[A-Za-z_][A-Za-z0-9_]*$")?;
    let mut prepare = Vec::new();
    let mut ids = BTreeSet::new();
    if let Some(steps) = value.get("prepare") {
        let steps = steps.as_array().context("prepare must be an array")?;
        ensure!(steps.len() <= 20, "prepare holds at most 20 steps");
        for (index, step) in steps.iter().enumerate() {
            prepare.push(prepare_step(step, index, &identifier, &variable, &mut ids)?);
        }
    }
    let toolchain = match value.get("toolchain") {
        None => Vec::new(),
        Some(commands) => {
            let commands = commands.as_array().context("toolchain must be an array")?;
            ensure!(commands.len() <= 10, "toolchain holds at most 10 commands");
            commands
                .iter()
                .enumerate()
                .map(|(index, command)| argv(command, &format!("toolchain[{index}]")))
                .collect::<Result<Vec<_>>>()?
        }
    };
    let strategy = match value.get("workspace") {
        None => None,
        Some(workspace) => {
            only(workspace, &["strategy"], "workspace")?;
            let strategy = workspace["strategy"]
                .as_str()
                .filter(|strategy| crate::workspaces::Strategy::parse(strategy).is_some())
                .context("workspace.strategy must be fresh, worktree, clone, sparse or none")?;
            Some(strategy.to_owned())
        }
    };
    let devcontainer = value
        .get("devcontainer")
        .map(|path| relative(path.as_str().context("devcontainer must be a path")?, "devcontainer"))
        .transpose()?;
    Ok(Environment {
        path: path.to_owned(),
        prepare,
        toolchain,
        strategy,
        devcontainer,
    })
}

/// One prepare step, `prepare[index]`, whose ID must not be among `ids`.
fn prepare_step(
    step: &Value,
    index: usize,
    identifier: &regex::Regex,
    variable: &regex::Regex,
    ids: &mut BTreeSet<String>,
) -> Result<Step> {
    let label = format!("prepare[{index}]");
    only(step, &["id", "run", "key", "directory", "environment", "timeoutMs"], &label)?;
    let id = step["id"]
        .as_str()
        .filter(|id| identifier.is_match(id))
        .with_context(|| format!("{label}.id must be 1-100 filename-safe characters"))?;
    ensure!(ids.insert(id.to_owned()), "Duplicate prepare step {id}");
    let keys = step["key"]
        .as_array()
        .with_context(|| format!("{label}.key must be an array of file globs"))?;
    ensure!((1..=50).contains(&keys.len()), "{label}.key lists 1-50 globs");
    let key = keys
        .iter()
        .map(|glob| {
            let glob = glob
                .as_str()
                .filter(|glob| {
                    !glob.is_empty() && !glob.starts_with('/') && !glob.contains(['\\', '\0']) && !glob.split('/').any(|part| part == "..")
                })
                .with_context(|| format!("{label}.key holds repository-relative globs"))?;
            globset::GlobBuilder::new(glob)
                .literal_separator(true)
                .build()
                .with_context(|| format!("{label}.key has an invalid glob {glob}"))?;
            Ok(glob.to_owned())
        })
        .collect::<Result<Vec<_>>>()?;
    let environment = match step.get("environment") {
        None => Vec::new(),
        Some(names) => names
            .as_array()
            .with_context(|| format!("{label}.environment must be an array"))?
            .iter()
            .map(|name| {
                name.as_str()
                    .filter(|name| variable.is_match(name))
                    .map(str::to_owned)
                    .with_context(|| format!("{label}.environment holds variable names"))
            })
            .collect::<Result<Vec<_>>>()?,
    };
    let timeout_ms = match step.get("timeoutMs") {
        None => DEFAULT_TIMEOUT_MS,
        Some(value) => value
            .as_u64()
            .filter(|value| (1..=MAX_TIMEOUT_MS).contains(value))
            .with_context(|| format!("{label}.timeoutMs must be 1-{MAX_TIMEOUT_MS}"))?,
    };
    Ok(Step {
        id: id.to_owned(),
        run: argv(&step["run"], &format!("{label}.run"))?,
        key,
        directory: relative(step["directory"].as_str().unwrap_or("."), &format!("{label}.directory"))?,
        environment,
        timeout_ms,
    })
}

impl Step {
    /// The files among `files` its key globs match, sorted.
    pub fn matches<'a>(&self, files: &'a [String]) -> Result<Vec<&'a String>> {
        let mut set = globset::GlobSetBuilder::new();
        for glob in &self.key {
            set.add(globset::GlobBuilder::new(glob).literal_separator(true).build()?);
        }
        let set = set.build()?;
        Ok(files.iter().filter(|file| set.is_match(file)).collect())
    }

    /// The step's key hash: its argv, directory and variable names, and each
    /// matched file's path and Git blob ID, so a step reruns only when what it
    /// installs from changes.
    pub fn key_hash(&self, blobs: &[(String, String)]) -> String {
        let mut hasher = Sha256::new();
        let definition = json!({"run": self.run, "directory": self.directory, "environment": self.environment});
        hasher.update(definition.to_string().as_bytes());
        for (path, blob) in blobs {
            hasher.update(b"\0");
            hasher.update(path.as_bytes());
            hasher.update(b"\0");
            hasher.update(blob.as_bytes());
        }
        format!("sha256:{:x}", hasher.finalize())
    }
}

#[cfg(test)]
mod tests;
