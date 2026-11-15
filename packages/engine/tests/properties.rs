//! Property-based invariants of strict JSON, canonicalization, normalization
//! and comparison validation.

use projections_engine::{canonical, canonicalize, normalize, parse_json, pointer, utf16_cmp, validate_comparison};
use proptest::prelude::*;
use proptest::test_runner::Config;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;

const SAFE: i64 = 9_007_199_254_740_991;

fn text() -> impl Strategy<Value = String> {
    prop_oneof![
        "[a-z]{0,4}",
        "[\\x{0}-\\x{7f}]{0,4}",
        any::<String>().prop_map(|value| value.chars().take(6).collect()),
        Just("\u{1f600}".to_owned()),
        Just("\u{e000}".to_owned()),
    ]
}

/// JSON the Engine accepts: finite numbers and safe integers.
fn json_value() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::Bool),
        (-SAFE..=SAFE).prop_map(|n| json!(n)),
        (-1.0e15..1.0e15f64).prop_map(|n| json!(n)),
        any::<f64>()
            .prop_filter("finite fraction", |n| n.is_finite() && n.fract() != 0.0)
            .prop_map(|n| json!(n)),
        text().prop_map(Value::String),
    ];
    leaf.prop_recursive(4, 32, 5, |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..5).prop_map(Value::Array),
            prop::collection::btree_map(text(), inner, 0..5).prop_map(|map| Value::Object(map.into_iter().collect())),
        ]
    })
}

fn ids(prefix: &'static str, range: std::ops::Range<usize>) -> impl Strategy<Value = Vec<String>> {
    prop::collection::btree_set(text(), range).prop_map(move |set| set.into_iter().map(|id| format!("{prefix}{id}")).collect())
}

fn optional<T: std::fmt::Debug + Clone + 'static>(strategy: impl Strategy<Value = T> + 'static) -> impl Strategy<Value = Option<T>> {
    prop::option::of(strategy)
}

fn data() -> impl Strategy<Value = Option<Value>> {
    optional(prop::collection::btree_map(text(), json_value(), 0..3).prop_map(|map| Value::Object(map.into_iter().collect::<Map<_, _>>())))
}

fn evidence() -> impl Strategy<Value = Option<Value>> {
    optional(
        prop::collection::vec(
            ("[a-z]{1,3}", "[a-z]{1,3}", optional((1..100u32, optional(1..100u32)))).prop_map(|(kind, source, location)| {
                let mut item = json!({"kind": kind, "source": source});
                if let Some((line, column)) = location {
                    item["location"] = json!({"line": line});
                    if let Some(column) = column {
                        item["location"]["column"] = json!(column);
                    }
                }
                item
            }),
            0..3,
        )
        .prop_map(Value::Array),
    )
}

#[derive(Debug, Clone)]
struct Extra {
    data: Option<Value>,
    evidence: Option<Value>,
    previous: Vec<String>,
    confidence: Option<&'static str>,
}

fn extra() -> impl Strategy<Value = Extra> {
    (
        data(),
        evidence(),
        ids("old:", 0..3),
        optional(prop::sample::select(vec!["authoritative", "derived", "inferred"])),
    )
        .prop_map(|(data, evidence, previous, confidence)| Extra {
            data,
            evidence,
            previous,
            confidence,
        })
}

fn decorate(mut item: Value, extra: Extra) -> Value {
    if let Some(data) = extra.data {
        item["data"] = data;
    }
    if let Some(evidence) = extra.evidence {
        item["evidence"] = evidence;
    }
    if !extra.previous.is_empty() {
        item["previousIds"] = json!(extra.previous);
    }
    if let Some(confidence) = extra.confidence {
        item["confidence"] = json!(confidence);
    }
    item
}

