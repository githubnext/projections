//! `references` relationships between resources, from the configuration's expressions.

pub(super) mod configuration;

use crate::modules::strip_indexes;
use crate::plan::Resource;
use anyhow::Result;
use configuration::{ConfigResource, Configuration, Target};
use projections_extractor_sdk::{object, relationship};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// Adds `references` relationships between resources; returns the number of unresolved references.
pub(crate) fn references(configuration: &Value, resources: &BTreeMap<String, Resource>, edges: &mut Vec<Value>) -> Result<usize> {
    object(configuration, "configuration")?;
    let mut config = Configuration::default();
    config.read(configuration.get("root_module").unwrap_or(&json!({})), "")?;
    let mut instances: BTreeMap<String, Vec<&str>> = BTreeMap::new();
    for address in resources.keys() {
        instances.entry(strip_indexes(address)).or_default().push(address);
    }
    let mut linker = Linker {
        config: &config,
        instances,
        links: BTreeMap::new(),
        unresolved: 0,
    };
    for resource in &config.resources {
        linker.resource(resource);
    }
    for (child, parent, depends) in &config.module_depends {
        let sources = linker.within(child);
        for reference in depends {
            linker.depends(&sources, parent, reference);
        }
    }
    let unresolved = linker.unresolved;
    edges.extend(linker.links.into_iter().map(edge));
    Ok(unresolved)
}

/// Resolves the configuration's references to the resource instances they connect.
struct Linker<'a> {
    config: &'a Configuration,
    /// Index-free address → instance addresses.
    instances: BTreeMap<String, Vec<&'a str>>,
    /// (from, to) → (attributes, explicit)
    links: BTreeMap<(String, String), (BTreeSet<String>, bool)>,
    unresolved: usize,
}

impl<'a> Linker<'a> {
    fn within(&self, prefix: &str) -> Vec<&'a str> {
        self.instances
            .iter()
            .filter(|(key, _)| key.starts_with(prefix))
            .flat_map(|(_, ids)| ids.iter().copied())
            .collect()
    }

    fn instances_of(&self, targets: &[Target]) -> Vec<&'a str> {
        targets
            .iter()
            .flat_map(|target| match target {
                Target::Resource(key) => self.instances.get(key).cloned().unwrap_or_default(),
                Target::Module(prefix) => self.within(prefix),
            })
            .collect()
    }

    fn resource(&mut self, resource: &ConfigResource) {
        let ConfigResource {
            address,
            prefix,
            attributes,
            depends,
        } = resource;
        let Some(sources) = self.instances.get(address).cloned() else {
            return;
        };
        for (attribute, refs) in attributes {
            for reference in refs {
                self.attribute(&sources, prefix, attribute, reference);
            }
        }
        for reference in depends {
            self.depends(&sources, prefix, reference);
        }
    }

    /// A reference an attribute makes; one naming a resource with no instances is unresolved.
    fn attribute(&mut self, sources: &[&str], prefix: &str, attribute: &str, reference: &str) {
        let Some(targets) = self.config.resolve(prefix, reference, 0) else {
            self.unresolved += 1;
            return;
        };
        let found = self.instances_of(&targets);
        if found.is_empty() && !targets.is_empty() {
            self.unresolved += 1;
        }
        self.link(sources, &found, Some(attribute));
    }

    /// An explicit `depends_on` reference.
    fn depends(&mut self, sources: &[&str], prefix: &str, reference: &str) {
        match self.config.resolve(prefix, reference, 0) {
            Some(targets) => {
                let found = self.instances_of(&targets);
                self.link(sources, &found, None);
            }
            None => self.unresolved += 1,
        }
    }

    fn link(&mut self, sources: &[&str], targets: &[&str], attribute: Option<&str>) {
        for source in sources {
            for target in targets {
                if source == target {
                    continue;
                }
                let entry = self.links.entry(((*source).to_owned(), (*target).to_owned())).or_default();
                match attribute {
                    Some(attribute) => {
                        entry.0.insert(attribute.to_owned());
                    }
                    None => entry.1 = true,
                }
            }
        }
    }
}

fn edge(((from, to), (attributes, explicit)): ((String, String), (BTreeSet<String>, bool))) -> Value {
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
}
