use projections_comparator_default::{call, compare};
use projections_engine::{Failure, normalize, validate_comparison};
use serde_json::{Value, json};

fn extraction(schema: &str, entities: Value, relationships: Value) -> Value {
    json!({"protocolVersion": 0, "schema": schema, "entities": entities, "relationships": relationships})
}

fn entity(id: &str) -> Value {
    json!({"id": id, "kind": "entity", "label": id})
}

fn claim(id: &str, previous: &[&str]) -> Value {
    let mut value = entity(id);
    value["previousIds"] = json!(previous);
    value
}

fn run(before: &Value, after: &Value) -> Result<Value, Failure> {
    compare(before, after, &json!({}))
}

fn change<'a>(comparison: &'a Value, id: &str) -> &'a Value {
    comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|change| change["id"] == id)
        .unwrap_or_else(|| panic!("no change {id} in {comparison}"))
}

fn error(result: Result<Value, Failure>, code: &str, path: &str) {
    let failure = result.expect_err("expected a comparator error");
    assert_eq!(failure[0].code, code, "{failure:?}");
    assert_eq!(failure[0].path, path, "{failure:?}");
}

#[test]
fn shared_comparator_corpus() {
    let corpus: Value = serde_json::from_str(include_str!("../../../schemas/fixtures/conformance.json")).unwrap();
    for case in corpus["comparisons"].as_array().unwrap() {
        let result = compare(&case["before"], &case["after"], case.get("options").unwrap_or(&json!({})));
        if let Some(code) = case.get("expectError") {
            assert_eq!(result.expect_err(case["id"].as_str().unwrap())[0].code, *code, "{}", case["id"]);
        } else {
            assert_eq!(
                result.unwrap_or_else(|failure| panic!("{}: {failure:?}", case["id"])),
                case["expected"],
                "{}",
                case["id"]
            );
        }
    }
}

#[test]
fn exact_ids_match_and_unchanged_items_are_not_changes() {
    let before = extraction("graph/v0", json!([entity("a"), entity("b")]), json!([]));
    let mut modified = entity("b");
    modified["label"] = json!("changed");
    let after = extraction("graph/v0", json!([entity("a"), modified]), json!([]));
    let comparison = run(&before, &after).unwrap();
    assert_eq!(
        comparison["changes"],
        json!([{"id": "b", "collection": "entities", "before": ["b"], "after": ["b"],
            "status": "modified", "correspondence": "exact"}])
    );
    assert_eq!(comparison["steps"], json!([{"changes": ["b"], "kind": "restructure"}]));
    let same = run(&before, &before).unwrap();
    assert_eq!(same["changes"], json!([]));
    assert_eq!(same["steps"], json!([]));
}

#[test]
fn evidence_and_metadata_never_make_a_change() {
    let before = extraction("graph/v0", json!([entity("a")]), json!([]));
    let mut after = before.clone();
    after["entities"][0]["evidence"] = json!([{"kind": "source", "source": "a.rs"}]);
    after["metadata"] = json!({"run": 2});
    assert_eq!(run(&before, &after).unwrap()["changes"], json!([]));
}

#[test]
fn simultaneous_rename_modification_and_edge_endpoint_correspondence_reverse() {
    let before = extraction(
        "graph/v0",
        json!([entity("old"), entity("stable")]),
        json!([{"id":"e","kind":"uses","from":"old","to":"stable"}]),
    );
    let mut renamed = claim("new", &["old"]);
    renamed["label"] = json!("changed");
    let after = extraction(
        "graph/v0",
        json!([renamed, entity("stable")]),
        json!([{"id":"f","previousIds":["e"],"kind":"uses","from":"new","to":"stable"}]),
    );
    for (before, after, entity_change, relationship_change) in [
        (before.clone(), after.clone(), ("old", "new"), ("e", "f")),
        (after, before, ("new", "old"), ("f", "e")),
    ] {
        let comparison = run(&before, &after).unwrap();
        assert_eq!(comparison["changes"].as_array().unwrap().len(), 2, "{comparison}");
        let renamed = change(&comparison, entity_change.1);
        assert_eq!(renamed["before"], json!([entity_change.0]));
        assert_eq!(renamed["status"], "modified");
        assert_eq!(renamed["correspondence"], "declared");
        // The relationship's endpoint was renamed, which alone is not a content change.
        let relationship = change(&comparison, relationship_change.1);
        assert_eq!(relationship["collection"], "relationships");
        assert_eq!(relationship["before"], json!([relationship_change.0]));
        assert_eq!(relationship["status"], "unchanged");
        assert_eq!(relationship["correspondence"], "declared");
    }
}

