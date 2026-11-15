//! Correspondence edge cases: independent claim groups, claims that name
//! missing or exactly matched items, and change ID collisions.

use projections_comparator_default::compare;
use serde_json::{Value, json};

fn entity(id: &str) -> Value {
    json!({"id": id, "kind": "entity", "label": id})
}

fn claim(id: &str, previous: &[&str]) -> Value {
    let mut value = entity(id);
    value["previousIds"] = json!(previous);
    value
}

fn edge(id: &str, from: &str, to: &str) -> Value {
    json!({"id": id, "kind": "edge", "from": from, "to": to})
}

fn graph(entities: Value, relationships: Value) -> Value {
    json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": relationships})
}

fn changes(before: &Value, after: &Value) -> Value {
    compare(before, after, &json!({})).unwrap()["changes"].clone()
}

fn change(id: &str, before: &[&str], after: &[&str], status: &str, correspondence: &str) -> Value {
    json!({"id": id, "collection": "entities", "before": before, "after": after,
        "status": status, "correspondence": correspondence})
}

#[test]
fn independent_claim_groups_stay_separate() {
    let before = graph(json!([entity("a"), entity("b"), entity("c")]), json!([]));
    let after = graph(
        json!([claim("x", &["a"]), claim("y", &["b"]), claim("z1", &["c"]), claim("z2", &["c"])]),
        json!([]),
    );
    assert_eq!(
        changes(&before, &after),
        json!([
            change("x", &["a"], &["x"], "modified", "declared"),
            change("y", &["b"], &["y"], "modified", "declared"),
            change("z1", &["c"], &["z1", "z2"], "modified", "split"),
        ])
    );
}

#[test]
fn claims_naming_missing_items_are_ignored_in_both_directions() {
    let before = graph(json!([entity("a")]), json!([]));
    let after = graph(json!([claim("x", &["never"])]), json!([]));
    let expected = json!([
        change("a", &["a"], &[], "removed", "none"),
        change("x", &[], &["x"], "added", "none"),
    ]);
    assert_eq!(changes(&before, &after), expected);
    let reverse = json!([
        change("a", &[], &["a"], "added", "none"),
        change("x", &["x"], &[], "removed", "none"),
    ]);
    assert_eq!(changes(&after, &before), reverse);
}

#[test]
fn colliding_change_ids_take_the_next_free_suffix() {
    // Entity changes "x" and "x~1" take their IDs first; the relationship
    // change "x" then skips both.
    let before = graph(json!([entity("a"), entity("x"), entity("x~1")]), json!([]));
    let after = graph(json!([entity("a")]), json!([edge("x", "a", "a")]));
    let ids: Vec<_> = compare(&before, &after, &json!({})).unwrap()["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| change["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids, ["x", "x~1", "x~2"]);
}

#[test]
fn merged_entities_share_one_identity_for_ordering() {
    // b and c merge into m, so d hangs below m (depth 2) while e is at depth 1:
    // removals go leaves first, so d leaves before e.
    let before = graph(
        json!([entity("root"), entity("b"), entity("c"), entity("d"), entity("e")]),
        json!([edge("rb", "root", "b"), edge("cd", "c", "d"), edge("re", "root", "e")]),
    );
    let after = graph(json!([entity("root"), claim("m", &["b", "c"])]), json!([edge("rb", "root", "m")]));
    let comparison = compare(&before, &after, &json!({})).unwrap();
    let steps: Vec<_> = comparison["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| (step["kind"].as_str().unwrap().to_owned(), step["changes"].clone()))
        .collect();
    assert_eq!(
        steps,
        [
            ("remove".to_owned(), json!(["d", "cd"])),
            ("remove".to_owned(), json!(["e", "re"])),
            ("restructure".to_owned(), json!(["m", "rb"])),
        ]
    );
}