/// Valid graph extractions with every optional feature.
fn extraction() -> impl Strategy<Value = Value> {
    ids("e:", 0..6)
        .prop_flat_map(|entities| {
            let count = entities.len();
            let edges = if count == 0 {
                Just(Vec::new()).boxed()
            } else {
                prop::collection::vec((0..count, 0..count, "[a-z]{1,2}", extra()), 0..6).boxed()
            };
            (
                Just(entities.clone()),
                prop::collection::vec(("[a-z]{1,2}", text(), extra()), count),
                edges,
                optional(json_value().prop_map(|value| json!({"value": value}))),
            )
        })
        .prop_map(|(entity_ids, entities, edges, metadata)| {
            let entities: Vec<_> = entity_ids
                .iter()
                .zip(entities)
                .map(|(id, (kind, label, extra))| decorate(json!({"id": id, "kind": kind, "label": label}), extra))
                .collect();
            let relationships: Vec<_> = edges
                .into_iter()
                .enumerate()
                .map(|(index, (from, to, kind, extra))| {
                    let mut extra = extra;
                    // Relationships and entities may not claim one previous ID: a suffix can't keep them apart
                    // (an entity's "old::r" is a relationship's "old:" with ":r"), a prefix of their own does.
                    extra.previous = extra.previous.iter().map(|id| format!("r{id}")).collect();
                    decorate(
                        json!({"id": format!("r:{index}"), "kind": kind,
                            "from": entity_ids[from], "to": entity_ids[to]}),
                        extra,
                    )
                })
                .collect();
            let mut value = json!({"protocolVersion": 0, "schema": "graph/v0",
                "entities": entities, "relationships": relationships});
            if let Some(metadata) = metadata {
                value["metadata"] = metadata;
            }
            value
        })
}

fn shuffled() -> impl Strategy<Value = (Value, Value)> {
    extraction().prop_flat_map(|value| {
        let entities = value["entities"].as_array().unwrap().clone();
        let relationships = value["relationships"].as_array().unwrap().clone();
        (Just(value), Just(entities).prop_shuffle(), Just(relationships).prop_shuffle()).prop_map(|(value, entities, relationships)| {
            let mut shuffled = value.clone();
            shuffled["entities"] = json!(entities);
            shuffled["relationships"] = json!(relationships);
            (value, shuffled)
        })
    })
}

fn sorted_ids(collection: &Value) -> bool {
    collection
        .as_array()
        .unwrap()
        .windows(2)
        .all(|pair| utf16_cmp(pair[0]["id"].as_str().unwrap(), pair[1]["id"].as_str().unwrap()) == Ordering::Less)
}

fn config() -> Config {
    Config {
        cases: 128,
        failure_persistence: None,
        ..Config::default()
    }
}

