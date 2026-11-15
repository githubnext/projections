//! Every comparison runs under a deterministic cost budget: the same rules
//! and input cost the same on every host, and rules that would compute for
//! too long or build too large a value fail with `cost-limit`.

mod common;

use projections_comparator_rules::Comparator;
use serde_json::json;

fn empty() -> serde_json::Value {
    json!({"protocolVersion": 0, "schema": "graph/v0", "entities": [], "relationships": []})
}

fn metadata(expression: &str) -> String {
    json!({"format": "projections.comparator", "version": 0, "metadata": {"values": {"value": expression}}}).to_string()
}

#[test]
fn quadratic_work_exceeds_the_budget() {
    common::with_stack(quadratic_work_exceeds_the_budget_);
}

fn quadratic_work_exceeds_the_budget_() {
    let rules = metadata("lists.range(1000000).filter(i, lists.range(1000000).exists(j, j == i + 1000000)).size()");
    let failure = Comparator::from_yaml(&rules)
        .unwrap()
        .compare(&empty(), &empty(), &json!({}))
        .unwrap_err();
    assert_eq!(failure[0].code, "cost-limit", "{failure:?}");
}

#[test]
fn exponential_values_exceed_the_budget() {
    common::with_stack(exponential_values_exceed_the_budget_);
}

fn exponential_values_exceed_the_budget_() {
    let mut functions = serde_json::Map::new();
    functions.insert("f0".into(), json!({"params": ["s"], "body": "s + s"}));
    for level in 1..40 {
        functions.insert(
            format!("f{level}"),
            json!({"params": ["s"], "body": format!("f{}(s + s)", level - 1)}),
        );
    }
    let rules = json!({"format": "projections.comparator", "version": 0, "functions": functions,
        "metadata": {"values": {"size": "size(f39('x'))"}}})
    .to_string();
    let failure = Comparator::from_yaml(&rules)
        .unwrap()
        .compare(&empty(), &empty(), &json!({}))
        .unwrap_err();
    assert_eq!(failure[0].code, "cost-limit", "{failure:?}");
}

#[test]
fn cost_is_deterministic_and_bounded_by_the_budget() {
    common::with_stack(cost_is_deterministic_and_bounded_by_the_budget_);
}

fn cost_is_deterministic_and_bounded_by_the_budget_() {
    let comparator = common::comparator("runtime-policy");
    let fixtures = common::root().join("packages/extractors/tetragon-policies/tests/fixtures/deployment");
    let before = common::read(&fixtures.join("before.expected.json"));
    let after = common::read(&fixtures.join("after.expected.json"));
    let (comparison, cost) = comparator.compare_with(&before, &after, &json!({}), u64::MAX).unwrap();
    for _ in 0..3 {
        assert_eq!(
            comparator.compare_with(&before, &after, &json!({}), u64::MAX).unwrap(),
            (comparison.clone(), cost)
        );
    }
    assert!(cost > 0);
    // Exactly the cost fits; one unit less doesn't.
    assert!(comparator.compare_with(&before, &after, &json!({}), cost).is_ok());
    let failure = comparator.compare_with(&before, &after, &json!({}), cost - 1).unwrap_err();
    assert_eq!(failure[0].code, "cost-limit");
}
