//! Comparison integrity: the Engine checks every claim a comparator makes
//! against both extractions.

use projections_engine::{content, normalize, semantic, validate_comparison};
use serde_json::{Value, json};
use std::collections::HashMap;

fn node(id: &str) -> Value {
    json!({"id": id, "kind": "entity", "label": id})
}

fn labelled(id: &str, label: &str) -> Value {
    json!({"id": id, "kind": "entity", "label": label})
}

fn edge(id: &str, from: &str, to: &str) -> Value {
    json!({"id": id, "kind": "edge", "from": from, "to": to})
}

fn graph(entities: Value, relationships: Value) -> Value {
    normalize(
        &json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": relationships}),
        "",
    )
    .unwrap()
}

fn change(id: &str, before: &[&str], after: &[&str], status: &str, correspondence: &str) -> Value {
    json!({"id": id, "collection": "entities", "before": before, "after": after,
        "status": status, "correspondence": correspondence})
}

fn relationship(change: Value) -> Value {
    let mut change = change;
    change["collection"] = json!("relationships");
    change
}

fn comparison(changes: Vec<Value>) -> Value {
    let ids: Vec<_> = changes.iter().map(|change| change["id"].clone()).collect();
    let steps = if ids.is_empty() { json!([]) } else { json!([{"changes": ids}]) };
    json!({"protocolVersion": 0, "changes": changes, "steps": steps})
}

fn code(before: &Value, after: &Value, comparison: &Value) -> Option<(String, String, String)> {
    validate_comparison(before, after, comparison)
        .err()
        .map(|failure| (failure[0].code.clone(), failure[0].path.clone(), failure[0].message.clone()))
}

fn rejects(before: &Value, after: &Value, comparison: &Value, expected: &str, path: &str) -> String {
    let (code, actual, message) = code(before, after, comparison).expect("expected an error");
    assert_eq!((code.as_str(), actual.as_str()), (expected, path), "{message}");
    message
}

fn accepts(before: &Value, after: &Value, comparison: &Value) {
    assert_eq!(validate_comparison(before, after, comparison).unwrap(), *comparison);
}

#[test]
fn the_semantic_part_drops_identity_claims_and_evidence_only() {
    let item = json!({"id": "a", "kind": "k", "label": "", "data": {}, "previousIds": ["z"],
        "evidence": [], "confidence": "derived"});
    assert_eq!(
        semantic(&item),
        json!({"id": "a", "kind": "k", "label": "", "data": {}, "confidence": "derived"})
    );
}

#[test]
fn content_excludes_the_id_defaults_data_and_rewrites_endpoints() {
    assert_eq!(
        content(&json!({"id": "a", "kind": "k", "label": "l"}), None).unwrap(),
        r#"{"data":{},"kind":"k","label":"l"}"#
    );
    let aliases = HashMap::from([("old".to_owned(), "new".to_owned())]);
    let relationship = json!({"id": "r", "kind": "k", "from": "old", "to": "other", "data": {"w": 1}});
    assert_eq!(
        content(&relationship, Some(&aliases)).unwrap(),
        r#"{"data":{"w":1},"from":"new","kind":"k","to":"other"}"#
    );
    assert_eq!(
        content(&relationship, None).unwrap(),
        r#"{"data":{"w":1},"from":"old","kind":"k","to":"other"}"#
    );
}

#[test]
fn comparisons_are_strict_versioned_objects() {
    let side = graph(json!([]), json!([]));
    accepts(&side, &side, &comparison(vec![]));
    rejects(&side, &side, &json!([]), "invalid-type", "/comparison");
    let mut value = comparison(vec![]);
    value["protocolVersion"] = json!(0.0);
    accepts(&side, &side, &value);
    value.as_object_mut().unwrap().remove("protocolVersion");
    rejects(&side, &side, &value, "unsupported-version", "/comparison/protocolVersion");
    rejects(
        &side,
        &side,
        &json!({"protocolVersion": 0, "steps": []}),
        "invalid-type",
        "/comparison/changes",
    );
    rejects(
        &side,
        &side,
        &json!({"protocolVersion": 0, "changes": []}),
        "invalid-type",
        "/comparison/steps",
    );
    let mut value = comparison(vec![]);
    value["metadata"] = json!({"comparator": "test"});
    accepts(&side, &side, &value);
    value["metadata"] = json!("test");
    rejects(&side, &side, &value, "invalid-type", "/comparison/metadata");
}

