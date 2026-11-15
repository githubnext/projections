//! Volatile data in the default comparator: variation within tolerance is an
//! unchanged change with `varied` in no step; beyond tolerance, a modified one.

use projections_comparator_default::compare;
use projections_engine::{normalize, validate_comparison};
use serde_json::{Value, json};

fn test(id: &str, duration: i64, status: &str) -> Value {
    json!({"id": id, "kind": "test", "label": id, "data": {"durationMs": duration, "status": status}})
}

fn run(tests: &[Value], samples: i64) -> Value {
    let mut entities = vec![json!({"id": "suite", "kind": "suite", "label": "Suite"})];
    entities.extend(tests.iter().cloned());
    json!({
        "protocolVersion": 0,
        "schema": "graph/v0",
        "entities": entities,
        "relationships": [
            {"id": "suite-a", "kind": "contains", "from": "suite", "to": "test:a",
                "data": {"samples": [{"name": "warm", "count": samples}]}},
        ],
        "volatile": [
            {"kinds": ["test"], "path": "/data/durationMs", "tolerance": {"absolute": 50, "relative": 0.2}},
            {"collection": "relationships", "path": "/data/samples/*/count"},
        ],
    })
}

fn renamed(id: &str, previous: &str, duration: i64) -> Value {
    let mut value = test(id, duration, "passed");
    value["label"] = json!("renamed");
    value["previousIds"] = json!([previous]);
    value
}

#[test]
fn test_results_vary_within_and_beyond_tolerance() {
    let mut old = renamed("test:e", "test:x", 10);
    old.as_object_mut().unwrap().remove("previousIds");
    let before = run(
        &[
            test("test:a", 100, "passed"),
            test("test:b", 100, "passed"),
            test("test:c", 100, "passed"),
            test("test:d", 100, "passed"),
            test("test:gone", 1, "passed"),
            old,
        ],
        3,
    );
    let after = run(
        &[
            // Jitter within tolerance.
            test("test:a", 130, "passed"),
            // Slower beyond tolerance.
            test("test:b", 400, "passed"),
            // A status change.
            test("test:c", 100, "failed"),
            // A status change with jitter.
            test("test:d", 120, "failed"),
            test("test:new", 1, "passed"),
            renamed("test:f", "test:e", 20),
        ],
        5,
    );
    let comparison = compare(&before, &after, &json!({})).unwrap();
    let within = |path: &str| json!([{"path": path, "within": true}]);
    assert_eq!(
        comparison["changes"],
        json!([
            {"id": "test:a", "collection": "entities", "before": ["test:a"], "after": ["test:a"],
                "status": "unchanged", "correspondence": "exact", "varied": within("/data/durationMs")},
            {"id": "test:b", "collection": "entities", "before": ["test:b"], "after": ["test:b"],
                "status": "modified", "correspondence": "exact",
                "varied": [{"path": "/data/durationMs", "within": false}]},
            {"id": "test:c", "collection": "entities", "before": ["test:c"], "after": ["test:c"],
                "status": "modified", "correspondence": "exact"},
            {"id": "test:d", "collection": "entities", "before": ["test:d"], "after": ["test:d"],
                "status": "modified", "correspondence": "exact", "varied": within("/data/durationMs")},
            {"id": "test:f", "collection": "entities", "before": ["test:e"], "after": ["test:f"],
                "status": "unchanged", "correspondence": "declared", "varied": within("/data/durationMs")},
            {"id": "test:gone", "collection": "entities", "before": ["test:gone"], "after": [],
                "status": "removed", "correspondence": "none"},
            {"id": "test:new", "collection": "entities", "before": [], "after": ["test:new"],
                "status": "added", "correspondence": "none"},
            {"id": "suite-a", "collection": "relationships", "before": ["suite-a"], "after": ["suite-a"],
                "status": "unchanged", "correspondence": "exact", "varied": within("/data/samples/0/count")},
        ])
    );
    // Variation within tolerance is listed but belongs to no step; a rename
    // is still a step.
    assert_eq!(
        comparison["steps"],
        json!([
            {"changes": ["test:gone"], "kind": "remove"},
            {"changes": ["test:b", "test:c", "test:d", "test:f"], "kind": "restructure"},
            {"changes": ["test:new"], "kind": "add"},
        ])
    );
    assert_eq!(comparison["variation"], json!({"within": 3, "beyond": 1}));
    // Both directions validate, and ordering options ignore variation.
    for (before, after) in [(&before, &after), (&after, &before)] {
        for options in [json!({}), json!({"order": {"by": "data.durationMs"}})] {
            let comparison = compare(before, after, &options).unwrap();
            validate_comparison(
                &normalize(before, "/before").unwrap(),
                &normalize(after, "/after").unwrap(),
                &comparison,
            )
            .unwrap();
        }
    }
}

#[test]
fn without_variation_nothing_changes() {
    let before = run(&[test("test:a", 100, "passed")], 3);
    let comparison = compare(&before, &before, &json!({})).unwrap();
    assert_eq!(
        comparison,
        json!({"protocolVersion": 0, "changes": [], "steps": [], "order": {"reverse": "mirror"}})
    );
    let mut undeclared = before.clone();
    undeclared.as_object_mut().unwrap().remove("volatile");
    let mut slower = undeclared.clone();
    slower["entities"][1]["data"]["durationMs"] = json!(101);
    let comparison = compare(&undeclared, &slower, &json!({})).unwrap();
    assert!(comparison.get("variation").is_none());
    assert_eq!(comparison["changes"][0]["status"], "modified");
    assert!(comparison["changes"][0].get("varied").is_none());
}