#[test]
fn an_exact_relationship_whose_endpoint_was_renamed_is_unchanged() {
    let before = extraction(
        "graph/v0",
        json!([entity("old"), entity("stable")]),
        json!([{"id":"e","kind":"uses","from":"old","to":"stable"}]),
    );
    let mut renamed = claim("new", &["old"]);
    renamed["label"] = json!("old");
    let after = extraction(
        "graph/v0",
        json!([renamed, entity("stable")]),
        json!([{"id":"e","kind":"uses","from":"new","to":"stable"}]),
    );
    let comparison = run(&before, &after).unwrap();
    assert_eq!(comparison["changes"].as_array().unwrap().len(), 1, "{comparison}");
    assert_eq!(change(&comparison, "new")["status"], "unchanged");
}

#[test]
fn ambiguous_many_to_many_claims_are_errors() {
    let before = extraction("graph/v0", json!([entity("a"), entity("b")]), json!([]));
    let after = extraction("graph/v0", json!([claim("x", &["a", "b"]), claim("y", &["b"])]), json!([]));
    for (before, after) in [(before.clone(), after.clone()), (after, before)] {
        error(run(&before, &after), "ambiguous-correspondence", "/after/entities");
    }
}

#[test]
fn explicit_merges_and_splits_are_recognized_in_both_directions() {
    let before = extraction("graph/v0", json!([entity("a"), entity("b"), entity("root")]), json!([]));
    let after = extraction("graph/v0", json!([claim("ab", &["a", "b"]), entity("root")]), json!([]));
    let merge = run(&before, &after).unwrap();
    assert_eq!(
        merge["changes"],
        json!([{"id": "ab", "collection": "entities", "before": ["a", "b"], "after": ["ab"],
            "status": "modified", "correspondence": "merge"}])
    );
    let split = run(&after, &before).unwrap();
    assert_eq!(
        split["changes"],
        json!([{"id": "a", "collection": "entities", "before": ["ab"], "after": ["a", "b"],
            "status": "modified", "correspondence": "split"}])
    );
    // A split declared from the after side: several items claim one previous ID.
    let billing = extraction("graph/v0", json!([entity("billing")]), json!([]));
    let split = extraction(
        "graph/v0",
        json!([claim("invoicing", &["billing"]), claim("payments", &["billing"])]),
        json!([]),
    );
    let comparison = run(&billing, &split).unwrap();
    assert_eq!(change(&comparison, "invoicing")["correspondence"], "split");
    assert_eq!(change(&comparison, "invoicing")["after"], json!(["invoicing", "payments"]));
    assert_eq!(change(&run(&split, &billing).unwrap(), "billing")["correspondence"], "merge");
}

#[test]
fn exact_ids_take_precedence_over_historical_claims() {
    let before = extraction("graph/v0", json!([entity("a"), entity("old")]), json!([]));
    let after = extraction("graph/v0", json!([claim("a", &["old"])]), json!([]));
    let comparison = run(&before, &after).unwrap();
    assert_eq!(
        comparison["changes"],
        json!([{"id": "old", "collection": "entities", "before": ["old"], "after": [],
            "status": "removed", "correspondence": "none"}])
    );
}

#[test]
fn comparisons_across_domain_schemas_are_rejected() {
    let before = extraction("graph/v0", json!([]), json!([]));
    let after = extraction("dag/v0", json!([]), json!([]));
    error(run(&before, &after), "schema-mismatch", "/after/schema");
}

