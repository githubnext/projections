//! The rules macros (`match`, `cond`, `collect`, `template`), the lint for
//! chained conditionals, declared `values:` domains, guaranteed `data`, the
//! classify `item` binding and `lists.zipLongest`/`lists.enumerate`.

mod common;

use projections_comparator_rules::Comparator;
use serde_json::{Value, json};

fn rules(body: &str) -> String {
    format!("format: projections.comparator\nversion: 0\n{body}")
}

fn load(body: &str) -> Comparator {
    Comparator::from_yaml(&rules(body)).unwrap_or_else(|failure| panic!("{failure:?}"))
}

/// The messages of every load-time problem.
fn errors(body: &str) -> Vec<String> {
    match Comparator::from_yaml(&rules(body)) {
        Ok(_) => panic!("expected the rules to fail"),
        Err(failure) => failure.into_iter().map(|d| d.message).collect(),
    }
}

fn warnings(body: &str) -> Vec<(String, String, String)> {
    load(body)
        .warnings()
        .iter()
        .map(|d| (d.code.clone(), d.path.clone(), d.message.clone()))
        .collect()
}

fn extraction(entities: Value) -> Value {
    json!({"protocolVersion": 0, "schema": "architecture/v0", "entities": entities, "relationships": []})
}

/// The comparison's metadata, comparing `before` with `after`.
fn metadata(body: &str, before: Value, after: Value) -> Value {
    let comparison = load(body)
        .compare(&extraction(before), &extraction(after), &json!({}))
        .unwrap_or_else(|failure| panic!("{failure:?}"));
    comparison["metadata"].clone()
}

fn value(expression: &str) -> Value {
    let body = format!("metadata:\n  values:\n    x: |-\n      {expression}\n");
    metadata(&body, json!([]), json!([]))["x"].clone()
}

#[test]
fn match_picks_one_branch_and_evaluates_no_other() {
    assert_eq!(value("match('b', {'a': 1, 'b': 2}, 3)"), json!(2));
    assert_eq!(value("match('z', {'a': 1, 'b': 2}, 3)"), json!(3));
    assert_eq!(value("match(2, {1: 'one', 2: 'two'}, 'many')"), json!("two"));
    // Only the chosen branch runs: the others would fail.
    assert_eq!(value("match('a', {'a': 'ok', 'b': [][0]}, {}['x'])"), json!("ok"));
}

#[test]
fn cond_takes_the_first_condition_that_holds() {
    assert_eq!(value("cond({1 > 2: 'a', 2 > 1: 'b', true: 'c'}, 'd')"), json!("b"));
    assert_eq!(value("cond({false: 'a'}, 'd')"), json!("d"));
    assert_eq!(value("cond({true: 'a', [][0] == 1: 'b'}, 'd')"), json!("a"));
}

#[test]
fn collect_lists_the_values_whose_conditions_hold_in_order() {
    assert_eq!(value("collect({true: 'a', false: 'b', 1 < 2: 'c'})"), json!(["a", "c"]));
    assert_eq!(value("collect({false: 'a'})"), json!([]));
    assert_eq!(value("collect({false: [][0]})"), json!([]));
}

#[test]
fn templates_fill_named_fields() {
    assert_eq!(
        value("template('{who} moved {n}% of {{x}}', {'who': 'Ann', 'n': 5})"),
        json!("Ann moved 5% of {x}")
    );
    let body = "variables:\n  - name: who\n    expression: \"'Ann'\"\nmetadata:\n  values:\n    x: template('Hi {who}')\n";
    assert_eq!(metadata(body, json!([]), json!([]))["x"], json!("Hi Ann"));
}

#[test]
fn macro_mistakes_are_load_errors_with_their_lines() {
    let at = |expression: &str| errors(&format!("metadata:\n  values:\n    x: \"{expression}\"\n"));
    let first = |expression: &str| at(expression).remove(0);
    assert!(
        first("match('a', {'a': 1, 'a': 2}, 3)").starts_with("Line 5, column "),
        "{:?}",
        at("match('a', {'a': 1, 'a': 2}, 3)")
    );
    assert!(first("match('a', {'a': 1, 'a': 2}, 3)").contains("The `match` key 'a' appears twice"));
    assert!(first("match('a', {'a' + 'b': 1}, 3)").contains("A `match` key is a string or int literal"));
    assert!(first("match('a', {'a': 1}, 'x')").contains("`match` branches have different types"));
    assert!(first("cond({true: [1]}, 'x')").contains("`cond` branches have different types"));
    assert!(first("match('a', {'a': 1})").contains("match"));
    assert!(first("template('{a} {b}', {'a': 1})").contains("names `{b}`, which its map doesn't give"));
    assert!(first("template('{a}', {'a': 1, 'b': 2})").contains("doesn't use the field `b`"));
    assert!(first("template('{a', {'a': 1})").contains("template"));
    // A rules function can't take a macro's name.
    let named = errors("functions:\n  match:\n    body: '1'\n");
    assert!(named.iter().any(|m| m.contains("match")), "{named:?}");
}

