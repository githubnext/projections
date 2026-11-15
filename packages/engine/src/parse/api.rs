//! The Engine's JSON entry points for Rust callers: strict parsing, canonical
//! bytes and digests, extractions and comparisons read from JSON, and the
//! volatility results hosts store.

use super::comparison::check;
use super::encode::to_value;
use super::extraction::read;
use crate::model::Extraction;
use crate::volatility::{Variation, generated, rerun};
use crate::{COLLECTIONS, Failure, fail};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// RFC 8785 canonical JSON.
pub fn canonical(value: &Value) -> Result<String, Failure> {
    serde_jcs::to_string(value).map_err(|error| fail("canonicalization-failed", "", &error.to_string()))
}

/// Strict JSON: unique keys, valid Unicode, finite safe numbers, bounded depth.
pub fn parse_json(raw: &str) -> Result<Value, Failure> {
    super::json::parse(raw)
}

impl Extraction {
    /// Reads an extraction: validates it and returns it normalized, with
    /// defaults filled in and vocabularies, missing inputs, declarations and
    /// items in canonical order. `path` prefixes diagnostics.
    pub fn from_json(value: &Value, path: &str) -> Result<Extraction, Failure> {
        read(value, path)
    }
}

/// Validates and normalizes an extraction. `path` prefixes diagnostics.
pub fn normalize(extraction: &Value, path: &str) -> Result<Value, Failure> {
    read(extraction, path).map(|extraction| extraction.to_json())
}

/// Canonical bytes and lowercase SHA-256 digest of a normalized extraction.
/// Everything but `metadata`, evidence and identity claims is covered,
/// including volatile declarations and volatile values.
pub fn canonicalize(extraction: &Value) -> Result<(String, String), Failure> {
    let mut value = extraction.clone();
    value.as_object_mut().unwrap().remove("metadata");
    for collection in COLLECTIONS {
        value[collection] = Value::Array(extraction[collection].as_array().unwrap().iter().map(semantic).collect());
    }
    let canonical = canonical(&value)?;
    let digest = format!("{:x}", Sha256::digest(canonical.as_bytes()));
    Ok((canonical, digest))
}

/// Validates a comparison against two extractions, read first, and returns it.
pub fn validate_comparison(before: &Value, after: &Value, comparison: &Value) -> Result<Value, Failure> {
    let before = read(before, "/before")?;
    let after = read(after, "/after")?;
    check(&before, &after, comparison)?;
    Ok(comparison.clone())
}

/// Checks a comparison's JSON against two extractions.
pub fn check_comparison(before: &Extraction, after: &Extraction, comparison: &Value) -> Result<(), Failure> {
    check(before, after, comparison)
}

/// The semantic part of an entity or relationship: evidence and identity
/// claims never change semantic equality.
pub fn semantic(item: &Value) -> Value {
    let mut value = item.clone();
    let fields = value.as_object_mut().unwrap();
    fields.remove("previousIds");
    fields.remove("evidence");
    value
}

/// Canonical semantic content without the item's own ID. A before-side
/// relationship's endpoints are first rewritten through one-to-one entity
/// correspondence, so a renamed endpoint alone is not a content change.
pub fn content(item: &Value, endpoints: Option<&HashMap<String, String>>) -> Result<String, Failure> {
    canonical(&content_value(item, endpoints))
}

/// The value [`content`] canonicalizes.
pub fn content_value(item: &Value, endpoints: Option<&HashMap<String, String>>) -> Value {
    let mut value = semantic(item);
    let fields = value.as_object_mut().unwrap();
    fields.remove("id");
    fields.entry("data").or_insert(json!({}));
    if let Some(endpoints) = endpoints {
        for key in ["from", "to"] {
            if let Some(id) = value[key].as_str().and_then(|id| endpoints.get(id)) {
                value[key] = json!(id);
            }
        }
    }
    value
}

/// A basis's digest: `sha256:` over its RFC 8785 canonical JSON. With the
/// declared path, the generation store's key.
pub fn basis_digest(basis: &Value) -> Result<String, Failure> {
    Ok(crate::volatility::sha256(canonical(basis)?.as_bytes()))
}

/// One generated value in an extraction, as the generation store keeps it.
#[derive(Debug, Clone, PartialEq)]
pub struct Generated {
    pub collection: &'static str,
    pub id: String,
    /// The declaration's path, `*` segments and all: half of the store key.
    pub declared: String,
    /// The concrete pointer into the item.
    pub path: String,
    /// The basis digest: the other half.
    pub basis: String,
    pub value: Value,
}

/// Every generated value of a normalized extraction, with its basis digest,
/// in collection, item and declaration order; none when it isn't a valid
/// extraction.
pub fn generated_values(extraction: &Value) -> Vec<Generated> {
    let Ok(extraction) = read(extraction, "") else {
        return Vec::new();
    };
    generated(&extraction)
        .into_iter()
        .map(|found| Generated {
            collection: found.collection.name(),
            id: found.id.to_owned(),
            declared: found.declared.to_owned(),
            path: found.path,
            basis: basis_digest(&to_value(found.basis)).expect("a validated basis canonicalizes"),
            value: to_value(found.value),
        })
        .collect()
}

/// Compares two extractions of the same revision item by item, by ID, with
/// no matching: a rerun check. Both are read first.
pub fn vary(before: &Value, after: &Value) -> Result<Variation, Failure> {
    let before = read(before, "/before")?;
    let after = read(after, "/after")?;
    let equal = canonicalize(&before.to_json())?.0 == canonicalize(&after.to_json())?.0;
    Ok(rerun(&before, &after, equal))
}
