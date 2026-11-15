use anyhow::{Context, Result, bail, ensure};
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

/// Parses JSON with the Engine, which sees the original text before a host parser
/// could erase duplicate keys.
pub fn parse_json(raw: &str) -> Result<Value> {
    let request = json!({"version":0,"operation":"parse-json","json":raw});
    let response = projections_engine::handle(&serde_json::to_vec(&request)?);
    if response["ok"] != true {
        bail!("Engine rejected input: {}", response["diagnostics"]);
    }
    Ok(response["result"].clone())
}

pub fn text<'a>(value: &'a Value, label: &str) -> Result<&'a str> {
    let s = value.as_str().with_context(|| format!("{label} must be a nonempty string"))?;
    ensure!(
        !s.trim().is_empty() && !s.contains('\0'),
        "{label} must be a nonempty string without NULs"
    );
    Ok(s)
}

pub fn strings(value: &Value, label: &str) -> Result<Vec<String>> {
    array(value, label)?.iter().map(|v| Ok(text(v, label)?.to_owned())).collect()
}

pub fn array<'a>(value: &'a Value, label: &str) -> Result<&'a Vec<Value>> {
    value.as_array().with_context(|| format!("{label} must be an array"))
}

pub fn object<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>> {
    value.as_object().with_context(|| format!("{label} must be an object"))
}

pub fn input<'a>(definition: &'a Value, name: &str, fallback: Option<&'a str>) -> Result<&'a str> {
    match definition["inputs"].get(name) {
        Some(value) if !value.is_null() => text(value, &format!("inputs.{name}")),
        _ => fallback.with_context(|| format!("inputs.{name} must be a nonempty string")),
    }
}

pub fn percent(value: &str) -> String {
    let mut result = String::new();
    for b in value.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            result.push(b as char);
        } else {
            result.push_str(&format!("%{b:02X}"));
        }
    }
    result
}

pub fn key(parts: &[&str]) -> String {
    parts.iter().map(|s| percent(s)).collect::<Vec<_>>().join(":")
}

pub fn stable(value: &Value) -> String {
    match value {
        Value::Object(m) => {
            let mut keys: Vec<_> = m.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|k| format!("{}:{}", serde_json::to_string(k).unwrap(), stable(&m[k])))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        Value::Array(a) => format!("[{}]", a.iter().map(stable).collect::<Vec<_>>().join(",")),
        _ => serde_json::to_string(value).unwrap(),
    }
}

pub fn relationship(kind: &str, from: &str, to: &str) -> Value {
    json!({"id":key(&[kind,from,to]),"kind":kind,"from":from,"to":to,"confidence":"authoritative"})
}

pub fn unique_relationships(relationships: Vec<Value>) -> Vec<Value> {
    let mut seen = BTreeSet::new();
    relationships
        .into_iter()
        .filter(|e| seen.insert(e["id"].as_str().unwrap().to_owned()))
        .collect()
}

pub fn extraction(schema: &str, entities: Vec<Value>, relationships: Vec<Value>, metadata: Option<Value>) -> Value {
    let mut value = json!({"protocolVersion":0,"schema":schema,"entities":entities,"relationships":relationships});
    if let Some(m) = metadata {
        value["metadata"] = m;
    }
    value
}

/// Checks only the exported transport envelope; the Engine validates every item.
pub fn exported(value: Value, schema: &str) -> Result<Value> {
    ensure!(
        value["protocolVersion"] == 0 && value["schema"] == schema && value["entities"].is_array() && value["relationships"].is_array(),
        "Exported extraction must have protocolVersion 0, schema {schema}, entities and relationships"
    );
    for item in array(&value["entities"], "entities")?
        .iter()
        .chain(array(&value["relationships"], "relationships")?)
    {
        object(item, "Exported item")?;
        ensure!(
            item["id"].is_string() && item["kind"].is_string(),
            "Exported item requires id and kind"
        );
        if let Some(data) = item.get("data") {
            object(data, "Exported item data")?;
        }
    }
    Ok(value)
}

pub fn database_extraction(value: Value) -> Result<Value> {
    let value = exported(value, "database/v0")?;
    for entity in array(&value["entities"], "entities")? {
        if entity["kind"] == "column" {
            text(&entity["data"]["type"], &format!("Database column {} data.type", entity["id"]))?;
        }
    }
    Ok(value)
}

/// Reads `inputs.snapshot` as a pre-exported `database/v0` extraction. A
/// revision without the snapshot (before it was added) has an empty schema, and
/// the snapshot is recorded as a missing input.
pub fn pre_exported_schema(cx: &crate::Context, definition: &Value) -> Result<Value> {
    let filename = input(definition, "snapshot", None)?;
    let mut value = if cx.input_exists(filename)? {
        database_extraction(cx.read_json(filename)?)?
    } else {
        extraction("database/v0", vec![], vec![], None)
    };
    if value.get("metadata").is_none() {
        value["metadata"] = json!({});
    }
    object(&value["metadata"], "schema metadata")?;
    value["metadata"]["authority"] = json!("pre-exported database schema");
    value["metadata"]["snapshot"] = json!(filename);
    Ok(value)
}
