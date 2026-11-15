//! The resources a plan or state leaves behind, with each one's planned action.

use crate::modules::module_of;
use crate::sensitive::{Secrets, safe};
use anyhow::Result;
use projections_extractor_sdk::{array, object, strings, text};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// The planned action, in the infrastructure vocabulary.
pub(crate) fn action(actions: &[String], importing: bool) -> Result<Option<&'static str>> {
    let joined: Vec<&str> = actions.iter().map(String::as_str).collect();
    Ok(match joined.as_slice() {
        ["no-op"] if importing => Some("import"),
        ["no-op"] => None,
        ["create"] => Some("create"),
        ["read"] => Some("read"),
        ["update"] => Some("update"),
        ["delete", "create"] | ["create", "delete"] => Some("replace"),
        ["delete"] => Some("delete"),
        ["forget"] => Some("forget"),
        other => anyhow::bail!("Unsupported Terraform change actions {other:?}"),
    })
}

/// A resource or data source, before the graph is assembled.
pub(crate) struct Resource {
    pub address: String,
    pub module: Option<String>,
    pub raw: Value,
    pub values: Option<Value>,
    pub change: Option<Value>,
    pub action: Option<&'static str>,
}

fn walk_modules(raw: &Value, label: &str, found: &mut Vec<Value>) -> Result<()> {
    object(raw, label)?;
    for resource in array(raw.get("resources").unwrap_or(&json!([])), label)? {
        found.push(resource.clone());
    }
    for child in array(raw.get("child_modules").unwrap_or(&json!([])), label)? {
        walk_modules(child, label, found)?;
    }
    Ok(())
}

pub(crate) fn resources_of(values: Option<&Value>, label: &str) -> Result<Vec<Value>> {
    let mut found = vec![];
    if let Some(root) = values.and_then(|v| v.get("root_module")) {
        walk_modules(root, label, &mut found)?;
    }
    Ok(found)
}

/// The resources a plan (`plan`) or state leaves behind, by address, and the
/// addresses of the resources it destroys.
pub(crate) fn resources(document: &Value, plan: bool) -> Result<(BTreeMap<String, Resource>, Vec<String>)> {
    let changes = changes(document, plan)?;
    let secrets = Secrets::read(document);
    let mut resources: BTreeMap<String, Resource> = BTreeMap::new();
    let mut removed: Vec<String> = vec![];
    let present = if plan {
        resources_of(document.get("planned_values"), "planned_values")?
    } else {
        resources_of(document.get("values"), "values")?
    };
    let prior = resources_of(document.get("prior_state").and_then(|s| s.get("values")), "prior_state")?;
    let prior_data = prior.into_iter().filter(|r| r["mode"] == "data");
    for raw in present.into_iter().chain(prior_data) {
        let address = text(&raw["address"], "resource.address")?.to_owned();
        if resources.contains_key(&address) {
            continue;
        }
        let change = changes.get(&address).cloned();
        let resource = present_resource(address, raw, change, &secrets)?;
        resources.insert(resource.address.clone(), resource);
    }
    for (address, raw) in &changes {
        if resources.contains_key(address) {
            continue;
        }
        let actions = strings(&raw["change"]["actions"], "change.actions")?;
        match action(&actions, false)? {
            Some("delete") => removed.push(address.clone()),
            other => {
                resources.insert(address.clone(), changed_resource(address, raw, other, &secrets));
            }
        }
    }
    Ok((resources, removed))
}

/// A plan's current resource changes by address; deposed objects are left out.
fn changes(document: &Value, plan: bool) -> Result<BTreeMap<String, Value>> {
    let mut changes: BTreeMap<String, Value> = BTreeMap::new();
    if !plan {
        return Ok(changes);
    }
    object(&document["planned_values"], "planned_values")?;
    for raw in array(&document["resource_changes"], "resource_changes")? {
        if raw.get("deposed").is_some_and(|d| !d.is_null()) {
            continue;
        }
        let address = text(&raw["address"], "resource change.address")?;
        object(&raw["change"], "resource change.change")?;
        changes.insert(address.to_owned(), raw.clone());
    }
    Ok(changes)
}

/// A resource the plan or state lists, with its change if it has one.
fn present_resource(address: String, raw: Value, change: Option<Value>, secrets: &Secrets) -> Result<Resource> {
    let action = match &change {
        Some(c) => action(
            &strings(&c["change"]["actions"], "change.actions")?,
            c["change"]["importing"].is_object(),
        )?,
        None => None,
    };
    // Data sources are read on every plan, so their values are not part of a revision's identity.
    let values = if raw["mode"] == "data" {
        None
    } else if let Some(c) = &change {
        let change = &c["change"];
        Some(safe(
            &change["after"],
            &change["after_sensitive"],
            &change["after_unknown"],
            secrets,
        ))
    } else {
        Some(safe(&raw["values"], &raw["sensitive_values"], &Value::Null, secrets))
    };
    let module = change
        .as_ref()
        .and_then(|c| c["module_address"].as_str())
        .or_else(|| address.starts_with("module.").then(|| module_of(&address)).flatten())
        .map(str::to_owned);
    Ok(Resource {
        address,
        module,
        raw,
        values,
        change,
        action,
    })
}

/// A resource only a change describes, one the plan doesn't destroy.
fn changed_resource(address: &str, raw: &Value, action: Option<&'static str>, secrets: &Secrets) -> Resource {
    let module = raw["module_address"].as_str().map(str::to_owned);
    let change = &raw["change"];
    // A forgotten object survives as it was; anything else as planned.
    let values = (raw["mode"] != "data").then(|| {
        if action == Some("forget") {
            safe(&change["before"], &change["before_sensitive"], &Value::Null, secrets)
        } else {
            safe(&change["after"], &change["after_sensitive"], &change["after_unknown"], secrets)
        }
    });
    Resource {
        address: address.to_owned(),
        module,
        raw: raw.clone(),
        values,
        change: Some(raw.clone()),
        action,
    }
}
