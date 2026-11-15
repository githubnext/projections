//! The infrastructure extraction from a what-if result: listed resources,
//! containment, references and template dependencies.

mod containment;
mod dependencies;
mod references;
mod resources;

use anyhow::{Result, bail, ensure};
use projections_extractor_sdk::{extraction, object, relationship};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// References between listed resources, by (from, to): the properties that hold
/// them and whether a template `dependsOn` declares them.
type Links = BTreeMap<(String, String), (BTreeSet<String>, bool)>;

pub(crate) fn infrastructure(document: &Value, template: Option<&Value>) -> Result<Value> {
    object(document, "what-if result")?;
    let result = succeeded(document)?;
    let (resources, destroyed) = resources::listed(result)?;
    let (entities, mut edges) = containment::contain(&resources);
    let (mut links, external) = references::references(&resources);
    let mut unmatched = 0;
    if let Some(template) = template {
        unmatched = dependencies::template_dependencies(template, &resources, &mut links)?;
    }
    edges.extend(reference_edges(links));
    let mut relationships: BTreeMap<String, Value> = BTreeMap::new();
    for edge in edges {
        relationships.entry(edge["id"].as_str().unwrap().to_owned()).or_insert(edge);
    }
    let mut metadata = json!({
        "source":"Azure Resource Manager what-if",
        "sourceConfidence":"authoritative",
        "externalReferences":external,
        "limitations":[
            "References are resource IDs found in resource properties, attached to the nearest listed resource.",
            "ARM marks no values sensitive: properties whose names say they hold secrets are replaced, other secrets cannot be detected.",
            "Template expressions ARM cannot evaluate before deployment are shown as (known after deployment).",
            "ARM does not predict replacement; Deploy means ARM cannot tell whether properties change."
        ]
    });
    if template.is_some() {
        metadata["unmatchedTemplateDependencies"] = json!(unmatched);
    }
    if !destroyed.is_empty() {
        metadata["destroyed"] = json!(destroyed);
    }
    Ok(extraction(
        "architecture/v0",
        entities.into_values().collect(),
        relationships.into_values().collect(),
        Some(metadata),
    ))
}

/// The result holding the changes, once neither level reports an error or an unsuccessful status.
fn succeeded(document: &Value) -> Result<&Value> {
    // The REST response nests the result under `properties`; the CLI prints it flattened.
    let result = match document.get("changes") {
        Some(_) => document,
        None => &document["properties"],
    };
    for level in [document, result] {
        if let Some(error) = level.get("error").filter(|e| !e.is_null()) {
            bail!("What-if failed: {}", error["message"].as_str().unwrap_or("unknown error"));
        }
        if let Some(status) = level["status"].as_str() {
            ensure!(
                status.eq_ignore_ascii_case("Succeeded"),
                "What-if status is {status}, not Succeeded"
            );
        }
    }
    Ok(result)
}

fn reference_edges(links: Links) -> Vec<Value> {
    links
        .into_iter()
        .map(|((from, to), (attributes, explicit))| {
            let mut edge = relationship("references", &from, &to);
            edge["confidence"] = json!("derived");
            let mut data = Map::new();
            if !attributes.is_empty() {
                data.insert("attributes".into(), json!(attributes));
            }
            if explicit {
                data.insert("dependsOn".into(), json!(true));
            }
            edge["data"] = Value::Object(data);
            edge
        })
        .collect()
}
