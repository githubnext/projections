//! The baseline other comparators build on, and the matching core's extension
//! points: passes that skip items and passes that do not run.

use projections_comparator_default::matching::{Answer, Exact, Pairs, Pass, Side, match_extractions};
use projections_comparator_default::{baseline, baseline_plan, compare, to_comparison};
use projections_engine::{Collection, Extraction, Failure, ItemRef, normalize};
use serde_json::{Value, json};

fn entity(id: &str, label: &str) -> Value {
    json!({"id": id, "kind": "entity", "label": label})
}

fn claim(id: &str, previous: &str) -> Value {
    json!({"id": id, "kind": "entity", "label": id, "previousIds": [previous]})
}

fn graph(entities: Value) -> Value {
    normalize(
        &json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": []}),
        "",
    )
    .unwrap()
}

fn typed(value: &Value) -> Extraction {
    Extraction::from_json(value, "").unwrap()
}

fn sample() -> (Value, Value) {
    (
        graph(json!([entity("a", "A"), entity("b", "B"), entity("c", "C")])),
        graph(json!([entity("a", "A2"), claim("x", "b"), entity("d", "D")])),
    )
}

#[test]
fn the_baseline_is_the_default_comparison() {
    let (before, after) = sample();
    assert_eq!(
        baseline(&typed(&before), &typed(&after)).unwrap().to_json(),
        compare(&before, &after, &json!({})).unwrap()
    );
}

#[test]
fn the_baseline_plan_is_the_baseline_before_it_is_written() {
    let (before, after) = sample();
    let (before, after) = (typed(&before), typed(&after));
    let (matched, steps) = baseline_plan(&before, &after).unwrap();
    assert_eq!(matched.pairs["exact"]["a"], "a");
    assert_eq!(matched.pairs["claims"]["b"], "x");
    assert_eq!(matched.before_identity["c"], "c");
    assert_eq!(matched.after_identity["d"], "d");
    assert_eq!(
        to_comparison(&before, &after, &matched.changes, steps),
        baseline(&before, &after).unwrap()
    );
}

#[test]
fn the_baseline_requires_the_same_schema() {
    let before = graph(json!([]));
    let mut after = before.clone();
    after["schema"] = json!("dag/v0");
    let (before, after) = (typed(&before), typed(&after));
    let failure = baseline_plan(&before, &after).err().unwrap();
    assert_eq!(failure[0].code, "schema-mismatch");
    assert!(baseline(&before, &after).is_err());
}

#[test]
fn sides_are_named_as_in_comparisons() {
    assert_eq!(Side::Before.name(), "before");
    assert_eq!(Side::After.name(), "after");
}

/// Keys items by label, or skips the items of one side.
struct Labels(Option<Side>);

impl Pass for Labels {
    fn name(&self) -> &str {
        "labels"
    }
    fn applies(&self, collection: Collection) -> bool {
        collection == Collection::Entities
    }
    fn answer(&self, side: Side, item: ItemRef, _: &Pairs) -> Result<Answer, Failure> {
        Ok(Answer::Key((Some(side) != self.0).then(|| item.label.unwrap().to_owned())))
    }
}

/// Pairs whatever is left, but only once the exact pass has paired something.
struct AfterExact;

impl Pass for AfterExact {
    fn name(&self) -> &str {
        "after-exact"
    }
    fn applies(&self, _: Collection) -> bool {
        true
    }
    fn enabled(&self, pairs: &Pairs) -> Result<bool, Failure> {
        Ok(pairs.contains_key("exact"))
    }
    fn answer(&self, _: Side, _: ItemRef, _: &Pairs) -> Result<Answer, Failure> {
        Ok(Answer::Key(Some(String::new())))
    }
}

fn statuses(before: &Value, after: &Value, passes: &[&dyn Pass]) -> Vec<(String, &'static str)> {
    let mut changes: Vec<_> = match_extractions(&typed(before), &typed(after), passes)
        .unwrap()
        .changes
        .iter()
        .map(|change| (change.id.clone(), change.status.name()))
        .collect();
    changes.sort();
    changes
}

fn unmatched() -> Vec<(String, &'static str)> {
    vec![("a".to_owned(), "removed"), ("b".to_owned(), "added")]
}

#[test]
fn a_pass_may_skip_items() {
    let before = graph(json!([entity("a", "same")]));
    let after = graph(json!([entity("b", "same")]));
    assert_eq!(statuses(&before, &after, &[&Labels(None)]), vec![("b".to_owned(), "unchanged")]);
    assert_eq!(statuses(&before, &after, &[&Labels(Some(Side::Before))]), unmatched());
    assert_eq!(statuses(&before, &after, &[&Labels(Some(Side::After))]), unmatched());
}

#[test]
fn a_disabled_pass_does_not_run() {
    let before = graph(json!([entity("a", "A"), entity("c", "C")]));
    let after = graph(json!([entity("b", "B"), entity("c", "C")]));
    let mut unpaired = unmatched();
    unpaired.extend([("c".to_owned(), "added"), ("c~1".to_owned(), "removed")]);
    assert_eq!(statuses(&before, &after, &[&AfterExact]), unpaired);
    assert_eq!(
        statuses(&before, &after, &[&Exact, &AfterExact]),
        vec![("b".to_owned(), "modified")]
    );
}