#[test]
fn invalid_extractions_and_options_are_rejected() {
    let valid = extraction("graph/v0", json!([]), json!([]));
    let mut invalid = valid.clone();
    invalid["nodes"] = json!([]);
    error(run(&invalid, &valid), "unknown-field", "/before/nodes");
    error(run(&valid, &invalid), "unknown-field", "/after/nodes");
    for (options, path) in [
        (json!({"surprise": true}), "/options/surprise"),
        (json!({"order": {"by": "size"}}), "/options/order/by"),
        (json!({"order": {"by": "data."}}), "/options/order/by"),
        (
            json!({"order": {"by": "dependents", "direction": "up"}}),
            "/options/order/direction",
        ),
    ] {
        error(compare(&valid, &valid, &options), "invalid-options", path);
    }
}

#[test]
fn every_result_validates_and_every_change_is_in_exactly_one_step() {
    let before = extraction(
        "graph/v0",
        json!([entity("root"), entity("gone"), claim("billing", &[])]),
        json!([
            {"id": "root-gone", "kind": "uses", "from": "root", "to": "gone"},
            {"id": "root-billing", "kind": "uses", "from": "root", "to": "billing"}
        ]),
    );
    let after = extraction(
        "graph/v0",
        json!([
            entity("root"),
            entity("fresh"),
            claim("invoicing", &["billing"]),
            claim("payments", &["billing"])
        ]),
        json!([
            {"id": "root-fresh", "kind": "uses", "from": "root", "to": "fresh"},
            {"id": "root-billing", "kind": "uses", "from": "root", "to": "invoicing"},
            {"id": "fresh-payments", "kind": "uses", "from": "fresh", "to": "payments"}
        ]),
    );
    for (before, after) in [(before.clone(), after.clone()), (after, before)] {
        let comparison = run(&before, &after).unwrap();
        validate_comparison(
            &normalize(&before, "/before").unwrap(),
            &normalize(&after, "/after").unwrap(),
            &comparison,
        )
        .unwrap();
        let mut members: Vec<_> = comparison["steps"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|step| step["changes"].as_array().unwrap().clone())
            .collect();
        let count = members.len();
        members.sort_by_key(|id| id.as_str().unwrap().to_owned());
        members.dedup();
        assert_eq!(members.len(), count);
        assert_eq!(count, comparison["changes"].as_array().unwrap().len());
    }
}

