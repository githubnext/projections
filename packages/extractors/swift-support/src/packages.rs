//! External packages as graph entities: each package the manifests or
//! projects depend on, with what `Package.resolved` pins, and each package it
//! pins that nothing declares. Every Swift extractor identifies a package the
//! same way, `swiftpm:package:<identity>`.

use crate::Pin;
use crate::manifest::{Dependency, Source};
use projections_extractor_sdk::key;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// One declared package: where it comes from and every requirement on it.
struct Declared {
    source: &'static str,
    location: String,
    requirements: BTreeSet<String>,
}

pub struct Externals<'a> {
    pins: BTreeMap<&'a str, &'a Pin>,
    declared: BTreeMap<String, Declared>,
}

/// A package's entity ID.
pub fn id(identity: &str) -> String {
    key(&["swiftpm", "package", identity])
}

impl<'a> Externals<'a> {
    pub fn new(pins: &'a [Pin]) -> Self {
        Externals {
            pins: pins.iter().map(|pin| (pin.identity.as_str(), pin)).collect(),
            declared: BTreeMap::new(),
        }
    }

    /// Records a dependency a manifest declares; returns its package's ID.
    pub fn dependency(&mut self, dependency: &Dependency) -> String {
        let (source, location) = match &dependency.source {
            Source::Repository(url) => ("repository", url.clone()),
            Source::Local(path) => ("local", path.clone()),
            Source::Registry(id) => ("registry", id.clone()),
        };
        self.declare(&dependency.identity, source, location, dependency.requirement.describe())
    }

    /// Records a package from `source` (`repository`, `local` or `registry`)
    /// at `location`, with a requirement on it; returns its ID.
    pub fn declare(&mut self, identity: &str, source: &'static str, location: String, requirement: Option<String>) -> String {
        let declared = self.declared.entry(identity.to_owned()).or_insert_with(|| Declared {
            source,
            location,
            requirements: BTreeSet::new(),
        });
        declared.requirements.extend(requirement);
        id(identity)
    }

    /// Adds `pins` from another `Package.resolved`; a package pinned twice keeps the first.
    pub fn pin(&mut self, pins: &'a [Pin]) {
        for pin in pins {
            self.pins.entry(pin.identity.as_str()).or_insert(pin);
        }
    }

    /// Every declared package, then every package `Package.resolved` pins that
    /// no manifest declares: one a dependency needs in turn.
    pub fn entities(&self) -> Vec<Value> {
        let mut entities = Vec::new();
        for (identity, declared) in &self.declared {
            let mut data = json!({"source": declared.source, "location": declared.location});
            if !declared.requirements.is_empty() {
                data["requirement"] = json!(declared.requirements.iter().cloned().collect::<Vec<_>>().join(", "));
            }
            if let Some(pin) = self.pins.get(identity.as_str()) {
                pinned(&mut data, pin);
            }
            entities.push(entity(identity, data));
        }
        for (identity, pin) in &self.pins {
            if !self.declared.contains_key(*identity) {
                let source = if pin.kind == "registry" { "registry" } else { "repository" };
                let mut data = json!({"source": source, "location": pin.location, "transitive": true});
                pinned(&mut data, pin);
                entities.push(entity(identity, data));
            }
        }
        entities
    }
}

fn entity(identity: &str, data: Value) -> Value {
    json!({"id": id(identity), "kind": "external-package", "label": identity, "data": data, "confidence": "authoritative"})
}

fn pinned(data: &mut Value, pin: &Pin) {
    for (field, value) in [("version", &pin.version), ("revision", &pin.revision), ("branch", &pin.branch)] {
        if let Some(value) = value {
            data[field] = json!(value);
        }
    }
}