#[test]
fn changes_need_valid_ids_collections_statuses_and_correspondence() {
    let before = graph(json!([node("a")]), json!([]));
    let after = graph(json!([]), json!([]));
    let valid = change("a", &["a"], &[], "removed", "none");
    let mut with_summary = valid.clone();
    with_summary["summary"] = json!("Removed a");
    accepts(&before, &after, &comparison(vec![with_summary]));
    for (field, invalid, message) in [
        ("id", json!(""), "Expected a nonempty string"),
        ("collection", json!("nodes"), "Expected entities or relationships"),
        ("collection", Value::Null, "Expected entities or relationships"),
        ("status", json!("renamed"), "Expected added, removed, modified or unchanged"),
        ("correspondence", json!("fuzzy"), "Expected exact, declared, split, merge or none"),
        ("summary", json!(" "), "Expected a nonempty string"),
        ("before", json!("a"), "Expected an array"),
        ("after", Value::Null, "Expected an array"),
    ] {
        let mut change = valid.clone();
        change[field] = invalid;
        let actual = rejects(
            &before,
            &after,
            &comparison(vec![change]),
            "invalid-type",
            &format!("/comparison/changes/0/{field}"),
        );
        assert_eq!(actual, message, "{field}");
    }
    let mut change = valid.clone();
    change["before"] = json!([""]);
    rejects(
        &before,
        &after,
        &comparison(vec![change]),
        "invalid-type",
        "/comparison/changes/0/before/0",
    );
    let mut change = valid;
    change["before"] = json!(["a", "a"]);
    let message = rejects(
        &before,
        &after,
        &comparison(vec![change]),
        "duplicate-reference",
        "/comparison/changes/0/before/1",
    );
    assert_eq!(message, "Duplicate ID in a change");
}

#[test]
fn references_must_exist_on_their_side_and_in_their_collection() {
    let before = graph(json!([node("a"), node("b")]), json!([edge("r", "a", "b")]));
    let after = graph(json!([node("a"), node("b")]), json!([]));
    accepts(
        &before,
        &after,
        &comparison(vec![relationship(change("r", &["r"], &[], "removed", "none"))]),
    );
    let message = rejects(
        &before,
        &after,
        &comparison(vec![change("r", &["r"], &[], "removed", "none")]),
        "unknown-reference",
        "/comparison/changes/0/before/0",
    );
    assert_eq!(message, "No entities item with this ID exists before");
    let message = rejects(
        &before,
        &after,
        &comparison(vec![relationship(change("r", &[], &["r"], "added", "none"))]),
        "unknown-reference",
        "/comparison/changes/0/after/0",
    );
    assert_eq!(message, "No relationships item with this ID exists after");
    // The same ID may be referenced once per side.
    let renamed = graph(json!([node("a"), node("b2")]), json!([]));
    let before = graph(json!([node("a"), node("b")]), json!([]));
    let mut change_b = change("b2", &["b"], &["b2"], "modified", "declared");
    accepts(&before, &renamed, &comparison(vec![change_b.clone()]));
    change_b["status"] = json!("unchanged");
    change_b["id"] = json!("other");
    let message = rejects(
        &before,
        &renamed,
        &comparison(vec![change("b2", &["b"], &["b2"], "modified", "declared"), change_b]),
        "duplicate-reference",
        "/comparison/changes/1/before/0",
    );
    assert_eq!(message, "An item may belong to at most one change");
}

