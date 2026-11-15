//! Generated values in rules comparators: `Varied.generated` and
//! `Varied.because` in CEL, `generated.because` and `generated.only`, and a
//! model-only change classified and ordered last without changing its status.

use projections_comparator_rules::Comparator;
use serde_json::{Value, json};

/// Classes with a generated summary: `(id, summary, input, model, size)`,
/// where `size` is an extracted fact beside the summary.
fn classes(items: &[(&str, &str, &str, &str, i64)]) -> Value {
    json!({
        "protocolVersion": 0,
        "schema": "graph/v0",
        "volatile": [{"kinds": ["class"], "path": "/data/summary", "generated": true,
            "basis": "/data/summaryBasis"}],
        "entities": items.iter().map(|(id, summary, input, model, size)| json!({
            "id": id, "kind": "class", "label": id, "data": {
                "summary": summary, "size": size,
                "summaryBasis": {"input": input, "prompt": "sha256:p", "model": model},
            },
        })).collect::<Vec<_>>(),
        "relationships": [],
    })
}

fn compare(rules: &str, before: &Value, after: &Value) -> Value {
    Comparator::from_yaml(rules)
        .and_then(|comparator| comparator.compare(before, after, &json!({})))
        .map_err(|failure| failure[0].to_string())
        .unwrap()
}

const RULES: &str = r#"
format: projections.comparator
version: 0
classify:
  where: generated.only(change, ['model'])
  summary: "'%s was regenerated with a different model.'.format([prose.code(item.label)])"
steps:
  add:
    - changes: generated.only(change, ['model'])
      kind: restructure
      place: end
      summary: "'Regenerated with a different model'"
metadata:
  values:
    because: "maps.fromEntries(changes.map(c, [c.id, generated.because(c)]))"
    flags: "maps.fromEntries(changes.map(c, [c.id, c.varied.map(v, [v.generated, v.because])]))"
"#;

#[test]
fn rules_read_generated_values_and_order_model_upgrades_last() {
    let before = classes(&[
        ("a", "Validates orders.", "sha256:a", "m@1", 1),
        ("b", "Holds a cart.", "sha256:b", "m@1", 1),
        ("c", "Ships parcels.", "sha256:c", "m@1", 1),
        ("d", "Bills customers.", "sha256:d", "m@1", 1),
    ]);
    let after = classes(&[
        // Reworded from the same inputs: expected variation.
        ("a", "Checks orders.", "sha256:a", "m@1", 1),
        // The input moved.
        ("b", "Holds a cart and its total.", "sha256:b2", "m@1", 1),
        // Only the model moved.
        ("c", "Sends parcels.", "sha256:c", "m@2", 1),
        // The model moved, and so did an extracted fact.
        ("d", "Charges customers.", "sha256:d", "m@2", 2),
    ]);
    let comparison = compare(RULES, &before, &after);
    let statuses: Vec<(&str, &str)> = comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| (change["id"].as_str().unwrap(), change["status"].as_str().unwrap()))
        .collect();
    assert_eq!(
        statuses,
        [("a", "unchanged"), ("b", "modified"), ("c", "modified"), ("d", "modified")]
    );
    let c = &comparison["changes"][2];
    assert_eq!(c["summary"], json!("`c` was regenerated with a different model."));
    assert_eq!(
        c["varied"],
        json!([{"path": "/data/summary", "within": false, "generated": true, "because": ["model"]}])
    );
    assert!(comparison["changes"][3].get("summary").is_none());
    let steps = comparison["steps"].as_array().unwrap();
    assert_eq!(
        steps.last().unwrap(),
        &json!({"changes": ["c"], "kind": "restructure", "summary": "Regenerated with a different model"})
    );
    assert_eq!(
        comparison["metadata"]["because"],
        json!({"a": [], "b": ["input"], "c": ["model"], "d": ["model"]})
    );
    assert_eq!(comparison["metadata"]["flags"]["a"], json!([[true, []]]));
    assert_eq!(comparison["variation"], json!({"within": 1, "beyond": 3}));
}