#[test]
fn removed_entity_and_added_relationship_sharing_an_id_get_unique_change_ids() {
    let before = extraction("graph/v0", json!([entity("a"), entity("x")]), json!([]));
    let after = extraction(
        "graph/v0",
        json!([entity("a")]),
        json!([{"id": "x", "kind": "self", "from": "a", "to": "a"}]),
    );
    let comparison = run(&before, &after).unwrap();
    let ids: Vec<_> = comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| change["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["x", "x~1"]);
}

fn ranked() -> (Value, Value) {
    // Three independent additions with different numbers of dependents.
    let before = extraction("graph/v0", json!([entity("app"), entity("lib"), entity("tool")]), json!([]));
    let mut entities = vec![entity("app"), entity("lib"), entity("tool")];
    let mut relationships = Vec::new();
    for (id, users, size) in [("p1", 0, 5), ("p2", 2, 1), ("p3", 1, 9)] {
        let mut item = entity(id);
        item["data"] = json!({"size": size});
        entities.push(item);
        for user in ["app", "lib"].iter().take(users) {
            relationships.push(json!({"id": format!("{user}-{id}"), "kind": "uses", "from": user, "to": id}));
        }
    }
    // A chain puts each addition in its own layer so steps can be reordered.
    for (from, to) in [("p1", "p2"), ("p2", "p3")] {
        let mut chain = json!({"id": format!("{from}-{to}"), "kind": "next", "from": from, "to": to});
        chain["data"] = json!({});
        relationships.push(chain);
    }
    (before, extraction("graph/v0", json!(entities), json!(relationships)))
}

fn entity_steps(comparison: &Value) -> Vec<Vec<String>> {
    comparison["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| {
            step["changes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap().to_owned())
                .filter(|id| id.starts_with('p') && !id.contains('-'))
                .collect()
        })
        .collect()
}

#[test]
fn order_by_dependents_and_numeric_data_sorts_steps_stably() {
    let (before, after) = ranked();
    let default = compare(&before, &after, &json!({})).unwrap();
    // A connected chain is one coherent group, so additions form one step here.
    assert_eq!(entity_steps(&default), vec![vec!["p1", "p2", "p3"]]);
    let mut separate = after.clone();
    separate["relationships"] = json!(
        separate["relationships"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|relationship| relationship["kind"] != "next")
            .cloned()
            .collect::<Vec<_>>()
    );
    // Peers at the same depth change together; depth separates the others.
    let peers = compare(&before, &separate, &json!({})).unwrap();
    assert_eq!(entity_steps(&peers), vec![vec!["p1"], vec!["p2", "p3"]]);
    let descending = compare(&before, &separate, &json!({"order": {"by": "dependents"}})).unwrap();
    assert_eq!(entity_steps(&descending), vec![vec!["p2", "p3"], vec!["p1"]]);
    let ascending = compare(
        &before,
        &separate,
        &json!({"order": {"by": "dependents", "direction": "ascending"}}),
    )
    .unwrap();
    assert_eq!(entity_steps(&ascending), vec![vec!["p1"], vec!["p2", "p3"]]);
    let by_size = compare(
        &before,
        &separate,
        &json!({"order": {"by": "data.size", "direction": "descending"}}),
    )
    .unwrap();
    assert_eq!(entity_steps(&by_size), vec![vec!["p2", "p3"], vec!["p1"]]);
    let by_missing = compare(&before, &separate, &json!({"order": {"by": "data.absent"}})).unwrap();
    assert_eq!(entity_steps(&by_missing), entity_steps(&peers));
    // Removals use dependents in the before extraction.
    let removals = compare(&separate, &before, &json!({"order": {"by": "dependents"}})).unwrap();
    assert_eq!(entity_steps(&removals), vec![vec!["p2", "p3"], vec!["p1"]]);
}

fn module(input: Value) -> Value {
    serde_json::from_slice(&call(serde_json::to_string(&input).unwrap().as_bytes())).unwrap()
}

#[test]
fn module_call_returns_a_comparison_or_an_explicit_error() {
    let before = extraction("graph/v0", json!([entity("a")]), json!([]));
    let after = extraction("graph/v0", json!([entity("b")]), json!([]));
    let baseline = run(&before, &after).unwrap();
    assert_eq!(
        module(json!({"protocolVersion": 0, "before": before, "after": after, "baseline": baseline, "options": {}})),
        baseline
    );
    assert_eq!(module(json!({"protocolVersion": 0, "before": before, "after": after})), baseline);
    for (input, message) in [
        (
            json!({"protocolVersion": 1, "before": before, "after": after}),
            "unsupported-version",
        ),
        (
            json!({"protocolVersion": 0, "before": before, "after": after, "extra": 1}),
            "unknown-field",
        ),
        (
            json!({"protocolVersion": 0, "before": before, "after": {"protocolVersion": 0}}),
            "/after",
        ),
        (
            json!({"protocolVersion": 0, "before": before, "after": after, "options": {"order": 1}}),
            "invalid-options",
        ),
    ] {
        let output = module(input);
        let error = output["error"].as_str().unwrap_or_else(|| panic!("{output}"));
        assert!(error.contains(message), "{error}");
        assert_eq!(output.as_object().unwrap().len(), 1);
    }
    let output: Value = serde_json::from_slice(&call(br#"{"a":1,"a":2}"#)).unwrap();
    assert!(output["error"].as_str().unwrap().contains("duplicate-key"));
    let output: Value = serde_json::from_slice(&call(&[0xff])).unwrap();
    assert!(output["error"].as_str().unwrap().contains("invalid-unicode"));
}
