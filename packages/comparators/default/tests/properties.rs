//! Property-based invariants of the default comparator over random graphs
//! with renames, splits and merges.

use projections_comparator_default::compare;
use projections_engine::{normalize, validate_comparison};
use proptest::prelude::*;
use proptest::test_runner::Config;
use serde_json::{Value, json};
use std::collections::{BTreeSet, HashMap};

const IDS: [&str; 7] = ["a", "b", "c", "d", "e", "\u{1f600}", "\u{e000}"];

/// A random graph extraction over a small shared ID pool, so two of them
/// overlap. Entities may claim absent pool IDs as previous IDs.
fn side() -> impl Strategy<Value = Value> {
    prop::sample::subsequence(IDS.to_vec(), 0..=IDS.len())
        .prop_flat_map(|ids| {
            let count = ids.len();
            (
                Just(ids),
                prop::collection::vec(
                    (
                        prop::sample::select(vec!["x", "y"]),
                        prop::collection::btree_set(prop::sample::select(IDS.to_vec()), 0..3),
                        prop::option::of((0..4u8, 0..3u8, 0..3u8)),
                    ),
                    count,
                ),
                prop::collection::btree_set((0..count.max(1), 0..count.max(1), 0..2u8), 0..8),
                // At most one declaration of each path: of the size, then of the summary.
                (prop::option::of(0..3usize), prop::option::of(3..5usize)),
            )
        })
        .prop_map(|(ids, details, edges, volatile)| {
            let present: BTreeSet<&str> = ids.iter().copied().collect();
            let entities: Vec<_> = ids
                .iter()
                .zip(details)
                .map(|(id, (label, claims, size))| {
                    let mut entity = json!({"id": id, "kind": "entity", "label": label});
                    let claims: Vec<_> = claims.into_iter().filter(|id| !present.contains(id)).collect();
                    if !claims.is_empty() {
                        entity["previousIds"] = json!(claims);
                    }
                    // A size with two spreads, and a summary generated from two bases.
                    if let Some((size, a, b)) = size {
                        entity["data"] = json!({"size": size, "a": a, "b": b, "summary": format!("s{}", size % 2),
                            "basisA": {"input": format!("h{a}")}, "basisB": {"input": format!("h{b}")}});
                    }
                    entity
                })
                .collect();
            // Relationship IDs do not encode their endpoints, so one ID can
            // connect different entities on either side.
            let mut relationships = std::collections::BTreeMap::new();
            if !ids.is_empty() {
                for (from, to, kind) in edges {
                    relationships
                        .entry(format!("r:{}", (from + 2 * to + usize::from(kind)) % 5))
                        .or_insert_with_key(|id| json!({"id": id, "kind": format!("k{kind}"), "from": ids[from], "to": ids[to]}));
                }
            }
            let relationships: Vec<_> = relationships.into_values().collect();
            let volatile: Vec<Value> = [volatile.0, volatile.1]
                .into_iter()
                .flatten()
                .map(|index| VOLATILE[index].clone())
                .collect();
            let mut extraction = json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": relationships});
            if !volatile.is_empty() {
                extraction["volatile"] = json!(volatile);
            }
            extraction
        })
}

/// Volatile declarations a side may make, so the two sides often declare
/// different tolerances, spreads and bases for the same value.
static VOLATILE: std::sync::LazyLock<Vec<Value>> = std::sync::LazyLock::new(|| {
    vec![
        json!({"collection": "entities", "path": "/data/size", "tolerance": {"absolute": 1}}),
        json!({"collection": "entities", "path": "/data/size", "tolerance": {"spread": "/data/a", "factor": 1}}),
        json!({"collection": "entities", "path": "/data/size", "tolerance": {"spread": "/data/b", "factor": 2}}),
        json!({"collection": "entities", "path": "/data/summary", "generated": true, "basis": "/data/basisA"}),
        json!({"collection": "entities", "path": "/data/summary", "generated": true, "basis": "/data/basisB"}),
    ]
});

fn options() -> impl Strategy<Value = Value> {
    prop_oneof![
        Just(json!({})),
        Just(json!({"order": {"by": "dependents"}})),
        Just(json!({"order": {"by": "data.size", "direction": "ascending"}})),
    ]
}

