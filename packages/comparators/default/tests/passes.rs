//! The identity-pass core other comparators layer passes on: the baseline
//! entry points, and passes beyond the default two (keys that collide on a
//! side, passes that switch themselves off).

use projections_comparator_default::matching::{Answer, DEFAULT_PASSES, Exact, Pairs, Pass, Side, match_extractions};
use projections_comparator_default::{baseline, baseline_plan, compare, to_comparison};
use projections_engine::{Collection, Extraction, Failure, ItemRef};
use serde_json::{Value, json};

fn entity(id: &str, label: &str) -> Value {
    json!({"id": id, "kind": "entity", "label": label})
}

fn graph(schema: &str, entities: Value) -> Value {
    json!({"protocolVersion": 0, "schema": schema, "entities": entities, "relationships": []})
}

fn typed(value: &Value) -> Extraction {
    Extraction::from_json(value, "").unwrap()
}

#[test]
fn the_baseline_is_the_default_comparison_and_its_plan_writes_the_same_json() {
    let before = graph("graph/v0", json!([entity("a", "A"), entity("b", "B")]));
    let after = graph("graph/v0", json!([entity("a", "A2"), entity("c", "C")]));
    let compared = compare(&before, &after, &json!({})).unwrap();
    let (before, after) = (typed(&before), typed(&after));
    assert_eq!(baseline(&before, &after).unwrap().to_json(), compared);
    let (matched, steps) = baseline_plan(&before, &after).unwrap();
    assert_eq!(to_comparison(&matched.changes, steps).to_json(), compared);
    assert!(matched.pairs.contains_key("exact"));
    let other = typed(&graph("dag/v0", json!([])));
    for result in [baseline(&before, &other).map(|_| ()), baseline_plan(&before, &other).map(|_| ())] {
        assert_eq!(result.unwrap_err()[0].code, "schema-mismatch");
    }
}

/// Pairs unmatched entities by label, when the label is unique on both sides.
struct Label {
    enabled: bool,
}

impl Pass for Label {
    fn name(&self) -> &str {
        "label"
    }
    fn applies(&self, collection: Collection) -> bool {
        collection == Collection::Entities
    }
    fn enabled(&self, _pairs: &Pairs) -> Result<bool, Failure> {
        Ok(self.enabled)
    }
    fn answer(&self, side: Side, item: ItemRef, _pairs: &Pairs) -> Result<Answer, Failure> {
        assert!(["before", "after"].contains(&side.name()));
        Ok(Answer::Key(item.label.map(str::to_owned)))
    }
}

#[test]
fn passes_pair_unique_keys_and_can_switch_themselves_off() {
    let before = graph(
        "graph/v0",
        json!([entity("old", "Moved"), entity("x", "Twin"), entity("y", "Twin")]),
    );
    let after = graph("graph/v0", json!([entity("new", "Moved"), entity("z", "Twin")]));
    let (before, after) = (typed(&before), typed(&after));
    let on = Label { enabled: true };
    let passes: [&dyn Pass; 2] = [&Exact, &on];
    let matched = match_extractions(&before, &after, &passes).unwrap();
    // "Moved" is unique on both sides; "Twin" appears twice before, so it pairs nothing.
    assert_eq!(matched.pairs["label"].get("old"), Some(&"new".to_owned()));
    assert_eq!(matched.pairs["label"].len(), 1);
    let moved = matched.changes.iter().find(|change| change.id == "new").unwrap();
    assert_eq!(moved.origin.as_deref(), Some("label"));
    let off = Label { enabled: false };
    let passes: [&dyn Pass; 2] = [&Exact, &off];
    let matched = match_extractions(&before, &after, &passes).unwrap();
    assert!(!matched.pairs.contains_key("label"));
    // With the default passes alone, nothing is paired either.
    let default = match_extractions(&before, &after, &DEFAULT_PASSES).unwrap();
    assert_eq!(default.changes.len(), matched.changes.len());
}

#[test]
fn one_to_one_pairs_say_whether_they_differ_outside_their_volatile_values() {
    let run = |label: &str, ms: i64| {
        typed(&json!({"protocolVersion": 0, "schema": "graph/v0", "relationships": [],
            "entities": [{"id": "t", "kind": "test", "label": label, "data": {"ms": ms}}],
            "volatile": [{"path": "/data/ms"}]}))
    };
    let before = run("T", 1);
    let jitter = match_extractions(&before, &run("T", 2), &DEFAULT_PASSES).unwrap();
    assert!(!jitter.changes[0].residual);
    let relabelled = match_extractions(&before, &run("U", 2), &DEFAULT_PASSES).unwrap();
    assert!(relabelled.changes[0].residual);
}
