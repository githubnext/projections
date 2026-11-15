//! Resolved versions read from npm, pnpm and Yarn lockfiles, the way each
//! package manager records them. Lockfiles are parsed, never installed.

mod builder;
mod npm;
mod pnpm;
mod yarn_berry;
mod yarn_classic;

use crate::Manager;
use anyhow::{Context, Result};
use builder::Builder;
use npm::{npm, npm_target};
use pnpm::{pnpm, pnpm_importer_target};
use serde_json::Value;
use std::collections::BTreeMap;
use yarn_berry::{berry_target, yarn_berry};
use yarn_classic::yarn_classic;

/// What a lockfile says one dependency resolved to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
    /// An installed package: an index into [`Lockfile::packages`].
    Package(usize),
    /// A link to the workspace package in this directory.
    Workspace(String),
    /// A link to the workspace package with the dependency's name.
    WorkspaceName,
}

/// One installed package version, however many places the manager installed it.
pub struct Installed {
    pub name: String,
    pub version: String,
    /// What this package depends on, by kind and key, in the lockfile's own
    /// resolution; peer dependencies are left out because not every manager
    /// locks them.
    pub dependencies: Vec<Dependency>,
}

pub struct Dependency {
    /// `dependencies` or `optionalDependencies`.
    pub kind: &'static str,
    pub key: String,
    /// The requested range; pnpm records only what it resolved to.
    pub range: Option<String>,
    pub target: Option<Target>,
}

pub struct Lockfile {
    pub version: String,
    /// Every installed package version, sorted by name and version.
    pub packages: Vec<Installed>,
    entries: Entries,
}

enum Entries {
    /// `packages` keyed by install location (`packages/api/node_modules/x`),
    /// and the installed package at each location.
    Npm {
        packages: BTreeMap<String, Value>,
        at_location: BTreeMap<String, usize>,
    },
    /// Importer directory to dependency name to recorded reference, and the
    /// package key a reference names.
    Pnpm {
        importers: BTreeMap<String, BTreeMap<String, String>>,
        keys: BTreeMap<String, usize>,
        major: u32,
    },
    /// Descriptor (`name@range`) to package.
    YarnClassic(BTreeMap<String, usize>),
    /// Descriptor (`name@protocol:range`) to package or workspace directory.
    YarnBerry(BTreeMap<String, Resolved>),
}

#[derive(Clone)]
enum Resolved {
    Package(usize),
    Workspace(String),
}

/// Parses one YAML document into JSON values, rejecting duplicate and non-string keys.
pub fn yaml(text: &str, label: &str) -> Result<Value> {
    projections_extractor_sdk::parse_yaml(text, label)
}

fn version_text(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// `name@rest` split at the version separator, keeping a scope's leading `@`.
fn split_name(text: &str) -> Option<(&str, &str)> {
    let at = text.get(1..)?.find('@')? + 1;
    Some((&text[..at], &text[at + 1..]))
}

/// The dependency kinds a lockfile entry records, in a fixed order.
const LOCKED_KINDS: [&str; 2] = ["dependencies", "optionalDependencies"];

impl Lockfile {
    pub fn parse(manager: Manager, name: &str, text: &str) -> Result<Self> {
        match manager {
            Manager::Npm => npm(text),
            Manager::Pnpm => pnpm(text),
            Manager::YarnClassic => yarn_classic(text),
            Manager::YarnBerry => yarn_berry(text),
        }
        .with_context(|| format!("Cannot read {name}"))
    }

    /// Resolves the dependency `key` with declared `range`, declared by the
    /// workspace package in `directory` (empty for the root).
    pub fn resolve(&self, directory: &str, key: &str, range: &str, workspace: bool) -> Option<Target> {
        match &self.entries {
            Entries::Npm { packages, at_location } => npm_target(packages, at_location, directory, key),
            Entries::Pnpm { importers, keys, major } => pnpm_importer_target(importers, keys, *major, directory, key),
            Entries::YarnClassic(descriptors) => match descriptors.get(&format!("{key}@{range}")) {
                Some(package) => Some(Target::Package(*package)),
                // Yarn classic links a workspace package it doesn't lock.
                None if workspace => Some(Target::WorkspaceName),
                None => None,
            },
            Entries::YarnBerry(descriptors) => berry_target(descriptors, key, range),
        }
    }
}

#[cfg(test)]
mod tests;