/// Correspondence, status, before IDs, after IDs and whether the shape is valid.
type Shape<'a> = (&'a str, &'a str, &'a [&'a str], &'a [&'a str], bool);

#[test]
fn every_status_and_correspondence_has_one_shape() {
    let before = graph(json!([node("a"), node("b"), node("c")]), json!([]));
    let after = graph(json!([node("a"), node("x"), node("y")]), json!([]));
    let cases: &[Shape] = &[
        ("none", "added", &[], &["x"], true),
        ("none", "added", &[], &[], false),
        ("none", "added", &[], &["x", "y"], false),
        ("none", "added", &["b"], &["x"], false),
        ("none", "removed", &["b"], &[], true),
        ("none", "removed", &[], &[], false),
        ("none", "removed", &["b", "c"], &[], false),
        ("none", "removed", &["b"], &["x"], false),
        ("none", "modified", &["b"], &["x"], false),
        ("none", "unchanged", &["a"], &["a"], false),
        ("exact", "modified", &["a"], &["a"], true),
        ("exact", "unchanged", &["a"], &["a"], true),
        ("exact", "modified", &["b"], &["x"], false),
        ("exact", "modified", &["a", "b"], &["a"], false),
        ("exact", "modified", &["a"], &["a", "x"], false),
        ("exact", "added", &[], &["a"], false),
        ("exact", "removed", &["a"], &[], false),
        ("declared", "modified", &["b"], &["x"], true),
        ("declared", "unchanged", &["b"], &["x"], true),
        ("declared", "modified", &["a"], &["a"], false),
        ("declared", "modified", &["b"], &["x", "y"], false),
        ("declared", "modified", &["b", "c"], &["x"], false),
        ("declared", "added", &[], &["x"], false),
        ("split", "modified", &["b"], &["x", "y"], true),
        ("split", "unchanged", &["b"], &["x", "y"], true),
        ("split", "modified", &["b"], &["x"], false),
        ("split", "modified", &["b", "c"], &["x", "y"], false),
        ("split", "modified", &[], &["x", "y"], false),
        ("split", "added", &["b"], &["x", "y"], false),
        ("merge", "modified", &["b", "c"], &["x"], true),
        ("merge", "unchanged", &["b", "c"], &["x"], true),
        ("merge", "modified", &["b"], &["x"], false),
        ("merge", "modified", &["b", "c"], &["x", "y"], false),
        ("merge", "modified", &["b", "c"], &[], false),
        ("merge", "removed", &["b", "c"], &["x"], false),
    ];
    for (correspondence, status, old, new, valid) in cases {
        let value = comparison(vec![change("c1", old, new, status, correspondence)]);
        let shape = code(&before, &after, &value).filter(|(code, ..)| code == "invalid-change-shape");
        assert_eq!(shape.is_none(), *valid, "{correspondence} {status} {old:?} {new:?}");
        if let Some((_, path, message)) = shape {
            assert_eq!(path, "/comparison/changes/0");
            assert_eq!(message, "Status and correspondence do not match the change's before and after IDs");
        }
    }
}

#[test]
fn one_to_one_changes_must_state_whether_content_changed() {
    let before = graph(json!([node("a"), node("b")]), json!([]));
    let same = graph(json!([node("a"), labelled("c", "b")]), json!([]));
    let different = graph(json!([labelled("a", "A"), node("c")]), json!([]));
    accepts(
        &before,
        &same,
        &comparison(vec![change("c", &["b"], &["c"], "unchanged", "declared")]),
    );
    let message = rejects(
        &before,
        &same,
        &comparison(vec![change("c", &["b"], &["c"], "modified", "declared")]),
        "inconsistent-status",
        "/comparison/changes/0/status",
    );
    assert_eq!(message, "Content is canonically equal, so the change cannot be modified");
    let value = comparison(vec![
        change("a", &["a"], &["a"], "unchanged", "exact"),
        change("c", &["b"], &["c"], "modified", "declared"),
    ]);
    let message = rejects(&before, &different, &value, "inconsistent-status", "/comparison/changes/0/status");
    assert_eq!(message, "Content differs, so the change must be modified");
    accepts(
        &before,
        &different,
        &comparison(vec![
            change("a", &["a"], &["a"], "modified", "exact"),
            change("c", &["b"], &["c"], "modified", "declared"),
        ]),
    );
    // Splits and merges carry no content claim.
    let split = graph(json!([node("a"), node("b1"), node("b2")]), json!([]));
    for status in ["modified", "unchanged"] {
        accepts(
            &before,
            &split,
            &comparison(vec![change("b1", &["b"], &["b1", "b2"], status, "split")]),
        );
    }
}

#[test]
fn relationship_content_follows_one_to_one_entity_correspondence() {
    let before = graph(json!([node("a"), node("s")]), json!([edge("r", "a", "s")]));
    let after = graph(json!([labelled("b", "a"), node("s")]), json!([edge("r", "b", "s")]));
    let renamed = change("b", &["a"], &["b"], "unchanged", "declared");
    accepts(&before, &after, &comparison(vec![renamed.clone()]));
    // Through an exact entity change, endpoints are unchanged too.
    let before = graph(json!([node("a"), node("s")]), json!([edge("r", "a", "s")]));
    let after = graph(json!([labelled("a", "A"), node("s")]), json!([edge("r", "a", "s")]));
    accepts(&before, &after, &comparison(vec![change("a", &["a"], &["a"], "modified", "exact")]));
    // Relationship changes are themselves checked through the aliases.
    let before = graph(json!([node("a"), node("s")]), json!([edge("r", "a", "s")]));
    let after = graph(json!([labelled("b", "a"), node("s")]), json!([edge("q", "b", "s")]));
    let declared = relationship(change("q", &["r"], &["q"], "unchanged", "declared"));
    accepts(&before, &after, &comparison(vec![renamed.clone(), declared.clone()]));
    let mut modified = declared;
    modified["status"] = json!("modified");
    rejects(
        &before,
        &after,
        &comparison(vec![renamed, modified]),
        "inconsistent-status",
        "/comparison/changes/1/status",
    );
    // A new entity may reuse a renamed entity's old ID; relationships still
    // follow the declared rename rather than the reused ID.
    let old = graph(json!([node("x"), node("s")]), json!([edge("r", "x", "s")]));
    let reused = graph(
        json!([labelled("x", "new"), labelled("y", "x"), node("s")]),
        json!([edge("r", "y", "s")]),
    );
    accepts(
        &old,
        &reused,
        &comparison(vec![
            change("y", &["x"], &["y"], "unchanged", "declared"),
            change("x", &[], &["x"], "added", "none"),
        ]),
    );
    // A split entity is not one-to-one, so its relationships change.
    let after = graph(json!([labelled("b", "a"), node("c"), node("s")]), json!([edge("r", "b", "s")]));
    let split = change("b", &["a"], &["b", "c"], "modified", "split");
    rejects(
        &before,
        &after,
        &comparison(vec![split.clone()]),
        "hidden-change",
        "/comparison/changes",
    );
    accepts(
        &before,
        &after,
        &comparison(vec![split, relationship(change("r", &["r"], &["r"], "modified", "exact"))]),
    );
}

#[test]
fn a_comparison_cannot_omit_an_item_from_either_side() {
    let before = graph(json!([node("a")]), json!([]));
    let after = graph(json!([node("a"), node("b")]), json!([]));
    let message = rejects(&before, &after, &comparison(vec![]), "hidden-change", "/comparison/changes");
    assert_eq!(message, "The comparison omits a change to entities item \"b\"");
    let message = rejects(&after, &before, &comparison(vec![]), "hidden-change", "/comparison/changes");
    assert_eq!(message, "The comparison omits a change to entities item \"b\"");
    // An unreferenced item whose counterpart belongs to a change is hidden.
    let message = rejects(
        &before,
        &after,
        &comparison(vec![change("b", &["a"], &["b"], "modified", "declared")]),
        "hidden-change",
        "/comparison/changes",
    );
    assert_eq!(message, "The comparison omits a change to entities item \"a\"");
    let message = rejects(
        &after,
        &before,
        &comparison(vec![change("a", &["b"], &["a"], "modified", "declared")]),
        "hidden-change",
        "/comparison/changes",
    );
    assert_eq!(message, "The comparison omits a change to entities item \"a\"");
    // So is an unreferenced item whose content differs, on either side.
    let changed = graph(json!([labelled("a", "A")]), json!([]));
    rejects(&before, &changed, &comparison(vec![]), "hidden-change", "/comparison/changes");
    rejects(&changed, &before, &comparison(vec![]), "hidden-change", "/comparison/changes");
    // Relationships are checked the same way.
    let base = graph(json!([node("a")]), json!([]));
    let linked = graph(json!([node("a")]), json!([edge("r", "a", "a")]));
    let message = rejects(&base, &linked, &comparison(vec![]), "hidden-change", "/comparison/changes");
    assert_eq!(message, "The comparison omits a change to relationships item \"r\"");
    rejects(&linked, &base, &comparison(vec![]), "hidden-change", "/comparison/changes");
    // Identical items need no change.
    accepts(&linked, &linked, &comparison(vec![]));
}

#[test]
fn comparisons_need_the_same_schema() {
    let graph = graph(json!([]), json!([]));
    let tree = normalize(
        &json!({"protocolVersion": 0, "schema": "dag/v0", "entities": [], "relationships": []}),
        "",
    )
    .unwrap();
    let message = rejects(&graph, &tree, &comparison(vec![]), "schema-mismatch", "/after/schema");
    assert_eq!(message, "Comparisons require the same domain schema");
}

#[test]
fn steps_are_nonempty_kinded_and_cover_each_change_once() {
    let before = graph(json!([]), json!([]));
    let after = graph(json!([node("a"), node("b")]), json!([]));
    let mut value = comparison(vec![
        change("a", &[], &["a"], "added", "none"),
        change("b", &[], &["b"], "added", "none"),
    ]);
    for kind in ["remove", "restructure", "add"] {
        value["steps"] = json!([{"changes": ["a"], "kind": kind, "summary": "A"}, {"changes": ["b"]}]);
        accepts(&before, &after, &value);
    }
    for (steps, code, path, message) in [
        (json!({}), "invalid-type", "/comparison/steps", "Expected an array"),
        (json!([[]]), "invalid-type", "/comparison/steps/0", "Expected an object"),
        (
            json!([{"changes": "a"}]),
            "invalid-type",
            "/comparison/steps/0/changes",
            "Expected an array",
        ),
        (
            json!([{"changes": ["a", 1]}]),
            "invalid-type",
            "/comparison/steps/0/changes/1",
            "Expected a nonempty string",
        ),
        (
            json!([{"changes": ["a", "b"], "kind": null}]),
            "invalid-step",
            "/comparison/steps/0/kind",
            "Expected remove, restructure or add",
        ),
        (
            json!([{"changes": ["a", "b"], "summary": ""}]),
            "invalid-type",
            "/comparison/steps/0/summary",
            "Expected a nonempty string",
        ),
        (
            json!([{"changes": []}]),
            "empty-step",
            "/comparison/steps/0/changes",
            "A step must contain at least one change",
        ),
        (
            json!([{"changes": ["a", "c"]}]),
            "unknown-change",
            "/comparison/steps/0/changes/1",
            "Step references an unknown change",
        ),
        (
            json!([{"changes": ["a", "a", "b"]}]),
            "step-coverage",
            "/comparison/steps/0/changes/1",
            "Every change must appear in exactly one step",
        ),
        (
            json!([]),
            "step-coverage",
            "/comparison/steps",
            "Every change must appear in exactly one step",
        ),
    ] {
        value["steps"] = steps;
        let actual = rejects(&before, &after, &value, code, path);
        assert_eq!(actual, message, "{path}");
    }
}

#[test]
fn the_reverse_order_is_mirrored_unless_explicit() {
    let before = graph(json!([]), json!([]));
    let after = graph(json!([node("a"), node("b")]), json!([]));
    let mut value = comparison(vec![
        change("a", &[], &["a"], "added", "none"),
        change("b", &[], &["b"], "added", "none"),
    ]);
    value["order"] = json!({"reverse": "mirror"});
    accepts(&before, &after, &value);
    for (order, path, code) in [
        (json!({"reverse": "backwards"}), "/comparison/order/reverse", "invalid-type"),
        (json!({}), "/comparison/order/reverse", "invalid-type"),
        (json!({"reverse": "mirror", "by": "x"}), "/comparison/order/by", "unknown-field"),
        (json!("mirror"), "/comparison/order", "invalid-type"),
    ] {
        value["order"] = order;
        rejects(&before, &after, &value, code, path);
    }
    value["order"] = json!({"reverse": "explicit"});
    value["reverseSteps"] = json!([{"changes": ["b"]}, {"changes": ["a"], "kind": "remove"}]);
    accepts(&before, &after, &value);
    value["reverseSteps"] = json!([{"changes": ["b", "c"]}]);
    rejects(&before, &after, &value, "unknown-change", "/comparison/reverseSteps/0/changes/1");
    value["reverseSteps"] = json!([{"changes": ["a", "b"]}]);
    value.as_object_mut().unwrap().remove("order");
    let message = rejects(&before, &after, &value, "unexpected-reverse-steps", "/comparison/reverseSteps");
    assert_eq!(message, "reverseSteps require order.reverse explicit");
    value["order"] = json!({"reverse": "explicit"});
    value.as_object_mut().unwrap().remove("reverseSteps");
    let message = rejects(&before, &after, &value, "missing-reverse-steps", "/comparison/reverseSteps");
    assert_eq!(message, "An explicit reverse order requires reverseSteps");
}
