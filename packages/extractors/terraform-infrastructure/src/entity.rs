//! A resource or data source as a graph entity.

use crate::plan::Resource;
use anyhow::Result;
use projections_extractor_sdk::{strings, text};
use serde_json::{Map, Value, json};

pub(crate) fn resource_entity(resource: &Resource) -> Result<Value> {
    let raw = &resource.raw;
    let data_source = text(&raw["mode"], "resource.mode")? == "data";
    let kind = if data_source { "data-source" } else { "resource" };
    let name = text(&raw["name"], "resource.name")?;
    let label = match raw.get("index") {
        Some(Value::String(key)) => format!("{name}[{}]", serde_json::to_string(key)?),
        Some(Value::Number(index)) => format!("{name}[{index}]"),
        _ => name.to_owned(),
    };
    let mut data = Map::new();
    data.insert("address".into(), json!(resource.address));
    data.insert("type".into(), json!(text(&raw["type"], "resource.type")?));
    if let Some(provider) = raw["provider_name"].as_str() {
        data.insert("provider".into(), json!(provider));
    }
    if let Some(module) = &resource.module {
        data.insert("module".into(), json!(module));
    }
    if let Some(action) = resource.action {
        data.insert("action".into(), json!(action));
    }
    let mut entity = json!({"id":resource.address,"kind":kind,"label":label,"confidence":"authoritative"});
    if let Some(change) = &resource.change {
        let actions = strings(&change["change"]["actions"], "change.actions")?;
        if resource.action == Some("replace") {
            data.insert(
                "replaceOrder".into(),
                json!(if actions[0] == "create" {
                    "create-before-destroy"
                } else {
                    "destroy-before-create"
                }),
            );
            if let Some(reason) = change["action_reason"].as_str() {
                data.insert("replaceReason".into(), json!(reason));
            }
            if let Some(paths) = change["change"]["replace_paths"].as_array() {
                let paths: Vec<String> = paths
                    .iter()
                    .filter_map(|p| p.as_array())
                    .map(|p| {
                        p.iter()
                            .map(|s| match s {
                                Value::String(s) => s.clone(),
                                other => other.to_string(),
                            })
                            .collect::<Vec<_>>()
                            .join(".")
                    })
                    .collect();
                if !paths.is_empty() {
                    data.insert("replacePaths".into(), json!(paths));
                }
            }
        }
        if change["change"]["importing"].is_object() {
            data.insert("importing".into(), json!(true));
        }
        if let Some(previous) = change["previous_address"].as_str() {
            entity["previousIds"] = json!([previous]);
        }
    }
    if let Some(values) = &resource.values {
        data.insert("values".into(), values.clone());
    }
    entity["data"] = Value::Object(data);
    Ok(entity)
}
