//! `package-lock.json` and `npm-shrinkwrap.json`, lockfileVersion 2 and 3.

use super::{Builder, Entries, LOCKED_KINDS, Lockfile, Target, version_text};
use anyhow::{Context, Result, ensure};
use projections_extractor_sdk::parse_json;
use serde_json::Value;
use std::collections::BTreeMap;

/// npm's lookup: the nearest `<location>/node_modules/<key>`, walking up from
/// `location` to the root `node_modules/<key>`; a `link` entry is a workspace.
pub(super) fn npm_target(
    packages: &BTreeMap<String, Value>,
    at_location: &BTreeMap<String, usize>,
    location: &str,
    key: &str,
) -> Option<Target> {
    let mut location = location;
    loop {
        let candidate = if location.is_empty() {
            format!("node_modules/{key}")
        } else {
            format!("{location}/node_modules/{key}")
        };
        if let Some(entry) = packages.get(&candidate) {
            if entry["link"] == true {
                return entry["resolved"].as_str().map(|path| Target::Workspace(path.to_owned()));
            }
            return at_location.get(&candidate).map(|p| Target::Package(*p));
        }
        if location.is_empty() {
            return None;
        }
        location = location.rsplit_once('/').map_or("", |(parent, _)| parent);
    }
}

pub(super) fn npm(text: &str) -> Result<Lockfile> {
    let lock = parse_json(text)?;
    let version = lock["lockfileVersion"].as_u64().context("lockfileVersion must be a number")?;
    ensure!(
        matches!(version, 2 | 3),
        "lockfileVersion {version} is not supported; npm 7 or newer writes lockfileVersion 2 or 3"
    );
    let packages: BTreeMap<String, Value> = lock["packages"]
        .as_object()
        .context("packages must be an object")?
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let mut builder = Builder::default();
    let mut at_location = BTreeMap::new();
    for (location, entry) in &packages {
        let Some((_, installed)) = location.rsplit_once("node_modules/") else {
            continue;
        };
        if entry["link"] == true {
            continue;
        }
        let name = entry["name"].as_str().unwrap_or(installed);
        let Some(version) = version_text(&entry["version"]) else {
            continue;
        };
        let package = builder.add(name, &version);
        at_location.insert(location.clone(), package);
        for kind in LOCKED_KINDS {
            if let Some(map) = entry[kind].as_object() {
                for (key, range) in map {
                    builder.depend(package, kind, key, range.as_str());
                }
            }
        }
    }
    // A package's dependencies resolve from the first place it was installed.
    let mut first_location: BTreeMap<usize, String> = BTreeMap::new();
    for (location, package) in &at_location {
        first_location.entry(*package).or_insert_with(|| location.clone());
    }
    let (installed, position) = builder.finish(|package, key, _| npm_target(&packages, &at_location, &first_location[&package], key));
    let at_location = at_location
        .into_iter()
        .map(|(location, package)| (location, position[package]))
        .collect();
    Ok(Lockfile {
        version: version.to_string(),
        packages: installed,
        entries: Entries::Npm { packages, at_location },
    })
}