fn shuffle(value: &Value, seed: usize) -> Value {
    let mut value = value.clone();
    for collection in ["entities", "relationships"] {
        let items = value[collection].as_array_mut().unwrap();
        if !items.is_empty() {
            let shift = seed % items.len();
            items.rotate_left(shift);
            if seed % 2 == 1 {
                items.reverse();
            }
        }
    }
    value
}

fn ids(value: &Value, collection: &str) -> BTreeSet<String> {
    value[collection]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_owned())
        .collect()
}

/// A change's identity independent of its ID and of the comparison direction.
fn identity(change: &Value) -> Identity {
    let members = |side: &str| -> Vec<String> {
        change[side]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| id.as_str().unwrap().to_owned())
            .collect()
    };
    (
        change["collection"].as_str().unwrap().to_owned(),
        members("before"),
        members("after"),
    )
}

fn mirrored(change: &Value) -> (String, Vec<String>, Vec<String>, String, String) {
    let (collection, before, after) = identity(change);
    let status = match change["status"].as_str().unwrap() {
        "added" => "removed",
        "removed" => "added",
        status => status,
    };
    let correspondence = match change["correspondence"].as_str().unwrap() {
        "split" => "merge",
        "merge" => "split",
        correspondence => correspondence,
    };
    (collection, after, before, status.to_owned(), correspondence.to_owned())
}

fn described(change: &Value) -> (String, Vec<String>, Vec<String>, String, String) {
    let (collection, before, after) = identity(change);
    (
        collection,
        before,
        after,
        change["status"].as_str().unwrap().to_owned(),
        change["correspondence"].as_str().unwrap().to_owned(),
    )
}

/// Each step as its kind and the identities of its changes.
fn steps(comparison: &Value) -> Vec<(String, BTreeSet<Identity>)> {
    let changes: HashMap<&str, &Value> = comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| (change["id"].as_str().unwrap(), change))
        .collect();
    comparison["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| {
            let members = step["changes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| identity(changes[id.as_str().unwrap()]))
                .collect();
            (step["kind"].as_str().unwrap().to_owned(), members)
        })
        .collect()
}

type Identity = (String, Vec<String>, Vec<String>);

/// Relationship changes with both a departing (removed) and an arriving
/// (added) endpoint. They change with their last arriving endpoint in either
/// direction, so they are the one exception to exact mirroring.
fn straddling(comparison: &Value, before: &Value, after: &Value) -> BTreeSet<Identity> {
    let changes = comparison["changes"].as_array().unwrap();
    let entities = |status: &str| -> BTreeSet<String> {
        changes
            .iter()
            .filter(|change| change["collection"] == "entities" && change["status"] == status)
            .flat_map(|change| {
                let (_, before, after) = identity(change);
                before.into_iter().chain(after)
            })
            .collect()
    };
    let (removed, added) = (entities("removed"), entities("added"));
    let endpoints = |extraction: &Value, ids: &[String]| -> Vec<String> {
        extraction["relationships"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|item| ids.iter().any(|id| item["id"] == id.as_str()))
            .flat_map(|item| ["from", "to"].map(|key| item[key].as_str().unwrap().to_owned()))
            .collect()
    };
    changes
        .iter()
        .filter(|change| change["collection"] == "relationships")
        .map(identity)
        .filter(|(_, old, new)| {
            endpoints(before, old).iter().any(|id| removed.contains(id)) && endpoints(after, new).iter().any(|id| added.contains(id))
        })
        .collect()
}

fn config() -> Config {
    Config {
        cases: 256,
        failure_persistence: None,
        ..Config::default()
    }
}

