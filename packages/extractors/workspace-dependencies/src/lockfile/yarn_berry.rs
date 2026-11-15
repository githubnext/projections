//! Yarn Berry `yarn.lock` (with `__metadata`).

use super::{Builder, Entries, LOCKED_KINDS, Lockfile, Resolved, Target, split_name, version_text, yaml};
use anyhow::{Context, Result, bail};
use std::collections::BTreeMap;

/// A Berry descriptor for `key` and `range`: `npm:` is added to ranges without a
/// protocol, as Berry does.
pub(super) fn berry_descriptor(key: &str, range: &str) -> String {
    let has_protocol = range.split_once(':').is_some_and(|(protocol, _)| {
        !protocol.is_empty()
            && protocol.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
            && protocol.starts_with(|c: char| c.is_ascii_alphabetic())
    });
    if has_protocol {
        format!("{key}@{range}")
    } else {
        format!("{key}@npm:{range}")
    }
}

pub(super) fn berry_target(descriptors: &BTreeMap<String, Resolved>, key: &str, range: &str) -> Option<Target> {
    descriptors.get(&berry_descriptor(key, range)).map(|resolved| match resolved {
        Resolved::Package(package) => Target::Package(*package),
        Resolved::Workspace(directory) => Target::Workspace(directory.clone()),
    })
}

pub(super) fn yarn_berry(text: &str) -> Result<Lockfile> {
    let lock = yaml(text, "yarn.lock")?;
    let lock = lock.as_object().context("yarn.lock must be a mapping")?;
    let version = lock
        .get("__metadata")
        .and_then(|m| version_text(&m["version"]))
        .context("__metadata.version is missing")?;
    let mut builder = Builder::default();
    let mut descriptors = BTreeMap::new();
    for (key, entry) in lock {
        if key == "__metadata" {
            continue;
        }
        let resolution = entry["resolution"].as_str().with_context(|| format!("{key} has no resolution"))?;
        let resolved = match resolution.split_once("@workspace:") {
            Some((_, directory)) => Resolved::Workspace(if directory == "." { "" } else { directory }.to_owned()),
            None => {
                let version = version_text(&entry["version"]).with_context(|| format!("{key} has no version"))?;
                let name = split_name(resolution)
                    .map(|(name, _)| name)
                    .with_context(|| format!("{key} has an unrecognized resolution"))?;
                let package = builder.add(name, &version);
                if let Some(dependencies) = entry["dependencies"].as_object() {
                    for (dependency, range) in dependencies {
                        // Berry records optional dependencies with the others and marks them.
                        let optional = entry["dependenciesMeta"][dependency]["optional"] == true;
                        let kind = LOCKED_KINDS[usize::from(optional)];
                        if let Some(range) = version_text(range) {
                            builder.depend(package, kind, dependency, Some(&range));
                        }
                    }
                }
                Resolved::Package(package)
            }
        };
        for descriptor in key.split(", ") {
            if descriptors.insert(descriptor.trim().to_owned(), resolved.clone()).is_some() {
                bail!("Duplicate descriptor {descriptor}");
            }
        }
    }
    let (installed, position) = builder.finish(|_, key, range| berry_target(&descriptors, key, range?));
    let descriptors = descriptors
        .into_iter()
        .map(|(descriptor, resolved)| {
            let resolved = match resolved {
                Resolved::Package(package) => Resolved::Package(position[package]),
                other => other,
            };
            (descriptor, resolved)
        })
        .collect();
    Ok(Lockfile {
        version,
        packages: installed,
        entries: Entries::YarnBerry(descriptors),
    })
}
