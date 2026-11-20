//! Typed reads of policy YAML values, and the evidence and text helpers every
//! part of the mapping shares.

use super::Document;
use crate::terms::escape;
use anyhow::{Context, Result, bail};
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

pub(super) fn object<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>> {
    value.as_object().with_context(|| format!("{label} must be a mapping"))
}

pub(super) fn list<'a>(value: Option<&'a Value>, label: &str) -> Result<&'a [Value]> {
    match value {
        None | Some(Value::Null) => Ok(&[]),
        Some(Value::Array(items)) => Ok(items),
        Some(_) => bail!("{label} must be a list"),
    }
}

pub(super) fn scalar(value: &Value, label: &str) -> Result<String> {
    Ok(match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        _ => bail!("{label} must be a scalar"),
    })
}

pub(super) fn scalars(value: Option<&Value>, label: &str) -> Result<Vec<String>> {
    list(value, label)?
        .iter()
        .enumerate()
        .map(|(index, value)| scalar(value, &format!("{label}[{index}]")))
        .collect()
}

pub(super) fn text<'a>(value: Option<&'a Value>, label: &str) -> Result<&'a str> {
    value
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .with_context(|| format!("{label} must be a nonempty string"))
}

/// A boolean field: `default` when it is absent or null, and an error when it
/// is anything but `true` or `false` (a quoted `"false"` among them).
pub(super) fn flag(value: Option<&Value>, default: bool, label: &str) -> Result<bool> {
    match value {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Bool(flag)) => Ok(*flag),
        Some(other) => bail!("{label} must be true or false, not {other}"),
    }
}

/// Fields Projections doesn't model yet, kept so a change to them still
/// marks the item modified and a reviewer is told they exist.
pub(super) fn unmodelled(object: &Map<String, Value>, known: &[&str], label: &str, limitations: &mut BTreeSet<String>) -> Option<Value> {
    let extra: Map<String, Value> = object
        .iter()
        .filter(|(field, _)| !known.contains(&field.as_str()))
        .map(|(field, value)| (field.clone(), value.clone()))
        .collect();
    if extra.is_empty() {
        return None;
    }
    for field in extra.keys() {
        limitations.insert(format!(
            "{} is not modelled; changes to it mark the item modified without interpretation.",
            code(&format!("{label}.{field}"))
        ));
    }
    Some(Value::Object(extra))
}

/// The 1-based line of the first line in `text` matching `pattern`, offset by
/// the document's first line.
pub(super) fn locate(document: &Document, pattern: &str) -> Option<usize> {
    let expression = regex::Regex::new(pattern).ok()?;
    let start = document.line?;
    document
        .text
        .lines()
        .position(|line| expression.is_match(line))
        .map(|offset| start + offset)
}

pub(super) fn evidence(document: &Document, line: Option<usize>) -> Value {
    let mut item = json!({"kind":"tetragon-tracing-policy","source":document.source});
    if let Some(line) = line {
        item["location"] = json!({"line":line});
    }
    json!([item])
}

/// `text` as an inline code span.
pub(super) fn code(text: &str) -> String {
    format!("`{}`", escape(text))
}

/// An ID without its kind prefix, to nest it in a child's ID.
pub(super) fn rest(id: &str) -> &str {
    id.split_once(':').map_or(id, |(_, rest)| rest)
}

pub(super) fn yaml_value(value: &str) -> String {
    regex::escape(value)
}