proptest! {
    #![proptest_config(config())]

    #[test]
    fn an_extraction_compared_with_itself_has_no_changes(value in side(), options in options()) {
        let comparison = compare(&value, &value, &options).unwrap();
        prop_assert_eq!(comparison["changes"].as_array().unwrap().len(), 0);
        prop_assert_eq!(comparison["steps"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn every_change_references_real_items_and_validates(
        before in side(), after in side(), options in options()
    ) {
        let Ok(comparison) = compare(&before, &after, &options) else {
            return Ok(());
        };
        let (old, new) = (normalize(&before, "").unwrap(), normalize(&after, "").unwrap());
        prop_assert_eq!(&validate_comparison(&old, &new, &comparison).unwrap(), &comparison);
        let mut seen = BTreeSet::new();
        for change in comparison["changes"].as_array().unwrap() {
            let collection = change["collection"].as_str().unwrap();
            for (side, extraction) in [("before", &old), ("after", &new)] {
                let existing = ids(extraction, collection);
                for id in change[side].as_array().unwrap() {
                    prop_assert!(existing.contains(id.as_str().unwrap()), "{change}");
                    prop_assert!(seen.insert((collection, side, id.as_str().unwrap().to_owned())));
                }
            }
        }
        // Phases are ordered: removals, at most one restructure step, additions.
        let kinds: Vec<_> = comparison["steps"].as_array().unwrap().iter()
            .map(|step| step["kind"].as_str().unwrap()).collect();
        let rank = |kind: &str| ["remove", "restructure", "add"].iter().position(|k| *k == kind).unwrap();
        prop_assert!(kinds.windows(2).all(|pair| rank(pair[0]) <= rank(pair[1])));
        prop_assert!(kinds.iter().filter(|kind| **kind == "restructure").count() <= 1);
        prop_assert!(kinds.iter().filter(|kind| **kind == "remove").count() <= 5);
        prop_assert!(kinds.iter().filter(|kind| **kind == "add").count() <= 5);
    }

    #[test]
    fn comparison_is_deterministic_and_independent_of_input_order(
        before in side(), after in side(), options in options(), seed in 0..16usize
    ) {
        let expected = compare(&before, &after, &options);
        prop_assert_eq!(&compare(&before, &after, &options), &expected);
        prop_assert_eq!(&compare(&shuffle(&before, seed), &shuffle(&after, seed + 1), &options), &expected);
    }

    #[test]
    fn the_reverse_comparison_mirrors_the_forward_one(before in side(), after in side()) {
        let forward = compare(&before, &after, &json!({}));
        let reverse = compare(&after, &before, &json!({}));
        let (forward, reverse) = match (forward, reverse) {
            (Ok(forward), Ok(reverse)) => (forward, reverse),
            (Err(forward), Err(reverse)) => {
                prop_assert_eq!(&forward[0].code, "ambiguous-correspondence");
                prop_assert_eq!(&reverse[0].code, "ambiguous-correspondence");
                return Ok(());
            }
            (forward, reverse) => {
                return Err(TestCaseError::fail(format!("{forward:?} but reversed {reverse:?}")));
            }
        };
        let mirror: BTreeSet<_> = forward["changes"].as_array().unwrap().iter().map(mirrored).collect();
        let actual: BTreeSet<_> = reverse["changes"].as_array().unwrap().iter().map(described).collect();
        prop_assert_eq!(mirror, actual);
        let exceptions = straddling(&forward, &before, &after);
        let mirror = |(collection, before, after): Identity| (collection, after, before);
        prop_assert_eq!(
            straddling(&reverse, &after, &before),
            exceptions.iter().cloned().map(mirror).collect::<BTreeSet<_>>()
        );
        let expected: Vec<_> = steps(&forward)
            .into_iter()
            .rev()
            .map(|(kind, members)| {
                let kind = match kind.as_str() {
                    "remove" => "add",
                    "add" => "remove",
                    kind => kind,
                };
                for member in &members {
                    prop_assert!(!exceptions.contains(member) || kind == "remove", "{member:?} arrives");
                }
                let members = members.into_iter().filter(|member| !exceptions.contains(member)).map(mirror).collect::<BTreeSet<_>>();
                Ok((kind.to_owned(), members))
            })
            .collect::<Result<_, TestCaseError>>()?;
        let actual: Vec<_> = steps(&reverse)
            .into_iter()
            .map(|(kind, members)| {
                for member in &members {
                    prop_assert!(!exceptions.contains(&mirror(member.clone())) || kind == "add", "{member:?} arrives");
                }
                let members = members.into_iter().filter(|member| !exceptions.contains(&mirror(member.clone()))).collect::<BTreeSet<_>>();
                Ok((kind, members))
            })
            .collect::<Result<_, TestCaseError>>()?;
        prop_assert_eq!(actual, expected);
    }
}