proptest! {
    #![proptest_config(config())]

    #[test]
    fn strict_parsing_round_trips_accepted_json(value in json_value()) {
        let raw = serde_json::to_string(&value).unwrap();
        prop_assert_eq!(parse_json(&raw).unwrap(), value);
    }

    #[test]
    fn canonical_json_is_idempotent(value in json_value()) {
        let once = canonical(&value).unwrap();
        let again = canonical(&parse_json(&once).unwrap()).unwrap();
        prop_assert_eq!(once, again);
    }

    #[test]
    fn utf16_order_is_a_total_order_matching_code_units(a in text(), b in text()) {
        let expected = a.encode_utf16().collect::<Vec<_>>().cmp(&b.encode_utf16().collect::<Vec<_>>());
        prop_assert_eq!(utf16_cmp(&a, &b), expected);
        prop_assert_eq!(utf16_cmp(&b, &a), expected.reverse());
        prop_assert_eq!(utf16_cmp(&a, &b) == Ordering::Equal, a == b);
    }

    #[test]
    fn pointer_tokens_unescape_to_their_key(key in text()) {
        let token = pointer("", &key);
        prop_assert!(token.starts_with('/'));
        prop_assert!(!token[1..].contains('/'));
        prop_assert_eq!(token[1..].replace("~1", "/").replace("~0", "~"), key);
    }

    #[test]
    fn normalization_is_idempotent_and_sorted(value in extraction()) {
        let normalized = normalize(&value, "").unwrap();
        prop_assert_eq!(&normalize(&normalized, "").unwrap(), &normalized);
        for collection in ["entities", "relationships"] {
            prop_assert!(sorted_ids(&normalized[collection]));
            prop_assert_eq!(
                normalized[collection].as_array().unwrap().len(),
                value[collection].as_array().unwrap().len()
            );
            for item in normalized[collection].as_array().unwrap() {
                prop_assert!(item["data"].is_object());
            }
        }
    }

    #[test]
    fn normalization_ignores_input_order((value, shuffled) in shuffled()) {
        prop_assert_eq!(normalize(&value, "").unwrap(), normalize(&shuffled, "").unwrap());
    }

    #[test]
    fn canonicalization_is_idempotent_and_digested(value in extraction()) {
        let (canonical, digest) = canonicalize(&normalize(&value, "").unwrap()).unwrap();
        prop_assert_eq!(&digest, &format!("{:x}", Sha256::digest(canonical.as_bytes())));
        prop_assert_eq!(digest.len(), 64);
        let reparsed = normalize(&parse_json(&canonical).unwrap(), "").unwrap();
        prop_assert_eq!(canonicalize(&reparsed).unwrap(), (canonical, digest));
    }

    #[test]
    fn canonicalization_ignores_evidence_claims_and_metadata(value in extraction()) {
        let (_, digest) = canonicalize(&normalize(&value, "").unwrap()).unwrap();
        let mut stripped = value.clone();
        stripped.as_object_mut().unwrap().remove("metadata");
        for collection in ["entities", "relationships"] {
            for item in stripped[collection].as_array_mut().unwrap() {
                let item = item.as_object_mut().unwrap();
                item.remove("evidence");
                item.remove("previousIds");
            }
        }
        prop_assert_eq!(canonicalize(&normalize(&stripped, "").unwrap()).unwrap().1, digest);
    }

    #[test]
    fn an_extraction_compared_with_itself_needs_no_changes(value in extraction()) {
        let normalized = normalize(&value, "").unwrap();
        let empty = json!({"protocolVersion": 0, "changes": [], "steps": []});
        prop_assert_eq!(validate_comparison(&normalized, &normalized, &empty).unwrap(), empty.clone());
        let nothing = normalize(&json!({"protocolVersion": 0, "schema": "graph/v0", "entities": [], "relationships": []}), "").unwrap();
        let hidden = validate_comparison(&nothing, &normalized, &empty);
        prop_assert_eq!(hidden.is_err(), !value["entities"].as_array().unwrap().is_empty());
    }

    #[test]
    fn validation_rejects_malformed_extractions(
        value in extraction().prop_filter("has an entity", |value| !value["entities"].as_array().unwrap().is_empty()),
        corruption in 0..10usize,
        pick in any::<prop::sample::Index>(),
    ) {
        let mut value = value;
        let entities = value["entities"].as_array().unwrap().len();
        let index = pick.index(entities);
        let (code, path) = match corruption {
            0 => { value.as_object_mut().unwrap().remove("schema"); ("invalid-type", "/schema".to_owned()) }
            1 => { value["extra"] = json!(1); ("unknown-field", "/extra".to_owned()) }
            2 => { value["protocolVersion"] = json!(1); ("unsupported-version", "/protocolVersion".to_owned()) }
            3 => { value["entities"][index]["id"] = json!(" "); ("invalid-type", format!("/entities/{index}/id")) }
            4 => {
                let copy = value["entities"][index].clone();
                value["entities"].as_array_mut().unwrap().push(copy);
                ("duplicate-id", format!("/entities/{entities}/id"))
            }
            5 => {
                value["relationships"] = json!([{"id": "r:x", "kind": "k", "from": value["entities"][index]["id"], "to": "missing"}]);
                ("missing-endpoint", "/relationships/0/to".to_owned())
            }
            6 => { value["entities"][index]["data"] = json!([]); ("invalid-type", format!("/entities/{index}/data")) }
            7 => { value["entities"][index]["confidence"] = json!("sure"); ("invalid-confidence", format!("/entities/{index}/confidence")) }
            8 => { value["entities"][index]["position"] = json!(0); ("unknown-field", format!("/entities/{index}/position")) }
            _ => {
                let id = value["entities"][index]["id"].clone();
                value["entities"][index]["previousIds"] = json!([id]);
                ("ambiguous-identity", format!("/entities/{index}/previousIds/0"))
            }
        };
        let failure = normalize(&value, "").unwrap_err();
        prop_assert_eq!(failure[0].code.as_str(), code);
        prop_assert_eq!(&failure[0].path, &path);
    }
}
