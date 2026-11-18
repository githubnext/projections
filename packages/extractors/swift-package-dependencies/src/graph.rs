//! Entities and relationships: each package's products and targets, what
//! each target depends on, and the packages they come from.

use crate::packages::Package;
use projections_extractor_sdk::key;
use projections_extractor_swift_support::Pin;
use projections_extractor_swift_support::manifest::{Condition, Dependency, DependencyKind, Source, TargetDependency};
use projections_extractor_swift_support::packages::Externals;
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub(crate) struct Graph {
    pub entities: Vec<Value>,
    pub relationships: Vec<Value>,
    /// `[target ID, dependency]` for each dependency that names nothing the
    /// manifests declare.
    pub unresolved: Vec<Value>,
}

fn target_id(package: &Package, name: &str) -> String {
    key(&["swiftpm", package.place(), "target", name])
}

fn product_id(package: &Package, name: &str) -> String {
    key(&["swiftpm", package.place(), "product", name])
}

/// Where a target dependency leads.
enum Destination {
    Node(String),
    Unresolved,
}

impl Graph {
    pub fn build(packages: &[Package], pins: &[Pin]) -> Self {
        let locals: BTreeMap<&str, &Package> = packages.iter().map(|package| (package.dir.as_str(), package)).collect();
        let mut graph = Graph {
            entities: Vec::new(),
            relationships: Vec::new(),
            unresolved: Vec::new(),
        };
        let mut externals = Externals::new(pins);
        for package in packages {
            graph.declare(package);
            for dependency in &package.manifest.dependencies {
                if local(package, dependency, &locals).is_none() {
                    externals.dependency(dependency);
                }
            }
            for target in &package.manifest.targets {
                let from = target_id(package, &target.name);
                for dependency in &target.dependencies {
                    match resolve(package, dependency, &locals, &mut externals) {
                        Destination::Node(to) => graph.depends(&from, &to, dependency),
                        Destination::Unresolved => graph.unresolved.push(json!([from, dependency.name])),
                    }
                }
            }
        }
        graph.entities.extend(externals.entities());
        graph.entities.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        graph.relationships.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        graph.relationships.dedup_by(|a, b| a["id"] == b["id"]);
        graph
    }

    /// A package's targets and products, and the targets each product includes.
    fn declare(&mut self, package: &Package) {
        let name = &package.manifest.name;
        for target in &package.manifest.targets {
            let mut data = json!({"package": name, "type": target.kind});
            if let Some(path) = &target.path {
                data["path"] = json!(path);
            }
            self.entities.push(json!({"id": target_id(package, &target.name), "kind": "target", "label": target.name, "data": data, "confidence": "authoritative"}));
        }
        for product in &package.manifest.products {
            let id = product_id(package, &product.name);
            let mut data = json!({"package": name, "type": product.kind});
            if let Some(linkage) = &product.linkage {
                data["linkage"] = json!(linkage);
            }
            self.entities
                .push(json!({"id": id, "kind": "product", "label": product.name, "data": data, "confidence": "authoritative"}));
            for target in &product.targets {
                if package.manifest.targets.iter().any(|declared| &declared.name == target) {
                    let to = target_id(package, target);
                    self.relationships.push(json!({"id": key(&["includes", &id, &to]), "kind": "includes", "from": id, "to": to, "confidence": "authoritative"}));
                } else {
                    self.unresolved.push(json!([id, target]));
                }
            }
        }
    }

    fn depends(&mut self, from: &str, to: &str, dependency: &TargetDependency) {
        let mut data = json!({});
        if let DependencyKind::Product { .. } = dependency.kind {
            data["product"] = json!(dependency.name);
        }
        condition(&mut data, &dependency.condition);
        let id = key(&["depends-on", from, to, &dependency.name]);
        self.relationships
            .push(json!({"id": id, "kind": "depends-on", "from": from, "to": to, "data": data, "confidence": "authoritative"}));
    }
}

/// The local packages `package` depends on that declare a product `name`.
fn exporting<'a>(package: &Package, name: &str, locals: &BTreeMap<&str, &'a Package>) -> Vec<&'a Package> {
    package
        .manifest
        .dependencies
        .iter()
        .filter_map(|declared| local(package, declared, locals))
        .filter(|local| local.manifest.products.iter().any(|product| product.name == name))
        .collect()
}

/// The package read from the project that a local dependency names, if any.
fn local<'a>(package: &Package, dependency: &Dependency, locals: &BTreeMap<&str, &'a Package>) -> Option<&'a Package> {
    match &dependency.source {
        Source::Local(path) => crate::packages::local_dir(&package.dir, path).and_then(|dir| locals.get(dir.as_str()).copied()),
        _ => None,
    }
}

fn condition(data: &mut Value, condition: &Condition) {
    if !condition.platforms.is_empty() {
        data["platforms"] = json!(condition.platforms);
    }
    if !condition.traits.is_empty() {
        data["traits"] = json!(condition.traits);
    }
}

/// What `dependency` of a target in `package` names, as SwiftPM resolves it: a
/// target of the same package, or a product of a package it depends on. A
/// product named without its package (by name, as manifests before tools
/// version 5.2 may) is the one local package that declares it, if exactly one does.
fn resolve(package: &Package, dependency: &TargetDependency, locals: &BTreeMap<&str, &Package>, externals: &mut Externals) -> Destination {
    let manifest = &package.manifest;
    let has_target = manifest.targets.iter().any(|target| target.name == dependency.name);
    let named = |name: &str| {
        manifest
            .dependencies
            .iter()
            .find(|declared| declared.identity == name.to_lowercase() || declared.name.as_deref() == Some(name))
    };
    let declared = match &dependency.kind {
        DependencyKind::Target if has_target => return Destination::Node(target_id(package, &dependency.name)),
        DependencyKind::ByName if has_target => return Destination::Node(target_id(package, &dependency.name)),
        DependencyKind::Target => return Destination::Unresolved,
        DependencyKind::ByName | DependencyKind::Product { package: None } => named(&dependency.name),
        DependencyKind::Product { package: Some(name) } => named(name),
    };
    let Some(declared) = declared else {
        return match exporting(package, &dependency.name, locals).as_slice() {
            [only] => Destination::Node(product_id(only, &dependency.name)),
            _ => Destination::Unresolved,
        };
    };
    match local(package, declared, locals) {
        Some(local) if local.manifest.products.iter().any(|product| product.name == dependency.name) => {
            Destination::Node(product_id(local, &dependency.name))
        }
        Some(_) => Destination::Unresolved,
        None => Destination::Node(externals.dependency(declared)),
    }
}
