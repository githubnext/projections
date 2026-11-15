//! A custom extractor written with the extractor SDK: the Cargo features each
//! crate in the revision declares, what each feature enables, and the optional
//! dependencies it activates. It reads only manifests, so it runs no tools and
//! needs no trust beyond running the extractor itself.

use anyhow::{Context as _, Result};
use projections_extractor_sdk::{Context, extraction, key, read_source, relationship};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn main() -> std::process::ExitCode {
    projections_extractor_sdk::main("cargo-features", collect)
}

fn collect(cx: &Context) -> Result<Value> {
    let mut manifests = BTreeMap::new();
    for file in cx.files()? {
        if file == "Cargo.toml" || file.ends_with("/Cargo.toml") {
            let manifest: toml::Table = read_source(cx.root(), file)?
                .parse()
                .with_context(|| format!("Invalid manifest {file}"))?;
            let name = manifest
                .get("package")
                .and_then(|package| package.get("name"))
                .and_then(toml::Value::as_str);
            // A virtual workspace manifest declares no crate.
            if let Some(name) = name {
                manifests.insert(name.to_owned(), (file.clone(), manifest));
            }
        }
    }
    let mut entities = BTreeMap::new();
    let mut relationships = vec![];
    for (name, (file, manifest)) in &manifests {
        let krate = key(&["crate", name]);
        entities.insert(
            krate.clone(),
            json!({"id": krate, "kind": "crate", "label": name,
                "evidence": [{"kind": "file", "source": file}]}),
        );
        let features = manifest.get("features").and_then(toml::Value::as_table);
        for (feature, enables) in features.into_iter().flatten() {
            let id = key(&["feature", name, feature]);
            entities.insert(
                id.clone(),
                json!({"id": id, "kind": "feature", "label": feature, "data": {"crate": name}}),
            );
            relationships.push(relationship("declares", &krate, &id));
            for item in enables.as_array().into_iter().flatten() {
                let Some(item) = item.as_str() else { continue };
                let (kind, target) = match item.split_once('/') {
                    // `dependency/feature` enables a feature of a crate in the revision.
                    Some((dependency, other)) if manifests.contains_key(dependency.trim_end_matches('?')) => {
                        ("enables", key(&["feature", dependency.trim_end_matches('?'), other]))
                    }
                    Some((dependency, _)) => (
                        "activates",
                        dependency_entity(&mut entities, name, dependency.trim_end_matches('?')),
                    ),
                    None => match item.strip_prefix("dep:") {
                        Some(dependency) => ("activates", dependency_entity(&mut entities, name, dependency)),
                        None if features.is_some_and(|all| all.contains_key(item)) => ("enables", key(&["feature", name, item])),
                        None => ("activates", dependency_entity(&mut entities, name, item)),
                    },
                };
                relationships.push(relationship(kind, &id, &target));
            }
        }
    }
    // A feature that names a missing feature of another crate is left out rather than guessed.
    relationships.retain(|edge| edge["to"].as_str().is_some_and(|to| entities.contains_key(to)));
    Ok(extraction("graph/v0", entities.into_values().collect(), relationships, None))
}

/// The optional dependency `dependency` of crate `name`, added once.
fn dependency_entity(entities: &mut BTreeMap<String, Value>, name: &str, dependency: &str) -> String {
    let id = key(&["dependency", name, dependency]);
    entities
        .entry(id.clone())
        .or_insert_with(|| json!({"id": id, "kind": "optional-dependency", "label": dependency, "data": {"crate": name}}));
    id
}
