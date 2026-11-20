//! Whether two extractions can be compared: they must come from one projection,
//! one definition and one version of its component code. This is the only
//! implementation; JavaScript hosts reach it through the `pair` operation
//! (`engine.pair`), and the shared conformance corpus checks it everywhere.

use crate::{Failure, canonical, fail};
use serde_json::{Value, json};
use std::collections::BTreeSet;

/// The part of a definition that decides what is extracted and compared: all of it
/// but `presentation`, the viewers' initial settings. The definition digest covers
/// exactly this (with the declared sources' bytes), so a presentation-only edit
/// never makes extractions incomparable.
pub fn extraction_definition(definition: &Value) -> Value {
    let mut extraction = definition.clone();
    if let Some(object) = extraction.as_object_mut() {
        object.remove("presentation");
    }
    extraction
}

/// Whether two extractions come from one projection definition, by what each
/// records: its projection's ID and its provenance's definition and digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Pairing {
    /// One projection, one definition and one version of its component code: comparable.
    Same,
    /// Different projections.
    Projection,
    /// The recorded definitions differ in these top-level fields, `presentation`
    /// aside (whatever their digests say).
    Definition(Vec<String>),
    /// The recorded definitions agree, `presentation` aside, but their digests
    /// differ: the bytes of their declared component sources do.
    Components,
}

impl Pairing {
    pub fn to_json(&self) -> Value {
        match self {
            Self::Same => json!({"pairing": "same"}),
            Self::Projection => json!({"pairing": "projection"}),
            Self::Definition(differing) => json!({"pairing": "definition", "differing": differing}),
            Self::Components => json!({"pairing": "components"}),
        }
    }
}

struct Side<'a> {
    id: &'a str,
    definition: Value,
    digest: &'a str,
}

fn side<'a>(document: &'a Value, path: &str) -> Result<Side<'a>, Failure> {
    let string = |value: &'a Value, at: &str| {
        value
            .as_str()
            .ok_or_else(|| fail("invalid-type", &format!("{path}{at}"), "Expected a string"))
    };
    let definition = &document["provenance"]["definition"];
    if !definition.is_object() {
        return Err(fail("invalid-type", &format!("{path}/provenance/definition"), "Expected an object"));
    }
    Ok(Side {
        id: string(&document["projection"]["id"], "/projection/id")?,
        definition: extraction_definition(definition),
        digest: string(&document["provenance"]["definitionDigest"], "/provenance/definitionDigest")?,
    })
}

/// Whether extraction documents `before` and `after` can be compared, from their
/// `projection.id`, `provenance.definition` and `provenance.definitionDigest`;
/// other fields are ignored. Fails when one of those is missing or mistyped.
pub fn pairing(before: &Value, after: &Value) -> Result<Pairing, Failure> {
    let (before, after) = (side(before, "/before")?, side(after, "/after")?);
    if before.id != after.id {
        return Ok(Pairing::Projection);
    }
    let fields: BTreeSet<&String> = [&before.definition, &after.definition]
        .into_iter()
        .filter_map(Value::as_object)
        .flat_map(|object| object.keys())
        .collect();
    let mut differing = Vec::new();
    for field in fields {
        let value = |definition: &Value| definition.get(field).map(canonical).transpose();
        if value(&before.definition)? != value(&after.definition)? {
            differing.push(field.clone());
        }
    }
    Ok(if !differing.is_empty() {
        Pairing::Definition(differing)
    } else if before.digest != after.digest {
        Pairing::Components
    } else {
        Pairing::Same
    })
}
