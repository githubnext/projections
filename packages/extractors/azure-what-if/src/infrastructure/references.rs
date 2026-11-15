//! References: resource IDs in a payload, attached to the nearest listed resource they name.

use super::Links;
use super::resources::Resource;
use crate::payload::{BACK_REFERENCES, resource_ids};
use crate::resource_id::{ResourceId, parse_id};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

fn ancestors(key: &str) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    let mut next = parse_id(key).and_then(|i| i.parent);
    while let Some(p) = next {
        next = parse_id(&p).and_then(|i| i.parent);
        found.insert(p);
    }
    found
}

/// The references between listed resources, and how many point outside them.
pub(super) fn references(resources: &BTreeMap<String, Resource>) -> (Links, usize) {
    let mut links = Links::new();
    let mut external = 0;
    for resource in resources.values() {
        let found = payload_ids(&resource.payload);
        let own = ancestors(&resource.id.key);
        for (attribute, target) in found {
            if BACK_REFERENCES.contains(&attribute.as_str()) {
                continue;
            }
            match resolve(resources, resource, &own, &target) {
                Some(to) if !ancestors(&to).contains(&resource.id.key) => {
                    links.entry((resource.id.key.clone(), to)).or_default().0.insert(attribute);
                }
                Some(_) => {}
                // A reference into the resource itself or its ancestors is containment.
                None if target.key == resource.id.key
                    || own.contains(&target.key)
                    || target.key.starts_with(&format!("{}/", resource.id.key)) => {}
                None => external += 1,
            }
        }
    }
    (links, external)
}

/// Resource IDs anywhere in a payload but its own `id`.
fn payload_ids(payload: &Value) -> Vec<(String, ResourceId)> {
    let mut found = vec![];
    if let Some(payload) = payload.as_object() {
        for (key, value) in payload {
            if key != "id" {
                let mut path = vec![key.clone()];
                resource_ids(value, &mut path, &mut found);
            }
        }
    }
    found
}

/// The nearest listed resource at or above `target`, stopping at the referrer or its ancestors.
fn resolve(resources: &BTreeMap<String, Resource>, resource: &Resource, own: &BTreeSet<String>, target: &ResourceId) -> Option<String> {
    let mut candidate = Some(target.key.clone());
    while let Some(key) = candidate {
        if key == resource.id.key || own.contains(&key) {
            return None;
        }
        if resources.get(&key).is_some_and(|r| r.entity["kind"] == "resource") {
            return Some(key);
        }
        candidate = parse_id(&key).and_then(|i| i.parent);
    }
    None
}
