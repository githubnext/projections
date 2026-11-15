//! Yarn classic `yarn.lock` (`# yarn lockfile v1`).

use super::{Builder, Entries, LOCKED_KINDS, Lockfile, Target, split_name};
use anyhow::{Context, Result, ensure};
use std::collections::BTreeMap;

fn unquote(value: &str) -> &str {
    value.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(value)
}

/// The package a Yarn descriptor installs: `name@range`, or the real package of
/// an `alias@npm:name@range` alias.
pub(super) fn descriptor_name(descriptor: &str) -> Option<&str> {
    let (name, range) = split_name(descriptor)?;
    match range.strip_prefix("npm:").and_then(split_name) {
        Some((real, _)) => Some(real),
        None => Some(name),
    }
}

pub(super) fn yarn_classic(text: &str) -> Result<Lockfile> {
    ensure!(
        text.lines().any(|line| line.trim() == "# yarn lockfile v1"),
        "Not a Yarn classic lockfile: missing \"# yarn lockfile v1\""
    );
    struct Entry {
        descriptors: Vec<String>,
        version: Option<String>,
        dependencies: Vec<(&'static str, String, String)>,
    }
    let mut entries: Vec<Entry> = vec![];
    let mut section: Option<&'static str> = None;
    for (number, line) in text.lines().enumerate() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        if !line.starts_with(' ') {
            let header = line
                .strip_suffix(':')
                .with_context(|| format!("Line {}: expected an entry header", number + 1))?;
            entries.push(Entry {
                descriptors: header.split(", ").map(|d| unquote(d.trim()).to_owned()).collect(),
                version: None,
                dependencies: vec![],
            });
            section = None;
            continue;
        }
        let entry = entries
            .last_mut()
            .with_context(|| format!("Line {}: field outside an entry", number + 1))?;
        if let Some(field) = line.strip_prefix("  ").filter(|l| !l.starts_with(' ')) {
            section = None;
            if let Some(version) = field.strip_prefix("version ") {
                ensure!(entry.version.is_none(), "Line {}: duplicate version", number + 1);
                entry.version = Some(unquote(version.trim()).to_owned());
            } else if let Some(kind) = LOCKED_KINDS.iter().find(|k| field == format!("{k}:")) {
                section = Some(kind);
            }
            continue;
        }
        if let (Some(kind), Some(item)) = (section, line.strip_prefix("    ")) {
            let item = item.trim();
            let (key, range) = if let Some(rest) = item.strip_prefix('"') {
                let end = rest.find('"').context("Unterminated dependency name")?;
                (&rest[..end], rest[end + 1..].trim())
            } else {
                item.split_once(' ').context("Dependency without a range")?
            };
            entry.dependencies.push((kind, key.to_owned(), unquote(range.trim()).to_owned()));
        }
    }
    let mut builder = Builder::default();
    let mut descriptors = BTreeMap::new();
    for entry in &entries {
        let version = entry
            .version
            .as_deref()
            .with_context(|| format!("{} has no version", entry.descriptors.join(", ")))?;
        let name = entry
            .descriptors
            .first()
            .and_then(|d| descriptor_name(d))
            .context("Entry without a descriptor")?;
        let package = builder.add(name, version);
        for descriptor in &entry.descriptors {
            ensure!(
                descriptors.insert(descriptor.clone(), package).is_none(),
                "Duplicate descriptor {descriptor}"
            );
        }
        for (kind, key, range) in &entry.dependencies {
            builder.depend(package, kind, key, Some(range));
        }
    }
    let (installed, position) = builder.finish(|_, key, range| {
        descriptors
            .get(&format!("{key}@{}", range?))
            .map(|package| Target::Package(*package))
    });
    let descriptors = descriptors
        .into_iter()
        .map(|(descriptor, package)| (descriptor, position[package]))
        .collect();
    Ok(Lockfile {
        version: "1".into(),
        packages: installed,
        entries: Entries::YarnClassic(descriptors),
    })
}
