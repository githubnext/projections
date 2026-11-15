//! Listed resources: one entity per what-if change that leaves a resource in scope.

use crate::payload::{BACK_REFERENCES, safe};
use crate::resource_id::{ResourceId, parse_id};
use anyhow::{Context as _, Result, bail, ensure};
use projections_extractor_sdk::{array, text};
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

pub(crate) struct Resource {
    pub(crate) id: ResourceId,
    pub(crate) entity: Value,
    pub(crate) payload: Value,
}

fn action(change_type: &str) -> Result<Option<&'static str>> {
    Ok(match change_type {
        "Create" => Some("create"),
        "Modify" => Some("update"),
        "Deploy" => Some("deploy"),
        "Delete" => Some("delete"),
        "NoChange" | "Ignore" | "Unsupported" => None,
        other => bail!("Unsupported what-if changeType {other}"),
    })
}

/// The resources the changes leave, by key, and the raw IDs of the resources they delete.
pub(super) fn listed(result: &Value) -> Result<(BTreeMap<String, Resource>, Vec<String>)> {
    let mut resources: BTreeMap<String, Resource> = BTreeMap::new();
    let mut destroyed = vec![];
    for change in array(&result["changes"], "what-if changes")? {
        let raw_id = text(&change["resourceId"], "change.resourceId")?;
        let id = parse_id(raw_id).with_context(|| format!("Unrecognized resource ID {raw_id}"))?;
        let change_type = text(&change["changeType"], "change.changeType")?;
        let action = action(change_type)?;
        if action == Some("delete") {
            destroyed.push(raw_id.to_owned());
            continue;
        }
        let payload = match &change["after"] {
            Value::Null => change["before"].clone(),
            after => after.clone(),
        };
        let data = data(&id, raw_id, action, change_type, change, &payload);
        let kind = if id.resource_type == "Microsoft.Resources/resourceGroups" {
            "resource-group"
        } else {
            "resource"
        };
        let entity = json!({"id":id.key,"kind":kind,"label":id.names.last().unwrap(),"data":data,"confidence":"authoritative"});
        ensure!(!resources.contains_key(&id.key), "What-if lists {raw_id} twice");
        resources.insert(id.key.clone(), Resource { id, entity, payload });
    }
    Ok((resources, destroyed))
}

fn data(id: &ResourceId, raw_id: &str, action: Option<&str>, change_type: &str, change: &Value, payload: &Value) -> Map<String, Value> {
    let mut data = Map::new();
    data.insert("type".into(), json!(id.resource_type));
    data.insert("provider".into(), json!(id.resource_type.split('/').next().unwrap_or_default()));
    data.insert("address".into(), json!(raw_id));
    if let Some(action) = action {
        data.insert("action".into(), json!(action));
    }
    change_details(change_type, change, &mut data);
    if let Some(values) = values(payload) {
        data.insert("values".into(), values);
    }
    data
}

/// What the change type says beyond its action: unmanaged, unsupported or which properties change.
fn change_details(change_type: &str, change: &Value, data: &mut Map<String, Value>) {
    match change_type {
        "Ignore" => {
            data.insert("managed".into(), json!(false));
        }
        "Unsupported" => {
            data.insert(
                "unsupportedReason".into(),
                json!(change["unsupportedReason"].as_str().unwrap_or("unknown")),
            );
        }
        "Modify" => {
            let mut paths: Vec<String> = change["delta"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|d| d["propertyChangeType"] != "NoEffect")
                .filter_map(|d| d["path"].as_str().map(str::to_owned))
                .collect();
            paths.sort();
            paths.dedup();
            if !paths.is_empty() {
                data.insert("changedProperties".into(), json!(paths));
            }
        }
        _ => {}
    }
}

/// The payload's safe values, without back-references; `None` when there are none.
fn values(payload: &Value) -> Option<Value> {
    if !payload.is_object() {
        return None;
    }
    let mut values = Map::new();
    for key in ["location", "kind", "sku", "zones", "tags", "properties"] {
        if let Some(value) = payload.get(key).filter(|v| !v.is_null()) {
            let mut value = value.clone();
            if let Some(properties) = value.as_object_mut().filter(|_| key == "properties") {
                properties.retain(|k, _| !BACK_REFERENCES.contains(&k.as_str()));
            }
            values.insert(key.into(), safe(&value));
        }
    }
    (!values.is_empty()).then_some(Value::Object(values))
}
