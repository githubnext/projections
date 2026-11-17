//! Entities and relationships: each read field by field, in the order the
//! contract checks them.

use super::datum::{fields as data_fields, number};
use super::fields::{array, fields, name, object, optional, text};
use crate::model::{Confidence, Entity, Evidence, Fields, Item, Link, Location, Node, Number, Relationship};
use crate::{Failure, fail, pointer};
use serde_json::Value;
use std::collections::HashSet;

pub(super) fn entity(value: &Value, path: &str) -> Result<Entity, Failure> {
    item(
        value,
        path,
        &["id", "kind", "label", "data", "previousIds", "evidence", "confidence"],
        |value, path| {
            Ok(Node {
                label: text(&value["label"], &pointer(path, "label"), false)?.to_owned(),
            })
        },
    )
}

pub(super) fn relationship(value: &Value, path: &str) -> Result<Relationship, Failure> {
    item(
        value,
        path,
        &["id", "kind", "label", "from", "to", "data", "previousIds", "evidence", "confidence"],
        |value, path| {
            Ok(Link {
                label: optional(value, "label", path, |label, path| text(label, path, false).map(str::to_owned))?,
                from: name(&value["from"], &pointer(path, "from"))?,
                to: name(&value["to"], &pointer(path, "to"))?,
            })
        },
    )
}

/// One item: its known fields, ID and kind, then its own part (`shape`),
/// data, identity claims, evidence and confidence.
fn item<S>(
    value: &Value,
    path: &str,
    allowed: &[&str],
    shape: impl FnOnce(&Value, &str) -> Result<S, Failure>,
) -> Result<Item<S>, Failure> {
    fields(value, allowed, path)?;
    let id = name(&value["id"], &pointer(path, "id"))?;
    let kind = name(&value["kind"], &pointer(path, "kind"))?;
    let shape = shape(value, path)?;
    let data = optional(value, "data", path, |data, path| data_fields(object(data, path)?, path))?.unwrap_or_else(Fields::new);
    Ok(Item {
        id,
        kind,
        shape,
        data,
        previous_ids: optional(value, "previousIds", path, previous_ids)?,
        evidence: optional(value, "evidence", path, evidence)?,
        confidence: optional(value, "confidence", path, confidence)?,
    })
}

/// Distinct nonblank previous IDs.
fn previous_ids(value: &Value, path: &str) -> Result<Vec<String>, Failure> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for (index, id) in array(value, path)?.iter().enumerate() {
        let path = pointer(path, &index.to_string());
        let id = text(id, &path, true)?;
        if !seen.insert(id) {
            return Err(fail("ambiguous-identity", &path, "Duplicate previous ID"));
        }
        result.push(id.to_owned());
    }
    Ok(result)
}

fn evidence(value: &Value, path: &str) -> Result<Vec<Evidence>, Failure> {
    let mut result = Vec::new();
    for (index, item) in array(value, path)?.iter().enumerate() {
        let path = pointer(path, &index.to_string());
        misplaced_evidence(item, &path)?;
        fields(item, &["kind", "source", "location"], &path)?;
        result.push(Evidence {
            kind: name(&item["kind"], &pointer(&path, "kind"))?,
            source: name(&item["source"], &pointer(&path, "source"))?,
            location: optional(item, "location", &path, location)?,
        });
    }
    Ok(result)
}

/// Evidence fields people reach for that belong elsewhere: a position goes in
/// `location`, a file in `source`.
fn misplaced_evidence(item: &Value, path: &str) -> Result<(), Failure> {
    const IGNORED: &str = "The default comparator ignores evidence, so moved code doesn't show as a change";
    let Some(item) = item.as_object() else {
        return Ok(());
    };
    for key in item.keys() {
        let message = match key.as_str() {
            "line" => format!("Unknown field; a line goes in location: {{\"location\": {{\"line\": 12}}}}. {IGNORED}"),
            "column" | "startLine" | "endLine" | "lineNumber" | "start" | "end" | "range" | "position" => {
                format!("Unknown field; a position goes in location: {{\"location\": {{\"line\": 12, \"column\": 5}}}}. {IGNORED}")
            }
            "file" | "path" | "uri" => format!("Unknown field; the {key} goes in source: {{\"source\": \"src/app.ts\"}}"),
            _ => continue,
        };
        return Err(fail("unknown-field", &pointer(path, key), &message));
    }
    Ok(())
}

fn location(value: &Value, path: &str) -> Result<Location, Failure> {
    fields(value, &["line", "column"], path)?;
    Ok(Location {
        line: position(&value["line"], &pointer(path, "line"))?,
        column: optional(value, "column", path, position)?,
    })
}

/// A positive integer, in either form.
fn position(value: &Value, path: &str) -> Result<Number, Failure> {
    match value {
        Value::Number(position) if position.as_f64().is_some_and(|n| n >= 1.0 && n.fract() == 0.0) => number(position, path),
        _ => Err(fail("invalid-location", path, "Expected a positive safe integer")),
    }
}

fn confidence(value: &Value, path: &str) -> Result<Confidence, Failure> {
    Confidence::ALL
        .into_iter()
        .find(|confidence| value.as_str() == Some(confidence.name()))
        .ok_or_else(|| fail("invalid-confidence", path, "Expected authoritative, derived, or inferred"))
}
