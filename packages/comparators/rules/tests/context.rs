//! `context`: rules that add to each change's context, over the core's.

use projections_comparator_rules::Comparator;
use serde_json::{Value, json};

const RULES: &str = "format: projections.comparator
version: 0
classify:
  annotation: \"'seen'\"
context:
  - name: callers
    description: The functions that call a changed function.
    where: change.collection == 'entities' && item.kind == 'function' && annotation == 'seen'
    variables:
      - name: id
        expression: \"size(change.after) == 1 ? change.after[0] : ''\"
    after: |-
      variables.id in lookup.after.incoming
        ? lookup.after.incoming[variables.id].filter(r, r.kind == 'calls').map(r, r.from)
        : []
  - name: self
    description: Names the change's own item, which is left out, so it adds nothing.
    before: change.before
";

fn node(id: &str, kind: &str, label: &str) -> Value {
    json!({"id": id, "kind": kind, "label": label})
}

fn edge(id: &str, kind: &str, from: &str, to: &str) -> Value {
    json!({"id": id, "kind": kind, "from": from, "to": to})
}

/// A module containing a function, and a caller of it.
fn side(label: &str) -> Value {
    json!({"protocolVersion": 0, "schema": "graph/v0",
        "entities": [node("module", "module", "m"), node("function", "function", label), node("caller", "function", "c")],
        "relationships": [edge("module>function", "contains", "module", "function"), edge("caller>function", "calls", "caller", "function")]})
}

fn compare(rules: &str, before: &Value, after: &Value) -> Result<Value, String> {
    let comparator = Comparator::from_yaml(rules).map_err(|failure| format!("{failure:?}"))?;
    comparator
        .compare(before, after, &json!({}))
        .map_err(|failure| format!("{failure:?}"))
}

fn change<'a>(comparison: &'a Value, id: &str) -> &'a Value {
    comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|change| change["id"] == id)
        .unwrap()
}

#[test]
fn every_change_has_the_cores_context_and_rules_add_to_it() {
    let comparison = compare(RULES, &side("f"), &side("g")).unwrap();
    assert_eq!(
        change(&comparison, "function")["context"],
        json!({"before": ["module", "module>function"], "after": ["caller", "module", "module>function"], "rules": ["callers"]})
    );
    // Without rules, the core's context alone, as the default comparator gives it.
    let core = compare("format: projections.comparator\nversion: 0\n", &side("f"), &side("g")).unwrap();
    let context = json!({"before": ["module", "module>function"], "after": ["module", "module>function"]});
    assert_eq!(change(&core, "function")["context"], context);
    let default = projections_comparator_default::compare(&side("f"), &side("g"), &json!({})).unwrap();
    assert_eq!(change(&default, "function")["context"], context);
}

#[test]
fn rules_add_context_only_to_changes() {
    // The caller is unchanged, so nothing gives it context, and a removal's context is in before.
    let mut after = side("f");
    after["entities"]
        .as_array_mut()
        .unwrap()
        .retain(|entity| entity["id"] != "function");
    after["relationships"] = json!([]);
    let comparison = compare(RULES, &side("f"), &after).unwrap();
    assert_eq!(
        change(&comparison, "function")["context"],
        json!({"before": ["module", "module>function"], "after": []})
    );
    let removed = change(&comparison, "caller>function");
    assert_eq!(
        removed["context"],
        json!({"before": ["caller", "function", "module", "module>function"], "after": []})
    );
    assert!(
        comparison["changes"]
            .as_array()
            .unwrap()
            .iter()
            .all(|change| change["id"] != "caller")
    );
}

#[test]
fn context_names_items_of_its_revision() {
    let rules = RULES.replace("before: change.before", "before: \"['nowhere']\"");
    let error = compare(&rules, &side("f"), &side("g")).unwrap_err();
    assert!(error.contains("invalid-context") && error.contains("nowhere"), "{error}");
    let rules = RULES.replace("before: change.before", "before: \"[1]\"");
    let error = compare(&rules, &side("f"), &side("g")).unwrap_err();
    assert!(error.contains("Context must be a list of IDs"), "{error}");
}

#[test]
fn context_rules_are_named_once_and_say_what_they_add() {
    for (from, to, expected) in [
        ("name: self", "name: callers", "Context rule `callers` is already defined"),
        ("name: self", "name: 'not a name'", "Expected an identifier"),
        ("    before: change.before\n", "", "Expected `before`, `after` or both"),
        ("description: Names", "unknown: 1\n    description: Names", "unknown"),
        ("description: Names", "description: 7 #", "Expected a string"),
        ("context:\n", "context: {}\nx:\n", "Expected a list"),
    ] {
        let error = compare(&RULES.replacen(from, to, 1), &side("f"), &side("g")).unwrap_err();
        assert!(error.contains(expected), "{expected}: {error}");
    }
    let error = compare(
        &RULES.replace(
            "where: change.collection == 'entities' && item.kind == 'function' && annotation == 'seen'",
            "where: \"'x'\"",
        ),
        &side("f"),
        &side("g"),
    )
    .unwrap_err();
    assert!(error.contains("Expected a bool"), "{error}");
}

#[test]
fn rules_cant_grow_a_comparisons_context_past_its_limit() {
    // 251 changed entities, each given the same 1,000 unchanged ones: 251,000 IDs, past the comparison's 250,000.
    let others: Vec<String> = (0..1000).map(|index| format!("other{index:04}")).collect();
    let side = |label: &str| {
        let mut entities: Vec<Value> = others.iter().map(|id| node(id, "other", id)).collect();
        entities.extend((0..251).map(|index| node(&format!("changed{index:03}"), "changed", label)));
        json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": []})
    };
    let rules = "format: projections.comparator
version: 0
variables:
  - name: others
    expression: \"after.entities.filter(e, e.kind == 'other').map(e, e.id)\"
context:
  - name: everything
    after: variables.others
";
    let error = compare(rules, &side("a"), &side("b")).unwrap_err();
    assert!(error.contains("context-limit") && error.contains("rule `everything`"), "{error}");
    // Within it, the same rule's context is kept, named.
    let few = rules.replace("variables.others", "variables.others.filter(id, id < 'other0002')");
    let comparison = compare(&few, &side("a"), &side("b")).unwrap();
    assert_eq!(
        change(&comparison, "changed000")["context"],
        json!({"before": [], "after": ["other0000", "other0001"], "rules": ["everything"]})
    );
}

#[test]
fn the_names_of_the_rules_that_add_context_are_within_the_limit_too() {
    // 200 changed entities, each given the one other: few IDs, but a 100 KB rule name on each, past 16 MiB.
    let side = |label: &str| {
        let mut entities = vec![node("other", "other", "other")];
        entities.extend((0..200).map(|index| node(&format!("changed{index:03}"), "changed", label)));
        json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": []})
    };
    let rules = |name: &str| {
        format!(
            "format: projections.comparator\nversion: 0\ncontext:\n  - name: {name}\n    where: \"change.after[0] != 'other'\"\n    after: \"['other', 'other']\"\n"
        )
    };
    let error = compare(&rules(&"n".repeat(100_000)), &side("a"), &side("b")).unwrap_err();
    assert!(error.contains("context-limit"), "{}", &error[..error.len().min(300)]);
    // A short name fits, and the duplicate is listed once.
    let comparison = compare(&rules("other"), &side("a"), &side("b")).unwrap();
    assert_eq!(
        change(&comparison, "changed000")["context"],
        json!({"before": [], "after": ["other"], "rules": ["other"]})
    );
}
