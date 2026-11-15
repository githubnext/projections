//! Containment: each resource inside its nearest listed ancestor, else its resource group.

use super::resources::Resource;
use crate::resource_id::parse_id;
use projections_extractor_sdk::relationship;
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// Entities by key, with resource groups added for unlisted containers, and the `contains` edges.
pub(super) fn contain(resources: &BTreeMap<String, Resource>) -> (BTreeMap<String, Value>, Vec<Value>) {
    let mut entities: BTreeMap<String, Value> = resources.iter().map(|(k, r)| (k.clone(), r.entity.clone())).collect();
    let mut edges = vec![];
    for resource in resources.values() {
        let Some(parent) = container(resources, resource) else {
            continue;
        };
        if !entities.contains_key(&parent) {
            let name = parent.rsplit('/').next().unwrap_or(&parent);
            let original = resource.entity["data"]["address"]
                .as_str()
                .and_then(|a| a.split('/').nth(4))
                .filter(|n| n.eq_ignore_ascii_case(name))
                .unwrap_or(name);
            entities.insert(parent.clone(), resource_group_entity(&parent, original));
        }
        edges.push(relationship("contains", &parent, &resource.id.key));
    }
    (entities, edges)
}

fn container(resources: &BTreeMap<String, Resource>, resource: &Resource) -> Option<String> {
    let mut parent = resource.id.parent.clone();
    while let Some(candidate) = &parent {
        if resources.contains_key(candidate) {
            break;
        }
        parent = parse_id(candidate).and_then(|p| p.parent);
    }
    parent.or_else(|| resource.id.resource_group.clone())
}

fn resource_group_entity(key: &str, name: &str) -> Value {
    json!({"id":key,"kind":"resource-group","label":name,"confidence":"authoritative",
        "data":{"type":"Microsoft.Resources/resourceGroups","provider":"Microsoft.Resources"}})
}
