//! Which package manager's rules apply, and which lockfile it reads.

use anyhow::{Result, bail, ensure};
use projections_extractor_sdk::text;
use serde_json::Value;
use std::collections::BTreeSet;

/// The lockfiles a workspace root may hold, in the order they are listed.
pub(crate) const LOCKFILES: [&str; 4] = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"];

/// The package manager whose rules select workspaces and resolve versions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Manager {
    Npm,
    Pnpm,
    YarnClassic,
    YarnBerry,
}

impl Manager {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Npm => "npm",
            Self::Pnpm => "pnpm",
            Self::YarnClassic => "yarn-classic",
            Self::YarnBerry => "yarn-berry",
        }
    }

    /// The lockfile this manager reads among those present.
    pub(crate) fn lockfile<'a>(self, lockfiles: &[&'a str]) -> Option<&'a str> {
        match self {
            Self::Npm => lockfiles
                .iter()
                .find(|n| **n == "npm-shrinkwrap.json")
                .or_else(|| lockfiles.iter().find(|n| **n == "package-lock.json")),
            Self::Pnpm => lockfiles.iter().find(|n| **n == "pnpm-lock.yaml"),
            Self::YarnClassic | Self::YarnBerry => lockfiles.iter().find(|n| **n == "yarn.lock"),
        }
        .copied()
    }
}

/// The manager `inputs.packageManager` names, else package.json
/// `packageManager`, else the one whose lockfile is present.
pub(crate) fn detect(
    definition: &Value,
    manifest: &Value,
    lockfiles: &[&str],
    read_text: &dyn Fn(&str) -> Result<Option<String>>,
) -> Result<Manager> {
    let named = |name: &str, version: Option<&str>| named(name, version, lockfiles, read_text);
    if let Some(value) = definition["inputs"].get("packageManager").filter(|v| !v.is_null()) {
        return named(text(value, "inputs.packageManager")?, None);
    }
    if let Some(value) = manifest.get("packageManager").filter(|v| !v.is_null()) {
        let field = text(value, "package.json packageManager")?;
        let (name, version) = field.split_once('@').unwrap_or((field, ""));
        return named(name, Some(version).filter(|v| !v.is_empty()));
    }
    let managers: BTreeSet<&str> = lockfiles
        .iter()
        .map(|name| match *name {
            "pnpm-lock.yaml" => "pnpm",
            "yarn.lock" => "yarn",
            _ => "npm",
        })
        .collect();
    ensure!(
        managers.len() <= 1,
        "Lockfiles for several package managers are present ({}); set package.json packageManager or inputs.packageManager",
        lockfiles.join(", ")
    );
    match managers.first() {
        Some(name) => named(name, None),
        None if read_text("pnpm-workspace.yaml")?.is_some() => Ok(Manager::Pnpm),
        None => Ok(Manager::Npm),
    }
}

fn named(name: &str, version: Option<&str>, lockfiles: &[&str], read_text: &dyn Fn(&str) -> Result<Option<String>>) -> Result<Manager> {
    match name {
        "npm" => Ok(Manager::Npm),
        "pnpm" => Ok(Manager::Pnpm),
        "yarn" => yarn(version, lockfiles, read_text),
        other => bail!("Unsupported package manager {other}; expected npm, pnpm or yarn"),
    }
}

/// Yarn classic or Berry: by the lockfile's format, else by the declared version.
fn yarn(version: Option<&str>, lockfiles: &[&str], read_text: &dyn Fn(&str) -> Result<Option<String>>) -> Result<Manager> {
    if lockfiles.contains(&"yarn.lock") {
        let lock = read_text("yarn.lock")?.unwrap_or_default();
        return Ok(if lock.lines().any(|l| l.starts_with("__metadata:")) {
            Manager::YarnBerry
        } else {
            Manager::YarnClassic
        });
    }
    Ok(match version.and_then(|v| v.split('.').next()) {
        Some("1") | None => Manager::YarnClassic,
        Some(_) => Manager::YarnBerry,
    })
}
