//! The facts an extraction's parser establishes across its items: unique
//! IDs, unambiguous identity claims, existing endpoints, and the rules of its
//! domain schema and vocabularies. The parser runs these checks while the
//! items are still in input order, so paths name the input's items, then
//! sorts them.

mod domain;

pub(crate) use domain::validate_domain;

use crate::canonical::{canonical_order, word};
use crate::model::{Collection, Extraction};
use crate::{Failure, fail, pointer};
use std::collections::{HashMap, HashSet};

pub const SCHEMAS: &[&str] = &[
    "graph/v0",
    "dag/v0",
    "treemap/v0",
    "metrics/v0",
    "api/v0",
    "database/v0",
    "architecture/v0",
];
pub const MAX_EXTRACTION_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_ENTITIES: usize = 10_000;
pub const MAX_RELATIONSHIPS: usize = 50_000;

/// Checks identity claims and endpoints. Several items of one collection may
/// claim the same previous ID, which declares a split. A claim may not name
/// a current ID or cross collections. IDs are already unique.
pub(crate) fn check_identities(extraction: &Extraction, path: &str) -> Result<(), Failure> {
    let entity_ids: HashSet<&str> = extraction.entities.iter().map(|entity| entity.id.as_str()).collect();
    let ids: HashSet<&str> = entity_ids
        .iter()
        .copied()
        .chain(extraction.relationships.iter().map(|relationship| relationship.id.as_str()))
        .collect();
    let mut claims: HashMap<&str, Collection> = HashMap::new();
    for collection in Collection::ALL {
        for (index, item) in extraction.items(collection).iter().enumerate() {
            let item_path = pointer(&pointer(path, collection.name()), &index.to_string());
            for (index, id) in item.previous_ids.unwrap_or_default().iter().enumerate() {
                if ids.contains(id.as_str()) || *claims.entry(id).or_insert(collection) != collection {
                    return Err(fail(
                        "ambiguous-identity",
                        &pointer(&pointer(&item_path, "previousIds"), &index.to_string()),
                        "Previous ID collides with a current ID or a claim in another collection",
                    ));
                }
            }
            for (key, endpoint) in item
                .endpoints
                .into_iter()
                .flat_map(|endpoints| ["from", "to"].into_iter().zip(endpoints))
            {
                if !entity_ids.contains(endpoint) {
                    return Err(fail(
                        "missing-endpoint",
                        &pointer(&item_path, key),
                        "Relationship endpoint must identify an existing entity",
                    ));
                }
            }
        }
    }
    Ok(())
}

/// Sorts each collection's items by ID and each item's previous IDs, by
/// UTF-16 code units, in the proved canonical order.
pub(crate) fn sort_items(extraction: &mut Extraction) {
    for previous in extraction
        .entities
        .iter_mut()
        .filter_map(|entity| entity.previous_ids.as_mut())
        .chain(
            extraction
                .relationships
                .iter_mut()
                .filter_map(|relationship| relationship.previous_ids.as_mut()),
        )
    {
        canonical_order(previous, |id| vec![word(id)]);
    }
    canonical_order(&mut extraction.entities, |entity| vec![word(&entity.id)]);
    canonical_order(&mut extraction.relationships, |relationship| vec![word(&relationship.id)]);
}
