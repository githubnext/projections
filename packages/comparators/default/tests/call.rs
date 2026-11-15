//! The JSON-in, JSON-out module function behind the comparator ABI.

use projections_comparator_default::{ID, MAX_INPUT_BYTES, call, compare};
use serde_json::{Value, json};

fn entity(id: &str) -> Value {
    json!({"id": id, "kind": "entity", "label": id})
}

fn graph(entities: Value) -> Value {
    json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": []})
}

fn output(input: &[u8]) -> Value {
    serde_json::from_slice(&call(input)).unwrap()
}

fn module(input: &Value) -> Value {
    output(serde_json::to_string(input).unwrap().as_bytes())
}

fn error(input: &Value) -> String {
    let output = module(input);
    assert_eq!(output.as_object().unwrap().len(), 1, "{output}");
    output["error"].as_str().unwrap().to_owned()
}

fn input() -> Value {
    json!({"protocolVersion": 0, "before": graph(json!([entity("a")])), "after": graph(json!([entity("b")]))})
}

#[test]
fn the_comparator_identity_and_input_bound_are_fixed() {
    assert_eq!(ID, "default");
    assert_eq!(MAX_INPUT_BYTES, 64 * 1024 * 1024);
}

#[test]
fn input_is_bounded_at_64_mib() {
    let raw = serde_json::to_string(&input()).unwrap();
    let mut at_limit = raw.into_bytes();
    at_limit.resize(MAX_INPUT_BYTES, b' ');
    let expected = compare(&input()["before"], &input()["after"], &json!({})).unwrap();
    assert_eq!(output(&at_limit), expected);
    at_limit.push(b' ');
    assert_eq!(
        output(&at_limit),
        json!({"error": "input-size-limit at /: Comparator input exceeds 64 MiB"})
    );
}

#[test]
fn errors_name_the_diagnostic_code_path_and_message() {
    assert_eq!(output(&[0xff]), json!({"error": "invalid-unicode at /: Input must be valid UTF-8"}));
    assert_eq!(output(b"[]"), json!({"error": "invalid-type at /: Expected an object"}));
    let mut value = input();
    value["protocolVersion"] = json!("0");
    assert_eq!(error(&value), "unsupported-version at /protocolVersion: Expected protocolVersion 0");
    value["protocolVersion"] = json!(0.0);
    assert!(module(&value).get("changes").is_some());
    value["comparator"] = json!("default");
    assert_eq!(error(&value), "unknown-field at /comparator: Unknown comparator input field");
}

#[test]
fn a_supplied_baseline_must_be_an_object_and_is_otherwise_ignored() {
    let expected = module(&input());
    let mut value = input();
    value["baseline"] = json!({"protocolVersion": 0, "changes": "ignored"});
    assert_eq!(module(&value), expected);
    for baseline in [json!([]), Value::Null, json!("x")] {
        value["baseline"] = baseline;
        assert_eq!(error(&value), "invalid-type at /baseline: Expected an object");
    }
}

#[test]
fn options_and_both_extractions_are_validated_with_their_paths() {
    let mut value = input();
    value["options"] = json!({"order": {"by": "dependents"}});
    assert!(module(&value).get("changes").is_some());
    value["options"] = json!([]);
    assert_eq!(error(&value), "invalid-options at /options: Expected an object");
    let mut value = input();
    value.as_object_mut().unwrap().remove("before");
    assert_eq!(error(&value), "invalid-type at /before: Expected an object");
    let mut value = input();
    value["after"]["schema"] = json!("dag/v0");
    assert_eq!(
        error(&value),
        "schema-mismatch at /after/schema: Comparisons require the same domain schema"
    );
}

#[test]
fn a_comparison_has_mirrored_reverse_order_and_no_extra_fields() {
    let comparison = module(&input());
    let mut keys: Vec<_> = comparison.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["changes", "order", "protocolVersion", "steps"]);
    assert_eq!(comparison["protocolVersion"], 0);
    assert_eq!(comparison["order"], json!({"reverse": "mirror"}));
}
