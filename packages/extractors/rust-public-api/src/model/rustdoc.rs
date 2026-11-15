//! Reading rustdoc JSON items: IDs, inner kinds, visibility and attributes.

use anyhow::{Result, bail};
use serde_json::Value;

pub(super) fn key(id: &Value) -> Result<String> {
    match id {
        Value::Number(number) => Ok(number.to_string()),
        Value::String(text) => Ok(text.clone()),
        _ => bail!("rustdoc JSON item ID `{id}` is not a number"),
    }
}

/// The item's single `inner` kind and its value.
pub(super) fn inner(item: &Value) -> Option<(&str, &Value)> {
    item["inner"]
        .as_object()
        .and_then(|inner| inner.iter().next())
        .map(|(kind, value)| (kind.as_str(), value))
}

pub(super) fn public(item: &Value) -> bool {
    item["visibility"] == "public"
}

pub(super) fn has_attribute(item: &Value, name: &str) -> bool {
    item["attrs"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|attribute| attribute == name || attribute.get(name).is_some())
}

/// `#[repr]` attributes, as stable text.
pub(super) fn repr(item: &Value) -> Vec<String> {
    item["attrs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|attribute| attribute.get("repr"))
        .map(Value::to_string)
        .collect()
}

/// The attributes a signature shows.
pub(super) fn attributes(item: &Value) -> String {
    let mut shown = String::new();
    if has_attribute(item, "non_exhaustive") {
        shown.push_str("#[non_exhaustive] ");
    }
    shown
}
