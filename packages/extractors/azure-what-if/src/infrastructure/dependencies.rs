//! Template dependencies: `dependsOn` from a compiled template, matched to listed resources.

use super::Links;
use super::resources::Resource;
use crate::expressions::{Evaluated, Expressions};
use crate::resource_id::is_ancestor;
use anyhow::{Result, bail};
use projections_extractor_sdk::object;
use serde_json::Value;
use std::collections::BTreeMap;

/// Adds `dependsOn` from a compiled template; returns how many declared
/// dependencies could not be matched to listed resources.
pub(super) fn template_dependencies(template: &Value, resources: &BTreeMap<String, Resource>, links: &mut Links) -> Result<usize> {
    object(template, "template")?;
    let expressions = Expressions { template };
    let declared = declared(template)?;
    let lookup = |resource_type: &str, name: &str| lookup(resources, resource_type, name);
    let mut keys: BTreeMap<String, String> = BTreeMap::new();
    let mut located: Vec<(Option<String>, &Value)> = vec![];
    for (symbol, raw) in &declared {
        let resource_type = raw["type"].as_str().unwrap_or_default();
        let key = raw["name"].as_str().and_then(|n| expressions.evaluate(n, 0)).and_then(|e| match e {
            Evaluated::Text(name) => lookup(resource_type, &name),
            Evaluated::Resource(..) => None,
        });
        if let (Some(symbol), Some(key)) = (symbol, &key) {
            keys.insert(symbol.clone(), key.clone());
        }
        located.push((key, raw));
    }
    let mut unmatched = 0;
    for (from, raw) in located {
        for dependency in raw["dependsOn"].as_array().into_iter().flatten() {
            let Some(dependency) = dependency.as_str() else {
                unmatched += 1;
                continue;
            };
            let to = keys
                .get(dependency)
                .cloned()
                .or_else(|| match expressions.evaluate(dependency, 0)? {
                    Evaluated::Resource(resource_type, name) => lookup(&resource_type, &name),
                    Evaluated::Text(_) => None,
                });
            match (&from, to) {
                // Depending on a parent is containment.
                (Some(from), Some(to)) if is_ancestor(&to, from) => {}
                (Some(from), Some(to)) if *from != to => {
                    links.entry((from.clone(), to)).or_default().1 = true;
                }
                (Some(_), Some(_)) => {}
                _ => unmatched += 1,
            }
        }
    }
    Ok(unmatched)
}

/// (symbolic name or index) → declared type, name and dependsOn.
fn declared(template: &Value) -> Result<Vec<(Option<String>, &Value)>> {
    Ok(match &template["resources"] {
        Value::Array(a) => a.iter().map(|r| (None, r)).collect(),
        Value::Object(m) => m.iter().map(|(k, r)| (Some(k.clone()), r)).collect(),
        Value::Null => vec![],
        _ => bail!("template.resources must be an array or an object"),
    })
}

/// The one listed resource with this type and name, case-insensitively.
fn lookup(resources: &BTreeMap<String, Resource>, resource_type: &str, name: &str) -> Option<String> {
    let names: Vec<String> = name.split('/').map(str::to_lowercase).collect();
    let matches: Vec<&String> = resources
        .iter()
        .filter(|(_, r)| {
            r.id.resource_type.eq_ignore_ascii_case(resource_type) && r.id.names.iter().map(|n| n.to_lowercase()).eq(names.iter().cloned())
        })
        .map(|(k, _)| k)
        .collect();
    (matches.len() == 1).then(|| matches[0].clone())
}
