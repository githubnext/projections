//! Rule coverage: a comparator read for coverage counts the functions,
//! expressions and branches its comparisons run, compares exactly as an
//! uncovered one does, at the same cost, and honours `coverage-ignore:`.

mod common;

use projections_comparator_rules::{Comparator, DEFAULT_BUDGET};
use serde_json::{Value, json};

const RULES: &str = r#"format: projections.comparator
version: 0
functions:
  label:
    params: ['n']
    body: |-
      n > 1 ? 'many' : n == 1 ? 'one' : 'none'
  unused:
    params: ['n']
    body: 'n + 1'
  kind:
    params: ['k']
    body: "match(k, {'service': 1, 'store': 2}, 0)"
checks:
  - assert: "!has(options.fail) || options.fail == false"
    message: "'told to fail'"
metadata:
  values:
    count: 'label(size(after.entities))'
    kinds: 'after.entities.map(e, kind(e.kind))'
    some: "after.entities.exists(e, e.kind == 'store') && size(before.entities) == 0"
    stores: "after.entities.filter(e, e.kind == 'store').size()"
    picked: |-
      cond({
        size(after.entities) > 5: 'big',
        size(after.entities) > 0: 'some', // coverage-ignore: shown in the report as excluded
      }, 'none')
"#;

fn extraction(kinds: &[&str]) -> Value {
    let entities: Vec<Value> = kinds
        .iter()
        .enumerate()
        .map(|(index, kind)| json!({"id": format!("e{index}"), "kind": kind, "label": kind}))
        .collect();
    json!({"protocolVersion": 0, "schema": "architecture/v0", "entities": entities, "relationships": []})
}

/// The entries of `category` as `(name or kind, condition, outcome, count)`.
fn entries(coverage: &Value, category: &str) -> Vec<(String, String, Value, u64)> {
    coverage[category]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| {
            (
                entry["name"]
                    .as_str()
                    .or(entry["kind"].as_str())
                    .unwrap_or(entry["path"].as_str().unwrap())
                    .to_owned(),
                entry["condition"].as_str().unwrap_or_default().to_owned(),
                entry["outcome"].clone(),
                entry["count"].as_u64().unwrap(),
            )
        })
        .collect()
}

fn count(coverage: &Value, kind: &str, condition: &str, outcome: Value) -> u64 {
    entries(coverage, "branches")
        .into_iter()
        .find(|(found, text, at, _)| found == kind && text == condition && *at == outcome)
        .unwrap_or_else(|| panic!("no {kind} branch `{condition}` {outcome}: {:#}", coverage["branches"]))
        .3
}

#[test]
fn coverage_counts_what_comparisons_run() {
    common::with_stack(coverage_counts_what_comparisons_run_);
}

fn coverage_counts_what_comparisons_run_() {
    let comparator = Comparator::with_coverage(RULES).unwrap();
    let plain = Comparator::from_yaml(RULES).unwrap();
    let cases = [
        (vec![], vec!["service"]),
        (vec!["store"], vec!["store", "service"]),
        (vec![], vec![]),
    ];
    for (before, after) in &cases {
        let (before, after) = (extraction(before), extraction(after));
        // The same comparison, at the same cost.
        assert_eq!(
            comparator.compare_with(&before, &after, &json!({}), DEFAULT_BUDGET).unwrap(),
            plain.compare_with(&before, &after, &json!({}), DEFAULT_BUDGET).unwrap()
        );
    }
    let coverage = comparator.coverage().unwrap();
    assert_eq!(coverage["format"], "projections.rules-coverage");
    assert!(plain.coverage().is_none());

    let functions: Vec<(String, u64)> = entries(&coverage, "functions")
        .into_iter()
        .map(|(name, _, _, n)| (name, n))
        .collect();
    assert_eq!(functions, [("kind".into(), 3), ("label".into(), 3), ("unused".into(), 0)]);
    // Functions' lines are their bodies'.
    assert_eq!(coverage["functions"][1]["line"], 7);

    // Every expression outside a function ran; the check's message never did.
    let expressions = entries(&coverage, "expressions");
    assert_eq!(expressions[0], ("/checks/0/assert".into(), String::new(), Value::Null, 3));
    assert_eq!(expressions[1], ("/checks/0/message".into(), String::new(), Value::Null, 0));

    // Conditionals: true and false, but no false outcome where the else branch is another conditional.
    assert_eq!(count(&coverage, "conditional", "n > 1", json!(true)), 1);
    assert_eq!(count(&coverage, "conditional", "n == 1", json!(true)), 1);
    assert_eq!(count(&coverage, "conditional", "n == 1", json!(false)), 1);
    assert!(
        !entries(&coverage, "branches")
            .iter()
            .any(|(_, text, at, _)| text == "n > 1" && *at == json!(false))
    );
    // `match` cases by key, and its default.
    assert_eq!(count(&coverage, "match", "'service'", json!(true)), 2);
    assert_eq!(count(&coverage, "match", "'store'", json!(true)), 1);
    assert_eq!(count(&coverage, "match", "'store'", json!(false)), 0);
    // Each operand of `||` and `&&`, both ways.
    assert_eq!(count(&coverage, "or", "!has(options.fail)", json!(true)), 3);
    assert_eq!(count(&coverage, "or", "options.fail == false", json!(true)), 0);
    assert_eq!(count(&coverage, "and", "size(before.entities) == 0", json!(true)), 0);
    assert_eq!(
        count(&coverage, "and", "after.entities.exists(e, e.kind == 'store')", json!(false)),
        2
    );
    // Macro predicates, and `map` bodies.
    assert_eq!(count(&coverage, "exists", "e.kind == 'store'", json!(true)), 1);
    assert_eq!(count(&coverage, "filter", "e.kind == 'store'", json!(false)), 2);
    assert_eq!(count(&coverage, "map", "kind(e.kind)", Value::Null), 3);

    // A `coverage-ignore:` comment excludes its line, with its reason.
    let excluded: Vec<&Value> = coverage["branches"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry.get("excluded").is_some())
        .collect();
    // Its default is on the next line, which isn't excluded.
    assert_eq!(excluded.len(), 1, "{excluded:#?}");
    assert_eq!(count(&coverage, "cond", "size(after.entities) > 0", json!(false)), 1);
    assert_eq!(excluded[0]["condition"], "size(after.entities) > 0");
    assert_eq!(excluded[0]["excluded"], "shown in the report as excluded");
}

#[test]
fn coverage_counts_failing_comparisons_too() {
    common::with_stack(|| {
        let comparator = Comparator::with_coverage(RULES).unwrap();
        let failure = comparator
            .compare(&extraction(&[]), &extraction(&[]), &json!({"fail": true}))
            .unwrap_err();
        assert_eq!(failure[0].message, "told to fail");
        let coverage = comparator.coverage().unwrap();
        assert_eq!(coverage["expressions"][1]["count"], 1);
        assert_eq!(count(&coverage, "or", "options.fail == false", json!(false)), 1);
    });
}
