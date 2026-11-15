//! Classification, counts, summaries and options, across ecosystems.

use crate::testing::{api, classify_pair, compare, entity};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// The contract facts of a function, and no more.
fn function() -> Value {
    json!({"declaration": "function", "term": "function"})
}

#[test]
fn classification_is_recorded_per_change_with_counts_and_summaries() {
    let before = api(
        "typescript",
        vec![
            entity(
                "a",
                "export",
                "a(): void",
                json!({"declaration": "variable", "term": "variable", "type": {"text": "string", "union": [{"text": "string", "primitive": "string"}]}}),
            ),
            entity(
                "gone",
                "export",
                "gone(): void",
                json!({"declaration": "variable", "term": "variable", "type": {"text": "string", "union": [{"text": "string", "primitive": "string"}]}}),
            ),
        ],
    );
    let after = api(
        "typescript",
        vec![
            entity(
                "a",
                "export",
                "a(): void",
                json!({"declaration": "variable", "term": "variable", "type": {"text": "string", "union": [{"text": "string", "primitive": "string"}]}}),
            ),
            entity(
                "new",
                "export",
                "new(): void",
                json!({"declaration": "variable", "term": "variable", "type": {"text": "string", "union": [{"text": "string", "primitive": "string"}]}}),
            ),
        ],
    );
    let comparison = classify_pair(&before, &after, json!({}));
    let compatibility = &comparison["metadata"]["compatibility"];
    assert_eq!(compatibility["ecosystem"], "typescript");
    assert_eq!(
        compatibility["counts"],
        json!({"breaking": 1, "additive": 1, "compatible": 0, "unknown": 0})
    );
    assert_eq!(compatibility["changes"]["gone"]["level"], "breaking");
    assert_eq!(compatibility["changes"]["new"]["level"], "additive");
    let summaries: BTreeMap<_, _> = comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| (change["id"].as_str().unwrap(), change["summary"].as_str().unwrap()))
        .collect();
    assert_eq!(summaries["gone"], "Breaking: `gone` was removed.");
    assert_eq!(summaries["new"], "Additive: `new` was added.");
}

#[test]
fn missing_ecosystem_falls_back_to_shared_rules_with_a_notice() {
    let mut before = api("typescript", vec![entity("a", "export", "a(): void", function())]);
    let mut after = api("typescript", vec![entity("a", "export", "a(x: string): void", function())]);
    before["metadata"] = json!({});
    after["metadata"] = json!({});
    let comparison = classify_pair(&before, &after, json!({}));
    let compatibility = &comparison["metadata"]["compatibility"];
    assert!(compatibility.get("ecosystem").is_none());
    assert_eq!(compatibility["rules"], "Shared rules");
    assert_eq!(compatibility["changes"]["a"]["level"], "unknown");
    assert!(compatibility["notices"][0].as_str().unwrap().contains("metadata.ecosystem"));
}

#[test]
fn options_select_the_ecosystem_and_reject_unknown_ones() {
    let before = api("", vec![entity("a", "export", "a", function())]);
    let error = compare(&before, &before, json!({"ecosystem": "cobol"})).unwrap_err();
    assert!(error.contains("options.ecosystem"), "{error}");
    let output = compare(&before, &before, json!({"ecosystem": "go"})).unwrap();
    assert_eq!(output["metadata"]["compatibility"]["ecosystem"], "go");
}

#[test]
fn other_schemas_are_rejected() {
    let graph = json!({"protocolVersion": 0, "schema": "graph/v0", "entities": [], "relationships": []});
    let error = compare(&graph, &graph, json!({})).unwrap_err();
    assert!(error.contains("api/v0"), "{error}");
}

#[test]
fn renames_are_breaking() {
    let before = api(
        "go",
        vec![entity(
            "go:p.Old",
            "func",
            "func Old()",
            json!({"declaration": "function", "term": "func", "type": {"text": "func()"}}),
        )],
    );
    let mut renamed = entity(
        "go:p.New",
        "func",
        "func New()",
        json!({"declaration": "function", "term": "func", "type": {"text": "func()"}}),
    );
    renamed["previousIds"] = json!(["go:p.Old"]);
    let after = api("go", vec![renamed]);
    let comparison = classify_pair(&before, &after, json!({}));
    let change = &comparison["metadata"]["compatibility"]["changes"]["go:p.New"];
    assert_eq!(change["level"], "breaking");
    assert_eq!(change["findings"][0]["rule"], "renamed");
    assert_eq!(change["reason"], "Renamed from `Old` to `New`; code using `Old` fails");
}
