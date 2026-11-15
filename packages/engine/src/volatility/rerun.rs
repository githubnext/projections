use super::assess::Declarations;
use super::generated::regenerated_because;
use crate::model::{Collection, Extraction, ItemRef};
use crate::{pointer, utf16_cmp};
use std::collections::BTreeMap;

/// A difference between two runs within the declared variation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Within {
    pub collection: String,
    pub id: String,
    pub path: String,
    /// Whether the value is generated (and was regenerated from an equal
    /// basis).
    pub generated: bool,
}

/// A difference between two runs that is not expected variation. Top-level
/// differences (schema, vocabularies, declarations) have no collection or ID.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Beyond {
    pub collection: Option<String>,
    pub id: Option<String>,
    pub path: String,
    pub reason: String,
    /// Whether the value is generated.
    pub generated: bool,
    /// A generated value's basis parts that differ.
    pub because: Vec<String>,
}

/// How two extractions of the same revision differ. They are reproducible
/// when `beyond` is empty.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Variation {
    /// Whether the canonical bytes are identical.
    pub equal: bool,
    pub within: Vec<Within>,
    pub beyond: Vec<Beyond>,
}

impl Variation {
    pub fn reproducible(&self) -> bool {
        self.beyond.is_empty()
    }
}

/// Compares two extractions of the same revision item by item, by ID, with
/// no matching: a rerun check. `equal` says whether their canonical bytes
/// are identical. Differences at volatile paths within tolerance are
/// `within`; everything else that differs, including items present in one
/// run only, is `beyond`.
pub fn rerun(before: &Extraction, after: &Extraction, equal: bool) -> Variation {
    let mut within = Vec::new();
    let mut beyond = top_level(before, after);
    let declarations = Declarations::of(before, after);
    for collection in Collection::ALL {
        let (old, new) = (index(before, collection), index(after, collection));
        let mut ids: Vec<&str> = old.keys().chain(new.keys()).copied().collect();
        ids.sort_by(|a, b| utf16_cmp(a, b));
        ids.dedup();
        for id in ids {
            let (Some(a), Some(b)) = (old.get(id), new.get(id)) else {
                let reason = if old.contains_key(id) {
                    "Only in the first run"
                } else {
                    "Only in the second run"
                };
                beyond.push(item_beyond(collection, id, String::new(), reason));
                continue;
            };
            let (found_within, found_beyond) = rerun_item(&declarations, *a, *b);
            within.extend(found_within);
            beyond.extend(found_beyond);
        }
    }
    Variation { equal, within, beyond }
}

/// The top-level differences between two runs: schema, vocabularies,
/// declarations and missing inputs.
fn top_level(before: &Extraction, after: &Extraction) -> Vec<Beyond> {
    [
        ("schema", before.schema != after.schema),
        ("vocabularies", before.vocabularies != after.vocabularies),
        ("volatile", before.volatile != after.volatile),
        ("missingInputs", before.missing_inputs != after.missing_inputs),
    ]
    .into_iter()
    .filter(|(_, differs)| *differs)
    .map(|(key, _)| Beyond {
        collection: None,
        id: None,
        path: pointer("", key),
        reason: format!("The runs' {key} differ"),
        generated: false,
        because: Vec::new(),
    })
    .collect()
}

/// A collection's items by ID.
fn index(extraction: &Extraction, collection: Collection) -> BTreeMap<&str, ItemRef<'_>> {
    extraction.items(collection).into_iter().map(|item| (item.id, item)).collect()
}

/// A difference of one item that is not expected variation.
fn item_beyond(collection: Collection, id: &str, path: String, reason: &str) -> Beyond {
    Beyond {
        collection: Some(collection.name().to_owned()),
        id: Some(id.to_owned()),
        path,
        reason: reason.to_owned(),
        generated: false,
        because: Vec::new(),
    }
}

/// How one item differs between two runs: its differences within the
/// declared variation, and those beyond it sorted by path.
fn rerun_item(declarations: &Declarations, a: ItemRef, b: ItemRef) -> (Vec<Within>, Vec<Beyond>) {
    let (collection, id) = (a.collection, a.id);
    let assessment = declarations.assess(a, b, None);
    let mut within = Vec::new();
    let mut found: Vec<Beyond> = Vec::new();
    for varied in assessment.varied {
        if varied.within {
            within.push(Within {
                collection: collection.name().to_owned(),
                id: id.to_owned(),
                path: varied.path,
                generated: varied.generated,
            });
        } else {
            let reason = varied.reason.unwrap_or_else(|| {
                if varied.generated {
                    regenerated_because(&varied.because)
                } else {
                    "Beyond the declared tolerance".to_owned()
                }
            });
            found.push(Beyond {
                generated: varied.generated,
                because: varied.because,
                ..item_beyond(collection, id, varied.path, &reason)
            });
        }
    }
    found.extend(
        assessment
            .residual
            .into_iter()
            .map(|path| item_beyond(collection, id, path, "Not declared volatile")),
    );
    found.sort_by(|a, b| utf16_cmp(&a.path, &b.path));
    (within, found)
}
