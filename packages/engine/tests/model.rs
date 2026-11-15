//! The typed model's JSON boundary: what reading a JSON value into the model
//! keeps and rejects, and how the model writes back.

use projections_engine::model::lookup;
use projections_engine::{
    Change, Collection, Comparison, Correspondence, Datum, Extraction, Fields, Number, Reverse, Status, Step, StepKind, check_comparison,
    normalize,
};
use serde_json::{Value, json};

fn graph(data: Value) -> Value {
    json!({"protocolVersion": 0, "schema": "graph/v0",
        "entities": [{"id": "a", "kind": "k", "label": "A", "data": data}], "relationships": []})
}

#[test]
fn extractions_list_their_items_sorted() {
    let value = json!({"protocolVersion": 0, "schema": "graph/v0",
        "entities": [{"id": "b", "kind": "k", "label": "B"}, {"id": "a", "kind": "k", "label": "A"}],
        "relationships": [{"id": "b->a", "kind": "uses", "from": "b", "to": "a"}]});
    let extraction = Extraction::from_json(&value, "").unwrap();
    assert_eq!(extraction.schema(), "graph/v0");
    let ids = |items: Vec<projections_engine::ItemRef>| items.iter().map(|item| item.id.to_owned()).collect::<Vec<_>>();
    assert_eq!(ids(extraction.items(Collection::Entities)), ["a", "b"]);
    assert_eq!(ids(extraction.items(Collection::Relationships)), ["b->a"]);
    assert_eq!(extraction.relationships()[0].shape.from, "b");
    assert_eq!(extraction.entities().len(), 2);
}

#[test]
fn numbers_from_rust_values_follow_the_strict_parsers_rules() {
    for (data, path) in [
        (json!({"big": 9_007_199_254_740_992_i64}), "/entities/0/data/big"),
        (json!({"list": [-9_007_199_254_740_992_i64]}), "/entities/0/data/list/0"),
        (json!({"huge": u64::MAX}), "/entities/0/data/huge"),
        (json!({"wide": 1e300}), "/entities/0/data/wide"),
    ] {
        let failure = normalize(&graph(data), "").unwrap_err();
        assert_eq!((failure[0].code.as_str(), failure[0].path.as_str()), ("unsafe-integer", path));
    }
    let mut metadata = graph(json!({}));
    metadata["metadata"] = json!({"count": u64::MAX});
    assert_eq!(normalize(&metadata, "").unwrap_err()[0].path, "/metadata/count");
    assert!(normalize(&graph(json!({"edge": 9_007_199_254_740_991_i64, "half": 0.5})), "").is_ok());
}

#[test]
fn numbers_keep_the_form_written_and_compare_by_value() {
    let normalized = normalize(&graph(json!({"float": 1.0, "integer": 1, "zero": -0.0})), "").unwrap();
    assert_eq!(
        serde_json::to_string(&normalized["entities"][0]["data"]).unwrap(),
        r#"{"float":1.0,"integer":1,"zero":-0.0}"#
    );
    assert_eq!(Number::Float(1.0), Number::Integer(1));
    let data: Fields = [("n".to_owned(), Datum::Number(Number::Integer(3)))].into();
    assert_eq!(lookup(&data, &["n".to_owned(), "deeper".to_owned()]), None);
    assert_eq!(Datum::Object(data).to_json(), json!({"n": 3}));
}

#[test]
fn typed_comparisons_write_the_protocols_json() {
    let read = |label: &str| {
        let mut value = graph(json!({}));
        value["entities"][0]["label"] = json!(label);
        Extraction::from_json(&value, "").unwrap()
    };
    let (before, after) = (read("A"), read("B"));
    let step = Step {
        changes: vec!["a".to_owned()],
        kind: Some(StepKind::Restructure),
        summary: Some("Relabel".to_owned()),
    };
    let change = Change {
        id: "a".to_owned(),
        collection: Collection::Entities,
        before: vec!["a".to_owned()],
        after: vec!["a".to_owned()],
        status: Status::Modified,
        correspondence: Correspondence::Exact,
        varied: Vec::new(),
        summary: Some("Relabelled".to_owned()),
    };
    let comparison = Comparison {
        changes: vec![change.clone()],
        steps: vec![step.clone()],
        order: Some(Reverse::Explicit),
        reverse_steps: Some(vec![step.clone()]),
        variation: None,
        metadata: Some([("by".to_owned(), Datum::String("test".to_owned()))].into()),
    };
    let step_json = json!({"changes": ["a"], "kind": "restructure", "summary": "Relabel"});
    let change_json = json!({"id": "a", "collection": "entities", "before": ["a"], "after": ["a"],
        "status": "modified", "correspondence": "exact", "summary": "Relabelled"});
    assert_eq!(step.to_json(), step_json);
    assert_eq!(change.to_json(), change_json);
    let json = comparison.to_json();
    assert_eq!(
        json,
        json!({"protocolVersion": 0, "changes": [change_json], "steps": [step_json], "order": {"reverse": "explicit"},
            "reverseSteps": [step_json], "metadata": {"by": "test"}})
    );
    check_comparison(&before, &after, &json).unwrap();
    let empty = json!({"protocolVersion": 0, "changes": [], "steps": []});
    assert_eq!(check_comparison(&before, &after, &empty).unwrap_err()[0].code, "hidden-change");
    assert_eq!(after.entities()[0].view().to_json(), after.to_json()["entities"][0]);
}

#[test]
fn only_a_valid_extraction_has_generated_values() {
    assert!(projections_engine::volatility::generated_values(&json!({"schema": "graph/v0"})).is_empty());
}

#[test]
fn a_wrong_variation_summary_names_the_expected_counts() {
    let run = |ms: i64| {
        let mut value = graph(json!({"ms": ms}));
        value["volatile"] = json!([{"path": "/data/ms"}]);
        value
    };
    let comparison = json!({"protocolVersion": 0, "steps": [], "variation": {"within": 0, "beyond": 0},
        "changes": [{"id": "a", "collection": "entities", "before": ["a"], "after": ["a"], "status": "unchanged",
            "correspondence": "exact", "varied": [{"path": "/data/ms", "within": true}]}]});
    let failure = projections_engine::validate_comparison(&run(1), &run(2), &comparison).unwrap_err();
    assert_eq!(
        (failure[0].code.as_str(), failure[0].message.as_str()),
        ("inconsistent-variation", r#"Expected variation {"beyond":0,"within":1}"#)
    );
}
