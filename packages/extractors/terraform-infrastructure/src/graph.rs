//! The infrastructure graph of a plan or state document.

use crate::entity::resource_entity;
use crate::modules::{ensure_module, module_sources};
use crate::plan;
use crate::references::references;
use anyhow::{Result, ensure};
use projections_extractor_sdk::{extraction, relationship};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// The graph of a plan (`planned_values`) or of a state (`values`).
pub(crate) fn infrastructure(document: &Value) -> Result<Value> {
    ensure!(
        document["format_version"].as_str().is_some_and(|v| v
            .strip_prefix("1.")
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))),
        "Unsupported Terraform JSON format_version; expected 1.x"
    );
    let plan = document.get("planned_values").is_some();
    ensure!(
        plan || document.get("resource_changes").is_none(),
        "Terraform plan JSON must include planned_values"
    );
    let (resources, removed) = plan::resources(document, plan)?;
    let mut entities: BTreeMap<String, Value> = BTreeMap::new();
    let mut edges: Vec<Value> = vec![];
    let sources = module_sources(document.get("configuration"));
    for resource in resources.values() {
        let entity = resource_entity(resource)?;
        if let Some(module) = &resource.module {
            ensure_module(module, &sources, &mut entities, &mut edges);
            edges.push(relationship("contains", module, &resource.address));
        }
        entities.insert(resource.address.clone(), entity);
    }
    let unresolved = match document.get("configuration").filter(|v| !v.is_null()) {
        Some(configuration) => references(configuration, &resources, &mut edges)?,
        None => 0,
    };
    let relationships = relationships(&entities, edges);
    let mut metadata = json!({
        "source": if plan { "terraform show -json (plan)" } else { "terraform show -json (state)" },
        "sourceConfidence": "authoritative",
        "unresolvedReferences": unresolved,
        "limitations": [
            "References come from the configuration and conservatively connect every count and for_each instance.",
            "Locals, variables without a module call and provider configuration are not resolved to resources.",
            "Values Terraform marks sensitive are replaced, including unmarked copies of them elsewhere in the plan; secrets Terraform never marked cannot be detected.",
            "Data sources carry no values, because every plan reads them again."
        ]
    });
    if let Some(version) = document["terraform_version"].as_str() {
        metadata["terraformVersion"] = json!(version);
    }
    if !removed.is_empty() {
        metadata["destroyed"] = json!(removed);
    }
    Ok(extraction(
        "architecture/v0",
        entities.into_values().collect(),
        relationships.into_values().collect(),
        Some(metadata),
    ))
}

/// The relationships by ID; a moved resource's relationships move with it: the
/// same relationship under its endpoints' former addresses.
fn relationships(entities: &BTreeMap<String, Value>, edges: Vec<Value>) -> BTreeMap<String, Value> {
    let previous: BTreeMap<&str, &str> = entities
        .values()
        .filter_map(|entity| Some((entity["id"].as_str()?, entity["previousIds"][0].as_str()?)))
        .collect();
    let mut relationships: BTreeMap<String, Value> = BTreeMap::new();
    for mut edge in edges {
        let (from, to) = (edge["from"].as_str().unwrap(), edge["to"].as_str().unwrap());
        if previous.contains_key(from) || previous.contains_key(to) {
            let kind = edge["kind"].as_str().unwrap();
            let former = relationship(
                kind,
                previous.get(from).copied().unwrap_or(from),
                previous.get(to).copied().unwrap_or(to),
            );
            edge["previousIds"] = json!([former["id"]]);
        }
        let id = edge["id"].as_str().unwrap().to_owned();
        relationships.entry(id).or_insert(edge);
    }
    relationships
}
