//! Determinism as a measured signal, like flaky-test detection: how two runs
//! of one revision (a rerun, or a local run and CI's) differ, item by item.
//! The Engine's `vary` decides: differences at the paths an extraction
//! declares `volatile`, within their tolerances, are expected variation; any
//! other difference means the runs are not reproducible.

use anyhow::Result;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// How two extractions of the same revision differ.
#[derive(Debug, Default)]
pub struct Variation {
    /// Items (entities and relationships) in either extraction.
    pub items: usize,
    /// Whether the extractions are identical.
    pub equal: bool,
    /// Items whose differences are all expected variation: `entity ID`.
    pub within: Vec<String>,
    /// Each difference beyond the declared variation, by item (`entity ID`,
    /// `relationship ID`, or `extraction` for the schema, vocabularies or
    /// volatile declarations), with the JSON pointers that differ (empty when
    /// the item is in only one run).
    pub varied: Vec<(String, Vec<String>)>,
    /// Generated values that were regenerated from an equal basis: reworded,
    /// but expected variation.
    pub regenerated: usize,
}

impl Variation {
    /// Whether the two runs are identical.
    pub fn identical(&self) -> bool {
        self.equal
    }

    /// Whether the runs agree up to their declared variation.
    pub fn reproducible(&self) -> bool {
        self.varied.is_empty()
    }

    /// The share of items that vary beyond what is declared, in percent.
    pub fn percent(&self) -> f64 {
        if self.items == 0 {
            0.0
        } else {
            self.varied.len() as f64 * 100.0 / self.items as f64
        }
    }

    /// The first differences beyond the declared variation, in words:
    /// `entity a (/data/size), relationship b (only in one run)`.
    pub fn describe(&self, limit: usize) -> String {
        let mut text = self
            .varied
            .iter()
            .take(limit)
            .map(|(item, paths)| {
                if paths.is_empty() {
                    format!("{item} (only in one run)")
                } else {
                    format!("{item} ({})", paths.join(", "))
                }
            })
            .collect::<Vec<_>>()
            .join("; ");
        if self.varied.len() > limit {
            text.push_str(&format!("; and {} more", self.varied.len() - limit));
        }
        text
    }
}

fn singular(collection: &str) -> &'static str {
    if collection == "relationships" { "relationship" } else { "entity" }
}

/// How the extractions of two saved extraction documents differ, as the
/// Engine's `vary` judges them.
pub fn variation(first: &Value, second: &Value) -> Result<Variation> {
    let mut ids = BTreeSet::new();
    for document in [first, second] {
        for collection in ["entities", "relationships"] {
            for item in document["extraction"][collection].as_array().into_iter().flatten() {
                if let Some(id) = item["id"].as_str() {
                    ids.insert((collection, id.to_owned()));
                }
            }
        }
    }
    let judged = crate::engine("vary", json!({"before": first["extraction"], "after": second["extraction"]}))?;
    let mut varied: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for beyond in judged["beyond"].as_array().into_iter().flatten() {
        let item = match (beyond["collection"].as_str(), beyond["id"].as_str()) {
            (Some(collection), Some(id)) => format!("{} {id}", singular(collection)),
            _ => "extraction".to_owned(),
        };
        let paths = varied.entry(item).or_default();
        let path = beyond["path"].as_str().unwrap_or_default();
        // An item present in only one run has no differing path inside it.
        let whole = beyond["reason"].as_str().is_some_and(|reason| reason.contains("one run"));
        if !path.is_empty() && !whole && paths.len() < 5 && !paths.iter().any(|known| known == path) {
            paths.push(path.to_owned());
        }
    }
    let within: BTreeSet<String> = judged["within"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|within| {
            let item = format!("{} {}", singular(within["collection"].as_str()?), within["id"].as_str()?);
            (!varied.contains_key(&item)).then_some(item)
        })
        .collect();
    let regenerated = judged["within"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|within| within["generated"] == true)
        .count();
    Ok(Variation {
        items: ids.len(),
        equal: judged["equal"] == true,
        within: within.into_iter().collect(),
        varied: varied.into_iter().collect(),
        regenerated,
    })
}

/// Whether an extraction holds generated values.
pub fn generates(document: &Value) -> bool {
    !projections_engine::volatility::generated_values(&document["extraction"]).is_empty()
}

/// Whether an extraction declares volatile fields.
pub fn declares_volatile(document: &Value) -> bool {
    document["extraction"]["volatile"]
        .as_array()
        .is_some_and(|declarations| !declarations.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(entities: Value, volatile: Option<Value>) -> Value {
        let mut extraction = json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": []});
        if let Some(volatile) = volatile {
            extraction["volatile"] = volatile;
        }
        json!({"extraction": extraction})
    }

    #[test]
    fn variation_names_the_items_and_fields_that_differ_beyond_what_is_declared() {
        let first = document(
            json!([
                {"id": "a", "kind": "k", "label": "A", "data": {"size": 1, "n": [1, 2]}},
                {"id": "b", "kind": "k", "label": "B"}
            ]),
            None,
        );
        let second = document(
            json!([
                {"id": "a", "kind": "k", "label": "A", "data": {"size": 2, "n": [1, 3]}},
                {"id": "c", "kind": "k", "label": "C"}
            ]),
            None,
        );
        let variation = variation(&first, &second).unwrap();
        assert_eq!(variation.items, 3);
        assert!(!variation.reproducible() && !variation.identical());
        assert_eq!(variation.varied.len(), 3);
        let described = variation.describe(5);
        assert!(described.contains("entity a (/data/n, /data/size)"), "{described}");
        assert!(described.contains("entity b (only in one run)"), "{described}");
        assert!((variation.percent() - 100.0).abs() < 1e-9);
        assert!(super::variation(&first, &first).unwrap().identical());
    }

    #[test]
    fn declared_volatile_fields_within_tolerance_are_reproducible() {
        let volatile = json!([{"path": "/data/durationMs", "tolerance": {"relative": 0.2}}]);
        let run = |duration: u64| {
            document(
                json!([{"id": "t", "kind": "test", "label": "T", "data": {"durationMs": duration}}]),
                Some(volatile.clone()),
            )
        };
        let close = variation(&run(100), &run(110)).unwrap();
        assert!(close.reproducible() && !close.identical());
        assert_eq!(close.within, ["entity t"]);
        let far = variation(&run(100), &run(200)).unwrap();
        assert!(!far.reproducible());
        assert!(far.describe(5).contains("entity t (/data/durationMs)"), "{}", far.describe(5));
        assert!(declares_volatile(&run(1)));
    }
}
