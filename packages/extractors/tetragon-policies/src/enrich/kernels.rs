//! Kernel profiles of the nodes policies load on: each profile's version,
//! config options and symbol lists.

use super::availability;
use crate::policy::Model;
use anyhow::{Context, Result, bail, ensure};
use projections_extractor_sdk::{key, parse_yaml_documents, read_source, text};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

pub(super) struct Profile {
    pub(super) name: String,
    pub(super) version: Option<(u64, u64)>,
    pub(super) config: BTreeMap<String, bool>,
    pub(super) symbols: Option<BTreeSet<String>>,
    pub(super) injectable: Option<BTreeSet<String>>,
}

impl Profile {
    pub(super) fn at_least(&self, major: u64, minor: u64) -> bool {
        self.version.is_none_or(|version| version >= (major, minor))
    }
    pub(super) fn disabled(&self, option: &str) -> bool {
        self.config.get(option) == Some(&false)
    }
}

fn names(root: &Path, path: &str) -> Result<BTreeSet<String>> {
    // `/proc/kallsyms` lines are `address type name [module]`; error injection lists are `name\tERRNO`.
    Ok(read_source(root, path)?
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            match fields.len() {
                0 => None,
                3 | 4 if fields[0].chars().all(|c| c.is_ascii_hexdigit()) => Some(fields[2].to_owned()),
                _ => Some(fields[0].to_owned()),
            }
        })
        .collect())
}

fn version(value: &str) -> Option<(u64, u64)> {
    let mut parts = value.split(|c: char| !c.is_ascii_digit()).filter(|part| !part.is_empty());
    Some((parts.next()?.parse().ok()?, parts.next().unwrap_or("0").parse().ok()?))
}

/// Kernel profiles of the nodes policies load on, and which hooks and actions
/// each can't support.
pub fn kernels(model: &mut Model, root: &Path, path: &str) -> Result<()> {
    let documents = parse_yaml_documents(&read_source(root, path)?, path)?;
    let document = documents.into_iter().find(|document| !document.is_null()).unwrap_or(json!({}));
    let declared = document["profiles"]
        .as_array()
        .with_context(|| format!("{path}: profiles must be a list"))?;
    ensure!(!declared.is_empty(), "{path} declares no kernel profiles");
    let mut profiles = vec![];
    for (index, item) in declared.iter().enumerate() {
        let profile = profile(model, root, path, index, item, &profiles)?;
        profiles.push(profile);
    }
    availability::hooks(model, &profiles);
    availability::overrides(model, &profiles);
    Ok(())
}

/// One declared profile, recorded as a kernel entity.
fn profile(model: &mut Model, root: &Path, path: &str, index: usize, item: &Value, profiles: &[Profile]) -> Result<Profile> {
    let label = format!("{path}: profiles[{index}]");
    let name = text(&item["name"], &format!("{label}.name"))?.to_owned();
    ensure!(
        !profiles.iter().any(|p: &Profile| p.name == name),
        "{path} declares kernel profile {name} twice"
    );
    let kernel = item.get("kernel").filter(|v| !v.is_null()).map(|v| match v {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    });
    let parsed = kernel
        .as_deref()
        .map(|kernel| version(kernel).with_context(|| format!("{label}.kernel {kernel:?} is not a version")))
        .transpose()?;
    let mut config = BTreeMap::new();
    if let Some(options) = item.get("config").filter(|v| !v.is_null()) {
        for (option, value) in options.as_object().with_context(|| format!("{label}.config must be a map"))? {
            let enabled = match value {
                Value::Bool(flag) => *flag,
                Value::String(text) if text == "y" || text == "m" => true,
                Value::String(text) if text == "n" => false,
                other => {
                    bail!("{label}.config.{option} must be true, false, y, m or n, not {other}")
                }
            };
            config.insert(option.clone(), enabled);
        }
    }
    let file = |field: &str| -> Result<Option<(String, BTreeSet<String>)>> {
        match item.get(field).filter(|v| !v.is_null()) {
            None => Ok(None),
            Some(value) => {
                let file = text(value, &format!("{label}.{field}"))?;
                Ok(Some((file.to_owned(), names(root, file)?)))
            }
        }
    };
    let symbols = file("symbols")?;
    let injectable = file("errorInjection")?;
    let id = key(&["kernel", &name]);
    let mut data = json!({"name":name,"kernel":kernel,"config":config});
    if let Some((file, set)) = &symbols {
        data["symbols"] = json!({"path":file,"count":set.len()});
    }
    if let Some((file, set)) = &injectable {
        data["errorInjection"] = json!({"path":file,"count":set.len()});
    }
    model.entities.push(json!({
        "id":id,"kind":"kernel","label":name,"confidence":"authoritative","data":data,
        "evidence":[{"kind":"kernel-profile","source":path}],
    }));
    Ok(Profile {
        name,
        version: parsed,
        config,
        symbols: symbols.map(|(_, set)| set),
        injectable: injectable.map(|(_, set)| set),
    })
}
