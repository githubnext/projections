//! Volatile data in rules comparators: `change.varied` in CEL, classify and
//! step operations leave expected variation alone, identity passes the rules
//! add judge their pairs too, and a steps expression can't hide variation in
//! a step.

use projections_comparator_rules::Comparator;
use serde_json::{Value, json};

fn results(tests: &[(&str, &str, i64)]) -> Value {
    json!({
        "protocolVersion": 0,
        "schema": "graph/v0",
        "volatile": [{"kinds": ["test"], "path": "/data/durationMs", "tolerance": {"absolute": 50}}],
        "entities": tests.iter().map(|(id, label, duration)| json!({
            "id": id, "kind": "test", "label": label, "data": {"durationMs": duration},
        })).collect::<Vec<_>>(),
        "relationships": [],
    })
}

fn compare(rules: &str, before: &Value, after: &Value) -> Result<Value, String> {
    Comparator::from_yaml(rules)
        .and_then(|comparator| comparator.compare(before, after, &json!({})))
        .map_err(|failure| failure[0].to_string())
}

#[test]
fn classify_and_steps_leave_variation_alone_and_read_varied() {
    let rules = r#"
format: projections.comparator
version: 0
classify:
  summary: |-
    change.varied.size() == 0 ? 'changed'
      : change.varied.map(v, v.path + (v.within ? ' within' : ' beyond')).join(', ')
steps:
  add:
    - changes: 'true'
      summary: "'All of ' + string(size(members))"
metadata:
  values:
    noise: "changes.filter(c, c.status == 'unchanged' && size(c.varied) > 0).map(c, c.id)"
    first: "baseline.changes.map(c, size(c.varied))"
"#;
    let before = results(&[("t:a", "a", 100), ("t:b", "b", 100), ("t:c", "c", 100)]);
    let after = results(&[("t:a", "a", 130), ("t:b", "b", 300), ("t:c", "C", 100)]);
    let comparison = compare(rules, &before, &after).unwrap();
    let summaries: Vec<&Value> = comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| &change["summary"])
        .collect();
    assert_eq!(summaries, [&Value::Null, &json!("/data/durationMs beyond"), &json!("changed")]);
    assert_eq!(comparison["steps"], json!([{"changes": ["t:b", "t:c"], "summary": "All of 2"}]));
    assert_eq!(comparison["variation"], json!({"within": 1, "beyond": 1}));
    assert_eq!(comparison["metadata"], json!({"noise": ["t:a"], "first": [1, 1, 0]}));
}

#[test]
fn identity_passes_judge_their_pairs_through_the_declarations() {
    let rules = r#"
format: projections.comparator
version: 0
identity:
  - name: label
    key: item.label
steps:
  add:
    - changes: "origin == 'label'"
      kind: restructure
"#;
    let before = results(&[("t:old", "same", 100)]);
    let after = results(&[("t:new", "same", 120)]);
    let comparison = compare(rules, &before, &after).unwrap();
    assert_eq!(
        comparison["changes"],
        json!([{"id": "t:new", "collection": "entities", "before": ["t:old"], "after": ["t:new"],
            "status": "unchanged", "correspondence": "declared",
            "varied": [{"path": "/data/durationMs", "within": true}]}])
    );
    // A rename is a step even when its content only varied within tolerance.
    assert_eq!(comparison["steps"], json!([{"changes": ["t:new"], "kind": "restructure"}]));
    assert_eq!(comparison["variation"], json!({"within": 1, "beyond": 0}));
}

#[test]
fn a_steps_expression_cannot_put_variation_in_a_step() {
    let rules = r#"
format: projections.comparator
version: 0
steps:
  value: "[{'changes': changes.map(c, c.id)}]"
"#;
    let before = results(&[("t:a", "a", 100)]);
    let after = results(&[("t:a", "a", 120)]);
    let error = compare(rules, &before, &after).unwrap_err();
    assert!(error.starts_with("variation-in-step"), "{error}");
    let filtered = rules.replace("changes.map(c, c.id)", "changes.filter(c, c.status != 'unchanged').map(c, c.id)");
    let comparison = compare(&filtered, &before, &after);
    // An empty step is invalid, so the expression keeps no step at all.
    assert!(comparison.unwrap_err().starts_with("empty-step"));
}
