//! `pnpm-lock.yaml`, lockfile 5 to 9, as pnpm 7 to 12 write it.

use super::{Builder, Entries, LOCKED_KINDS, Lockfile, Target, split_name, version_text};
use anyhow::{Context, Result, ensure};
use projections_extractor_sdk::parse_yaml_documents;
use serde_json::Value;
use std::collections::BTreeMap;

/// Importer directory to dependency name to recorded reference.
pub(super) type Importers = BTreeMap<String, BTreeMap<String, String>>;

pub(super) fn pnpm(text: &str) -> Result<Lockfile> {
    let lock = project_document(text)?;
    let version = version_text(&lock["lockfileVersion"]).context("lockfileVersion is missing")?;
    let major: u32 = version
        .split('.')
        .next()
        .and_then(|m| m.parse().ok())
        .context("lockfileVersion is not a version")?;
    ensure!(
        (5..=9).contains(&major),
        "lockfileVersion {version} is not supported; expected pnpm lockfile 5 to 9"
    );
    let importers = importers(&lock)?;
    // Lockfile 9 keeps dependencies in `snapshots`; earlier versions in `packages`.
    let section = if major >= 9 { "snapshots" } else { "packages" };
    let mut builder = Builder::default();
    let mut keys = BTreeMap::new();
    let mut references = BTreeMap::new();
    if let Some(map) = lock.get(section).and_then(Value::as_object) {
        for (key, entry) in map {
            let (name, version) = pnpm_package(key, major).with_context(|| format!("{section}.{key} does not name a package version"))?;
            let package = builder.add(&name, &version);
            keys.insert(key.clone(), package);
            for kind in LOCKED_KINDS {
                if let Some(dependencies) = entry.get(kind).and_then(Value::as_object) {
                    for (dependency, reference) in dependencies {
                        // The reference stays in the key; pnpm keeps no requested range.
                        if let Some(reference) = version_text(reference) {
                            references.insert((package, kind, dependency.clone()), reference);
                            builder.depend(package, kind, dependency, None);
                        }
                    }
                }
            }
        }
    }
    let kinds: BTreeMap<(usize, String), &str> = references
        .keys()
        .map(|(package, kind, key)| ((*package, key.clone()), *kind))
        .collect();
    let (installed, position) = builder.finish(|package, key, _| {
        let kind = kinds.get(&(package, key.to_owned()))?;
        let reference = references.get(&(package, *kind, key.to_owned()))?;
        pnpm_target(&keys, major, key, reference)
    });
    let keys = keys.into_iter().map(|(key, package)| (key, position[package])).collect();
    Ok(Lockfile {
        version,
        packages: installed,
        entries: Entries::Pnpm { importers, keys, major },
    })
}

/// The project lockfile: the last YAML document. pnpm 11 and later write a boot
/// document first (config dependencies and the resolved pnpm version) when the
/// project has any; the project's own graph is always the last document.
fn project_document(text: &str) -> Result<Value> {
    parse_yaml_documents(text, "pnpm-lock.yaml")?
        .pop()
        .context("pnpm-lock.yaml has no YAML document")
}

/// Each importer's direct dependencies and the reference pnpm recorded for each.
fn importers(lock: &Value) -> Result<Importers> {
    let importer_list: Vec<(String, &Value)> = match lock.get("importers") {
        Some(importers) => importers
            .as_object()
            .context("importers must be a mapping")?
            .iter()
            .map(|(k, v)| (k.clone(), v))
            .collect(),
        None => vec![(".".to_owned(), lock)],
    };
    let mut importers = BTreeMap::new();
    for (importer, sections) in importer_list {
        let mut dependencies = BTreeMap::new();
        for section in ["dependencies", "devDependencies", "optionalDependencies"] {
            let Some(map) = sections.get(section).and_then(Value::as_object) else {
                continue;
            };
            for (name, value) in map {
                // Lockfile 6+ records {specifier, version}; 5.x records the version.
                let raw = match value {
                    Value::Object(entry) => entry.get("version").and_then(version_text),
                    other => version_text(other),
                }
                .with_context(|| format!("importers.{importer}.{section}.{name} has no version"))?;
                dependencies.insert(name.clone(), raw);
            }
        }
        importers.insert(importer, dependencies);
    }
    Ok(importers)
}

/// What the workspace package in `directory` (empty for the root) resolved `key` to.
pub(super) fn pnpm_importer_target(
    importers: &Importers,
    keys: &BTreeMap<String, usize>,
    major: u32,
    directory: &str,
    key: &str,
) -> Option<Target> {
    let importer = if directory.is_empty() { "." } else { directory };
    let raw = importers.get(importer)?.get(key)?;
    if let Some(link) = raw.strip_prefix("link:") {
        return Some(Target::Workspace(relative(importer, link)));
    }
    pnpm_target(keys, major, key, raw)
}

/// The name and version a pnpm package key names, without peer suffixes:
/// `name@1.2.3(peer@1)` (9), `/name@1.2.3(peer@1)` (6 to 8), `/name/1.2.3_peer@1` (5).
pub(super) fn pnpm_package(key: &str, major: u32) -> Option<(String, String)> {
    let path = key.strip_prefix('/').unwrap_or(key);
    let path = path.split('(').next().unwrap_or(path);
    if major == 5 {
        let (name, version) = path.rsplit_once('/')?;
        let version = version.split('_').next().unwrap_or(version);
        return Some((name.to_owned(), version.to_owned()));
    }
    let (name, version) = split_name(path)?;
    Some((name.to_owned(), version.to_owned()))
}

/// The package a pnpm reference names: an alias names its real package
/// (`is-number@6.0.0`), any other reference is a version of `key`.
pub(super) fn pnpm_target(keys: &BTreeMap<String, usize>, major: u32, key: &str, reference: &str) -> Option<Target> {
    if reference.starts_with("link:") {
        return None;
    }
    let bare = reference.split('(').next().unwrap_or(reference);
    let aliased = bare.starts_with('/') || bare.get(1..).is_some_and(|rest| rest.contains('@'));
    let path = if aliased {
        reference.strip_prefix('/').unwrap_or(reference).to_owned()
    } else if major == 5 {
        format!("{key}/{reference}")
    } else {
        format!("{key}@{reference}")
    };
    let candidate = if major >= 9 { path } else { format!("/{path}") };
    keys.get(&candidate).map(|package| Target::Package(*package))
}

/// `link` relative to the importer directory, as a workspace directory.
pub(super) fn relative(importer: &str, link: &str) -> String {
    let mut parts: Vec<&str> = if importer == "." { vec![] } else { importer.split('/').collect() };
    for segment in link.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}
