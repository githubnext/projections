//! The configuration's references, read from `terraform show -json`.

use crate::modules::strip_indexes;
use anyhow::Result;
use projections_extractor_sdk::{array, object, strings, text};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// The configuration's references, with module outputs and input variables
/// followed to the resources that produce them.
#[derive(Default)]
pub(super) struct Configuration {
    pub(super) resources: Vec<ConfigResource>,
    /// (module prefix, output) → references in that module.
    outputs: BTreeMap<(String, String), Vec<String>>,
    /// (module prefix, variable) → (calling module prefix, references there).
    variables: BTreeMap<(String, String), (String, Vec<String>)>,
    /// Module prefix → (calling module prefix, `depends_on` of the module call).
    pub(super) module_depends: Vec<(String, String, Vec<String>)>,
}

/// A configured resource: its index-free address, its module prefix, the
/// references of each attribute and its `depends_on`, relative to the prefix.
pub(super) struct ConfigResource {
    pub(super) address: String,
    pub(super) prefix: String,
    pub(super) attributes: BTreeMap<String, Vec<String>>,
    pub(super) depends: Vec<String>,
}

pub(super) enum Target {
    Resource(String),
    Module(String),
}

fn collect_references(value: &Value, found: &mut Vec<String>) -> Result<()> {
    match value {
        Value::Array(a) => {
            for v in a {
                collect_references(v, found)?;
            }
        }
        Value::Object(m) => {
            for (k, v) in m {
                if k == "references" {
                    found.extend(strings(v, "expression.references")?);
                } else {
                    collect_references(v, found)?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

/// Every reference an expression (or any expression nested in it) makes.
fn references_in(value: &Value) -> Result<Vec<String>> {
    let mut found = vec![];
    collect_references(value, &mut found)?;
    Ok(found)
}

/// Terraform lists a traversal and each of its prefixes; keep only the longest.
pub(crate) fn longest(references: Vec<String>) -> Vec<String> {
    let set: BTreeSet<String> = references.into_iter().map(|r| strip_indexes(&r)).collect();
    set.iter()
        .filter(|r| {
            !set.iter()
                .any(|o| o.len() > r.len() && o.starts_with(r.as_str()) && o.as_bytes()[r.len()] == b'.')
        })
        .cloned()
        .collect()
}

impl Configuration {
    pub(super) fn read(&mut self, module: &Value, prefix: &str) -> Result<()> {
        object(module, "configuration module")?;
        for resource in array(module.get("resources").unwrap_or(&json!([])), "configuration.resources")? {
            self.read_resource(resource, prefix)?;
        }
        if let Some(outputs) = module["outputs"].as_object() {
            for (name, output) in outputs {
                let found = references_in(&output["expression"])?;
                self.outputs.insert((prefix.to_owned(), name.clone()), longest(found));
            }
        }
        for (name, call) in object(module.get("module_calls").unwrap_or(&json!({})), "module_calls")? {
            self.read_module_call(name, call, prefix)?;
        }
        Ok(())
    }

    fn read_resource(&mut self, resource: &Value, prefix: &str) -> Result<()> {
        let address = text(&resource["address"], "configuration resource.address")?;
        let mut attributes = BTreeMap::new();
        if let Some(expressions) = resource["expressions"].as_object() {
            for (attribute, expression) in expressions {
                let found = references_in(expression)?;
                if !found.is_empty() {
                    attributes.insert(attribute.clone(), longest(found));
                }
            }
        }
        for (meta, name) in [("count_expression", "count"), ("for_each_expression", "for_each")] {
            let found = references_in(&resource[meta])?;
            if !found.is_empty() {
                attributes.insert(name.into(), longest(found));
            }
        }
        let depends = strings(resource.get("depends_on").unwrap_or(&json!([])), "configuration.depends_on")?;
        self.resources.push(ConfigResource {
            address: format!("{prefix}{address}"),
            prefix: prefix.to_owned(),
            attributes,
            depends: depends.iter().map(|d| strip_indexes(d)).collect(),
        });
        Ok(())
    }

    /// A module call's input variables and dependencies, then the module it calls.
    fn read_module_call(&mut self, name: &str, call: &Value, prefix: &str) -> Result<()> {
        let child = format!("{prefix}module.{name}.");
        if let Some(expressions) = call["expressions"].as_object() {
            for (variable, expression) in expressions {
                let found = references_in(expression)?;
                self.variables
                    .insert((child.clone(), variable.clone()), (prefix.to_owned(), longest(found)));
            }
        }
        for meta in ["count_expression", "for_each_expression"] {
            let found = references_in(&call[meta])?;
            if !found.is_empty() {
                self.module_depends.push((child.clone(), prefix.to_owned(), longest(found)));
            }
        }
        let depends = strings(call.get("depends_on").unwrap_or(&json!([])), "module call.depends_on")?;
        if !depends.is_empty() {
            self.module_depends
                .push((child.clone(), prefix.to_owned(), depends.iter().map(|d| strip_indexes(d)).collect()));
        }
        if let Some(inner) = call.get("module").filter(|v| !v.is_null()) {
            self.read(inner, &child)?;
        }
        Ok(())
    }

    /// The resources a reference made in module `prefix` ends at. `None` when
    /// it names something that should exist but doesn't; an empty list for
    /// references to values with no producing resource (locals, root variables, `path`).
    pub(super) fn resolve(&self, prefix: &str, reference: &str, depth: usize) -> Option<Vec<Target>> {
        if depth > 64 {
            return None;
        }
        let parts: Vec<&str> = reference.split('.').collect();
        match parts.as_slice() {
            ["var", name, ..] => match self.variables.get(&(prefix.into(), (*name).into())) {
                Some((parent, refs)) => self.resolve_all(parent, refs, depth),
                None => Some(vec![]),
            },
            ["local" | "path" | "terraform" | "count" | "each" | "self", ..] => Some(vec![]),
            ["module", name] => Some(vec![Target::Module(format!("{prefix}module.{name}."))]),
            ["module", name, output, ..] => {
                let child = format!("{prefix}module.{name}.");
                let refs = self.outputs.get(&(child.clone(), (*output).into()))?;
                self.resolve_all(&child, refs, depth)
            }
            ["data", kind, name, ..] => Some(vec![Target::Resource(format!("{prefix}data.{kind}.{name}"))]),
            [kind, name, ..] => Some(vec![Target::Resource(format!("{prefix}{kind}.{name}"))]),
            _ => None,
        }
    }

    fn resolve_all(&self, prefix: &str, refs: &[String], depth: usize) -> Option<Vec<Target>> {
        let mut targets = vec![];
        for reference in refs {
            targets.extend(self.resolve(prefix, reference, depth + 1)?);
        }
        Some(targets)
    }
}
