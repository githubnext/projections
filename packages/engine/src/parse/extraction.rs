//! An extraction, read: validated and normalized into an [`Extraction`].

use super::datum::{fields as data_fields, number};
use super::fields::{array, fields, length, object, optional, text};
use super::items::{entity, relationship};
use super::volatile::declarations;
use crate::canonical::{canonical_order, word};
use crate::data_rules::VOCABULARIES;
use crate::model::{Extraction, Number};
use crate::validate::{MAX_ENTITIES, MAX_EXTRACTION_BYTES, MAX_RELATIONSHIPS, SCHEMAS, check_identities, sort_items, validate_domain};
use crate::volatility::check_bases;
use crate::{Failure, fail, pointer};
use serde_json::Value;
use std::collections::HashSet;

/// At most this many missing inputs are recorded on an extraction.
pub const MAX_MISSING_INPUTS: usize = 256;

/// Reads an extraction: validates it and returns it normalized, with
/// defaults filled in and vocabularies, missing inputs, declarations and
/// items in canonical order. `path` prefixes diagnostics.
pub(crate) fn read(value: &Value, path: &str) -> Result<Extraction, Failure> {
    fields(
        value,
        &[
            "protocolVersion",
            "schema",
            "vocabularies",
            "entities",
            "relationships",
            "volatile",
            "missingInputs",
            "metadata",
        ],
        path,
    )?;
    let protocol_version = version(&value["protocolVersion"], &pointer(path, "protocolVersion"))?;
    let schema_path = pointer(path, "schema");
    let schema = text(&value["schema"], &schema_path, true)?;
    let Some(schema) = SCHEMAS.iter().copied().find(|known| *known == schema) else {
        return Err(fail("unsupported-schema", &schema_path, "Unsupported domain schema"));
    };
    let vocabularies = optional(value, "vocabularies", path, |value, path| vocabularies(value, schema, path))?.unwrap_or_default();
    nested(value, path, 0)?;
    if length(value) > MAX_EXTRACTION_BYTES {
        return Err(fail("extraction-size-limit", path, "Extraction exceeds 8 MiB"));
    }
    let mut extraction = Extraction {
        protocol_version,
        schema,
        vocabularies,
        missing_inputs: optional(value, "missingInputs", path, missing_inputs)?.unwrap_or_default(),
        volatile: optional(value, "volatile", path, declarations)?.unwrap_or_default(),
        entities: Vec::new(),
        relationships: Vec::new(),
        metadata: None,
    };
    let mut ids = HashSet::new();
    extraction.entities = collection(value, path, "entities", MAX_ENTITIES, &mut ids, entity)?;
    extraction.relationships = collection(value, path, "relationships", MAX_RELATIONSHIPS, &mut ids, relationship)?;
    check_identities(&extraction, path)?;
    extraction.metadata = optional(value, "metadata", path, |metadata, path| data_fields(object(metadata, path)?, path))?;
    validate_domain(&extraction, path)?;
    check_bases(&extraction, path)?;
    sort_items(&mut extraction);
    if length(&extraction) > MAX_EXTRACTION_BYTES {
        return Err(fail("extraction-size-limit", path, "Normalized extraction exceeds 8 MiB"));
    }
    Ok(extraction)
}

/// The protocol version: 0, in either form.
fn version(value: &Value, path: &str) -> Result<Number, Failure> {
    match value {
        Value::Number(version) if version.as_f64() == Some(0.0) => number(version, path),
        _ => Err(fail("unsupported-version", path, "Expected protocolVersion 0")),
    }
}

/// One collection's items, each read and its ID, unique across both
/// collections, recorded in `ids`.
fn collection<T>(
    value: &Value,
    path: &str,
    name: &str,
    maximum: usize,
    ids: &mut HashSet<String>,
    read: fn(&Value, &str) -> Result<T, Failure>,
) -> Result<Vec<T>, Failure>
where
    T: Identified,
{
    let collection_path = pointer(path, name);
    let items = array(&value[name], &collection_path)?;
    if items.len() > maximum {
        return Err(fail(
            "entity-limit",
            &collection_path,
            &format!("Collection exceeds {maximum} items"),
        ));
    }
    let mut result = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let item_path = pointer(&collection_path, &index.to_string());
        let item = read(item, &item_path)?;
        if !ids.insert(item.id().to_owned()) {
            return Err(fail("duplicate-id", &pointer(&item_path, "id"), "IDs must be globally unique"));
        }
        result.push(item);
    }
    Ok(result)
}

trait Identified {
    fn id(&self) -> &str;
}

impl<S> Identified for crate::model::Item<S> {
    fn id(&self) -> &str {
        &self.id
    }
}

fn nested(value: &Value, path: &str, depth: usize) -> Result<(), Failure> {
    if depth > 50 {
        return Err(fail("depth-limit", path, "Extraction JSON nesting exceeds 50 levels"));
    }
    if let Some(values) = value.as_array() {
        for (index, child) in values.iter().enumerate() {
            nested(child, &pointer(path, &index.to_string()), depth + 1)?;
        }
    }
    if let Some(values) = value.as_object() {
        for (key, child) in values {
            nested(child, &pointer(path, key), depth + 1)?;
        }
    }
    Ok(())
}

/// An extraction's `missingInputs`: declared inputs absent at the revision, as
/// distinct nonblank repository-relative paths or globs, in UTF-16 order.
fn missing_inputs(value: &Value, path: &str) -> Result<Vec<String>, Failure> {
    let items = array(value, path)?;
    if items.len() > MAX_MISSING_INPUTS {
        return Err(fail(
            "missing-inputs-limit",
            path,
            &format!("At most {MAX_MISSING_INPUTS} missing inputs"),
        ));
    }
    let mut paths = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let item_path = pointer(path, &index.to_string());
        let text = text(item, &item_path, true)?;
        if text.chars().count() > 1024 || text.contains('\0') {
            return Err(fail(
                "invalid-missing-input",
                &item_path,
                "Expected a repository-relative path of at most 1024 characters without NULs",
            ));
        }
        paths.push(text.to_owned());
    }
    canonical_order(&mut paths, |path| vec![word(path)]);
    if paths.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(fail("duplicate-missing-input", path, "Missing inputs must be distinct"));
    }
    Ok(paths)
}

/// The vocabularies an extraction declares, each known, applicable to its
/// schema and declared once, in canonical (sorted) order.
fn vocabularies(declared: &Value, schema: &str, path: &str) -> Result<Vec<&'static str>, Failure> {
    let mut result = Vec::new();
    for (index, item) in array(declared, path)?.iter().enumerate() {
        let item_path = pointer(path, &index.to_string());
        let name = text(item, &item_path, true)?;
        match VOCABULARIES.iter().find(|(known, _)| *known == name) {
            None => {
                return Err(fail("unsupported-vocabulary", &item_path, "Unsupported vocabulary"));
            }
            Some((_, schemas)) if !schemas.contains(&schema) => {
                return Err(fail(
                    "unsupported-vocabulary",
                    &item_path,
                    &format!("This vocabulary applies to {}", schemas.join(", ")),
                ));
            }
            Some((known, _)) if result.contains(known) => {
                return Err(fail("duplicate-vocabulary", &item_path, "Vocabularies are declared once"));
            }
            Some((known, _)) => result.push(*known),
        }
    }
    canonical_order(&mut result, |name| vec![word(name)]);
    Ok(result)
}