#[test]
fn match_checks_its_keys_against_a_declared_domain() {
    let body = "functions:
  word:
    params: [{name: n, type: string, values: [one, two, three]}]
    returns: string
    body: \"match(n, {'one': 'a', 'two': 'b', 'four': 'd'}, '')\"
";
    let found = warnings(body);
    assert_eq!(found.len(), 2, "{found:?}");
    for (code, path, message) in &found {
        assert_eq!(code, "match-values");
        assert_eq!(path, "/functions/word/body");
        assert!(message.starts_with("Line 7, column "), "{message}");
    }
    assert!(found[0].2.contains("`n` is never 'four'"), "{}", found[0].2);
    assert!(found[1].2.contains("leaves 'three' to its default"), "{}", found[1].2);
    // Variables declare domains too; a match that covers it exactly is clean.
    let clean = "variables:
  - name: level
    expression: \"'low'\"
    values: [low, high]
metadata:
  values:
    x: \"match(variables.level, {'low': 1, 'high': 2}, 0)\"
";
    assert_eq!(warnings(clean), vec![]);
    assert!(errors("variables:\n  - name: v\n    expression: '1'\n    values: []\n")[0].contains("nonempty list"));
}

#[test]
fn conditional_chains_of_three_are_lint_warnings() {
    let two = "metadata:\n  values:\n    x: \"1 > 2 ? 'a' : 2 > 3 ? 'b' : 'c'\"\n";
    assert_eq!(warnings(two), vec![]);
    assert_eq!(load(two).conditional_chains(), 1);
    let three = "metadata:\n  values:\n    x: \"1 > 2 ? 'a' : 2 > 3 ? 'b' : 3 > 4 ? 'c' : 'd'\"\n";
    let found = warnings(three);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].0, "chained-conditional");
    assert_eq!(found[0].1, "/metadata/values/x");
    assert!(found[0].2.starts_with("Line 5, column "), "{}", found[0].2);
    assert!(found[0].2.contains("A chain of 3 conditionals"), "{}", found[0].2);
    // A chain through the true branch counts too, and macros don't.
    let nested = "metadata:\n  values:\n    x: \"1 > 2 ? (2 > 3 ? (3 > 4 ? 'a' : 'b') : 'c') : 'd'\"\n";
    assert_eq!(warnings(nested).len(), 1);
    let macros = "metadata:\n  values:\n    x: \"cond({1 > 2: 'a', 2 > 3: 'b', 3 > 4: 'c'}, 'd')\"\n";
    assert_eq!(warnings(macros), vec![]);
    assert_eq!(load(macros).conditional_chains(), 0);
}

#[test]
fn items_always_carry_data_and_classify_binds_item() {
    let body = "classify:
  where: change.collection == 'entities'
  summary: \"template('{label} {mode}', {'label': item.label, 'mode': item.data.?mode.orValue('none')})\"
metadata:
  values:
    data: \"after.entities.map(e, e.data)\"
";
    let before = json!([{"id": "a", "kind": "k", "label": "A"}, {"id": "b", "kind": "k", "label": "B"}]);
    let after = json!([{"id": "a", "kind": "k", "label": "A", "data": {"mode": "on"}}]);
    let comparator = load(body);
    let comparison = comparator.compare(&extraction(before), &extraction(after), &json!({})).unwrap();
    let summary = |id: &str| {
        comparison["changes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == format!("entity:{id}") || c["after"][0] == id || c["before"][0] == id)
            .map(|c| c["summary"].clone())
            .unwrap()
    };
    assert_eq!(summary("a"), json!("A on"));
    // A removed entity is `item` too, and its missing `data` is `{}`.
    assert_eq!(summary("b"), json!("B none"));
    assert_eq!(comparison["metadata"]["data"], json!([{"mode": "on"}]));
}

#[test]
fn zip_longest_and_enumerate_replace_index_loops() {
    assert_eq!(value("lists.zipLongest([1, 2, 3], ['a'])"), json!([[1, "a"], [2, null], [3, null]]));
    assert_eq!(value("lists.zipLongest([], [])"), json!([]));
    assert_eq!(value("lists.enumerate(['a', 'b'])"), json!([[0, "a"], [1, "b"]]));
}

#[test]
fn a_library_call_is_not_a_call_to_an_author_function_of_the_same_name() {
    // `graph.entity` is the library's; `entity` here is the author's, and
    // calls it without recursing.
    let body = "functions:
  entity:
    params: [{name: id, type: string}]
    body: \"graph.entity('after', id)\"
metadata:
  values:
    x: \"entity('a').label\"
";
    let after = json!([{"id": "a", "kind": "k", "label": "A"}]);
    assert_eq!(metadata(body, json!([]), after)["x"], json!("A"));
}

#[test]
fn a_template_without_a_map_reads_parameters_then_variables() {
    let body = "variables:
  - name: place
    expression: \"'Oslo'\"
functions:
  greeting:
    params: [{name: who, type: string}]
    returns: string
    variables:
      - name: when
        expression: \"'today'\"
    body: template('{who} is in {when}')
metadata:
  values:
    x: greeting('Ann')
    y: template('Hi from {place}')
";
    let found = metadata(body, json!([]), json!([]));
    assert_eq!(found["x"], json!("Ann is in today"));
    assert_eq!(found["y"], json!("Hi from Oslo"));
}
