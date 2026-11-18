//! Entities and relationships: each target with its module, what it depends
//! on, links and imports, and the packages it uses.

use crate::targets::Target;
use projections_extractor_sdk::key;
use projections_extractor_swift_support::Pin;
use projections_extractor_swift_support::packages::Externals;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) struct Graph {
    pub entities: Vec<Value>,
    pub relationships: Vec<Value>,
}

/// What one target's relationship to another records.
#[derive(Default)]
struct Link {
    explicit: bool,
    linked: bool,
    imported: bool,
    /// Some import of it is outside `#if`.
    unconditional: bool,
    testable: bool,
}

pub(crate) fn build(targets: &[Target], pins: &[Pin], projects: &[String], imports: bool) -> Graph {
    let mut externals = Externals::new(pins);
    let mut modules: BTreeMap<&str, Vec<&Target>> = BTreeMap::new();
    for target in targets {
        if let Some(module) = &target.module {
            modules.entry(module.as_str()).or_default().push(target);
        }
    }
    let mut entities = Vec::new();
    let mut relationships = Vec::new();
    for target in targets {
        let mut links: BTreeMap<String, Link> = BTreeMap::new();
        for to in &target.dependencies {
            links.entry(to.clone()).or_default().explicit = true;
        }
        for to in &target.links {
            links.entry(to.clone()).or_default().linked = true;
        }
        let mut products: BTreeMap<String, (String, bool)> = BTreeMap::new();
        for dependency in &target.products {
            let to = match &dependency.package {
                Some(package) => externals.declare(
                    &package.identity,
                    package.source,
                    package.location.clone(),
                    package.requirement.clone(),
                ),
                None => externals.declare(&dependency.product.to_lowercase(), "local", dependency.product.clone(), None),
            };
            products.insert(dependency.product.clone(), (to, false));
        }
        let mut other = BTreeSet::new();
        for import in &target.imports {
            if target.module.as_deref() == Some(import.module.as_str()) {
                continue;
            }
            let matches = importable(&modules, target, &import.module);
            if let Some((_, imported)) = products.get_mut(&import.module).filter(|_| matches.is_empty()) {
                *imported = true;
            } else if matches.is_empty() {
                other.insert(import.module.clone());
            }
            for to in matches {
                let link = links.entry(to).or_default();
                link.imported = true;
                link.unconditional |= !import.conditional;
                link.testable |= import.attributes.iter().any(|attribute| attribute == "@testable");
            }
        }
        entities.push(entity(target, &projects[target.project], imports.then_some(other)));
        for (to, link) in links.into_iter().filter(|(to, _)| to != &target.id) {
            relationships.push(relationship(&target.id, &to, &link, imports));
        }
        for (product, (to, imported)) in products {
            let mut data = json!({"product": product});
            if imports {
                data["imported"] = json!(imported);
            }
            let id = key(&["depends-on", &target.id, &to, &product]);
            relationships
                .push(json!({"id": id, "kind": "depends-on", "from": target.id, "to": to, "data": data, "confidence": "authoritative"}));
        }
    }
    entities.extend(externals.entities());
    entities.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    relationships.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    relationships.dedup_by(|a, b| a["id"] == b["id"]);
    Graph { entities, relationships }
}

/// The targets whose module `target` imports as `module`: those of its own
/// project when any are, else every one.
fn importable(modules: &BTreeMap<&str, Vec<&Target>>, target: &Target, module: &str) -> Vec<String> {
    let candidates = modules.get(module).map(Vec::as_slice).unwrap_or_default();
    let own: Vec<String> = candidates
        .iter()
        .filter(|other| other.project == target.project)
        .map(|other| other.id.clone())
        .collect();
    if own.is_empty() {
        candidates.iter().map(|other| other.id.clone()).collect()
    } else {
        own
    }
}

fn entity(target: &Target, project: &str, imports: Option<BTreeSet<String>>) -> Value {
    let mut data = json!({"project": project, "type": target.kind, "module": target.module});
    for (field, value) in [("sdk", &target.sdk), ("configuration", &target.configuration)] {
        if let Some(value) = value {
            data[field] = json!(value);
        }
    }
    if let Some(imports) = imports {
        data["imports"] = json!(imports);
    }
    json!({"id": target.id, "kind": "target", "label": target.name, "data": data, "confidence": "authoritative"})
}

/// A declared or linked dependency is `depends-on`; a target only imported, without either, is `imports`.
fn relationship(from: &str, to: &str, link: &Link, imports: bool) -> Value {
    let kind = if link.explicit || link.linked { "depends-on" } else { "imports" };
    let mut data = json!({"explicit": link.explicit, "linked": link.linked});
    if imports {
        data["imported"] = json!(link.imported);
    }
    if link.imported && !link.unconditional {
        data["conditional"] = json!(true);
    }
    if link.testable {
        data["testable"] = json!(true);
    }
    json!({"id": key(&[kind, from, to]), "kind": kind, "from": from, "to": to, "data": data, "confidence": "authoritative"})
}
