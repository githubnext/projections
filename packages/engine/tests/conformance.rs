use projections_engine::handle;
use serde_json::{Value, json};

fn state(schema: &str, entities: Value, relationships: Value) -> Value {
    json!({"protocolVersion": 0, "schema": schema, "entities": entities, "relationships": relationships})
}
fn node(id: &str) -> Value {
    json!({"id": id, "kind": "entity", "label": id})
}
fn call(operation: &str, value: Value) -> Value {
    handle(
        serde_json::to_string(&json!({"version": 0, "operation": operation, "extraction": value}))
            .unwrap()
            .as_bytes(),
    )
}
fn error(response: &Value, code: &str, path: &str) {
    assert_eq!(response["ok"], false, "{response}");
    assert_eq!(response["diagnostics"][0]["code"], code, "{response}");
    assert_eq!(response["diagnostics"][0]["path"], path, "{response}");
}

#[test]
fn shared_protocol_corpus() {
    let corpus: Value = serde_json::from_str(include_str!("../../schemas/fixtures/conformance.json")).unwrap();
    for case in corpus["cases"].as_array().unwrap() {
        let response = handle(serde_json::to_string(&case["request"]).unwrap().as_bytes());
        if let Some(code) = case.get("expectError") {
            assert_eq!(response["ok"], false, "{}", case["id"]);
            assert_eq!(&response["diagnostics"][0]["code"], code, "{}", case["id"]);
            if let Some(path) = case.get("expectedErrorPath") {
                assert_eq!(&response["diagnostics"][0]["path"], path, "{}", case["id"]);
            }
        } else {
            assert_eq!(response["ok"], true, "{}: {response}", case["id"]);
            if let Some(expected) = case.get("expectedCanonical") {
                assert_eq!(&response["result"]["canonical"], expected, "{}", case["id"]);
            }
            if let Some(expected) = case.get("expectedResult") {
                assert_eq!(&response["result"], expected, "{}", case["id"]);
            }
        }
    }
}

#[test]
fn canonical_utf16_order_and_ecmascript_numbers() {
    let mut a = node("\u{e000}");
    a["data"] = json!({"\u{e000}": 1, "\u{1f600}": -0.0, "tiny": 1e-7, "fixed": 0.000001, "decimal": 333_333_333.333_333_3});
    let response = call("canonicalize", state("graph/v0", json!([a, node("\u{1f600}")]), json!([])));
    let canonical = response["result"]["canonical"].as_str().unwrap();
    assert!(canonical.find("\"id\":\"😀\"").unwrap() < canonical.find("\"id\":\"\u{e000}\"").unwrap());
    assert!(canonical.contains("\"😀\":0,\"\u{e000}\":1"));
    assert!(canonical.contains("\"tiny\":1e-7"));
    assert!(canonical.contains("\"fixed\":0.000001"));
    assert!(canonical.contains("\"decimal\":333333333.3333333"));
}

#[test]
fn semantic_hash_ignores_evidence_metadata_previous_and_reordering() {
    let original = state("graph/v0", json!([node("b"), node("a")]), json!([]));
    let mut modified = original.clone();
    modified["entities"].as_array_mut().unwrap().reverse();
    modified["entities"][0]["data"] = json!({});
    modified["entities"][0]["previousIds"] = json!(["historic"]);
    modified["entities"][0]["evidence"] = json!([{"kind": "source", "source": "a.rs", "location": {"line": 1}}]);
    modified["metadata"] = json!({"run": "different"});
    assert_eq!(
        call("canonicalize", original)["result"],
        call("canonicalize", modified.clone())["result"]
    );
    assert_eq!(
        call("normalize", modified)["result"]["entities"][0]["evidence"][0]["source"],
        "a.rs"
    );
}

#[test]
fn raw_json_rejects_duplicate_unsafe_unicode_trailing_and_nonfinite() {
    for (raw, code, path) in [
        (r#"{"a":{"x":1,"x":2}}"#, "duplicate-key", "/a/x"),
        (r#"{"a/b~c":{"x":1,"x":2}}"#, "duplicate-key", "/a~1b~0c/x"),
        (r#"{"x":9007199254740993}"#, "unsafe-integer", "/x"),
        (r#"{"x":-9007199254740992}"#, "unsafe-integer", "/x"),
        (r#"{"x":9.007199254740992e15}"#, "unsafe-integer", "/x"),
        (r#"{"x":"\ud800"}"#, "invalid-json", "/x"),
        (r#"{"x":1e400}"#, "invalid-json", "/x"),
        ("{} {}", "invalid-json", ""),
    ] {
        let response = handle(
            serde_json::to_string(&json!({"version":0,"operation":"decode","json":raw}))
                .unwrap()
                .as_bytes(),
        );
        error(&response, code, path);
    }
    error(&handle(&[0xff]), "invalid-unicode", "");
}

#[test]
fn strict_fields_versions_and_identity() {
    let mut value = state("graph/v0", json!([node("a")]), json!([]));
    value["entities"][0]["surprise"] = json!(true);
    error(&call("normalize", value), "unknown-field", "/extraction/entities/0/surprise");
    for version in [1, 2] {
        let mut value = state("graph/v0", json!([node("a")]), json!([]));
        value["protocolVersion"] = json!(version);
        error(&call("normalize", value), "unsupported-version", "/extraction/protocolVersion");
    }
    error(
        &call(
            "normalize",
            json!({"protocolVersion": 0, "schema": "graph/v0", "entities": [], "relationships": [], "nodes": []}),
        ),
        "unknown-field",
        "/extraction/nodes",
    );
    error(
        &call("normalize", state("custom/v0", json!([]), json!([]))),
        "unsupported-schema",
        "/extraction/schema",
    );
    error(
        &call("normalize", state("graph/v0", json!([node("a"), node("a")]), json!([]))),
        "duplicate-id",
        "/extraction/entities/1/id",
    );
    let mut value = state("graph/v0", json!([node("a"), node("b")]), json!([]));
    value["entities"][1]["previousIds"] = json!(["a"]);
    error(
        &call("normalize", value),
        "ambiguous-identity",
        "/extraction/entities/1/previousIds/0",
    );
    // Several entities may claim one previous ID (a split), but not across collections.
    let mut value = state("graph/v0", json!([node("a"), node("b")]), json!([]));
    value["entities"][0]["previousIds"] = json!(["old"]);
    value["entities"][1]["previousIds"] = json!(["old"]);
    assert_eq!(call("normalize", value.clone())["ok"], true);
    value["relationships"] = json!([{"id":"r","kind":"uses","from":"a","to":"b","previousIds":["old"]}]);
    error(
        &call("normalize", value),
        "ambiguous-identity",
        "/extraction/relationships/0/previousIds/0",
    );
    for operation in ["future", "compare"] {
        error(
            &handle(format!(r#"{{"version":0,"operation":"{operation}"}}"#).as_bytes()),
            "unsupported-operation",
            "/operation",
        );
    }
    error(
        &handle(br#"{"version":1,"operation":"normalize"}"#),
        "unsupported-version",
        "/version",
    );
}

#[test]
fn graph_and_architecture_allow_cycles_but_forests_and_dags_do_not() {
    let nodes = json!([node("a"), node("b")]);
    let edges = json!([
        {"id":"ab","kind":"edge","from":"a","to":"b"},
        {"id":"ba","kind":"edge","from":"b","to":"a"}
    ]);
    for schema in ["graph/v0", "architecture/v0"] {
        assert_eq!(call("normalize", state(schema, nodes.clone(), edges.clone()))["ok"], true);
    }
    for schema in ["dag/v0", "treemap/v0"] {
        error(
            &call("normalize", state(schema, nodes.clone(), edges.clone())),
            "cycle",
            "/extraction/relationships",
        );
    }
}

#[test]
fn forest_parent_count_and_dag_parallel_edges() {
    let nodes = json!([node("a"), node("b")]);
    let edges = json!([
        {"id":"one","kind":"edge","from":"a","to":"b"},
        {"id":"two","kind":"edge","from":"a","to":"b"}
    ]);
    let weighted = json!([
        {"id":"a","kind":"entity","label":"a","data":{"value":1}},
        {"id":"b","kind":"entity","label":"b","data":{"value":1}}
    ]);
    error(
        &call("normalize", state("treemap/v0", weighted, edges.clone())),
        "multiple-parents",
        "/extraction/relationships/1",
    );
    assert_eq!(call("normalize", state("dag/v0", nodes, edges))["ok"], true);
}

#[test]
fn domain_requirements_for_all_standard_irs() {
    for (schema, kind, data, valid) in [
        ("metrics/v0", "metric", json!({"value": -1, "unit": ""}), true),
        ("metrics/v0", "metric", json!({"value": "1"}), false),
        ("metrics/v0", "metric", json!({"value": 1, "unit": 1}), false),
        ("treemap/v0", "leaf", json!({"value": 0}), true),
        ("treemap/v0", "leaf", json!({"value": -1}), false),
        ("api/v0", "function", json!({"signature": "() => void"}), true),
        ("api/v0", "function", json!({}), false),
        ("api/v0", "module", json!({}), true),
        ("database/v0", "column", json!({"type": "text", "nullable": true}), true),
        ("database/v0", "column", json!({"type": "", "nullable": true}), false),
        ("database/v0", "column", json!({"type": "text", "nullable": "true"}), false),
    ] {
        let nodes = json!([{"id":"a","kind":kind,"label":"","data":data}]);
        assert_eq!(call("normalize", state(schema, nodes, json!([])))["ok"], valid, "{schema}: {kind}");
    }
    let nodes = json!([
        {"id":"parent","kind":"group","label":"Group","data":{"value":100}},
        {"id":"leaf","kind":"item","label":"Leaf","data":{"value":1}}
    ]);
    let result = call(
        "normalize",
        state("treemap/v0", nodes, json!([{"id":"e","kind":"parent","from":"parent","to":"leaf"}])),
    );
    assert_eq!(result["result"]["entities"][1]["data"]["value"], 100);
}

#[test]
fn entity_and_relationship_limits_and_depth_bound() {
    let nodes: Vec<_> = (0..10_001).map(|id| node(&id.to_string())).collect();
    error(
        &call("normalize", state("graph/v0", json!(nodes), json!([]))),
        "entity-limit",
        "/extraction/entities",
    );
    let edges: Vec<_> = (0..50_001)
        .map(|id| json!({"id":format!("e{id}"),"kind":"e","from":"n","to":"n"}))
        .collect();
    error(
        &call("normalize", state("graph/v0", json!([node("n")]), json!(edges))),
        "entity-limit",
        "/extraction/relationships",
    );
    let mut data = json!(0);
    for _ in 0..50 {
        data = json!({"nested": data});
    }

    let mut value = state("graph/v0", json!([node("a")]), json!([]));
    value["entities"][0]["data"] = data;
    let response = call("normalize", value);
    assert_eq!(response["diagnostics"][0]["code"], "depth-limit");
}

#[test]
fn strict_generic_json_for_artifact_envelopes() {
    let response = handle(
        br#"{"version":0,"operation":"parse-json","json":"{\"format\":\"projections.extraction\",\"nested\":[null,true,-0,1e-7]}"}"#,
    );
    assert_eq!(
        response["result"],
        json!({"format":"projections.extraction","nested":[null,true,0.0,1e-7]})
    );
    for (json, code) in [
        (r#"{"manifest":{"revision":"one","revision":"two"}}"#, "duplicate-key"),
        (r#"{"repositoryId":9007199254740993}"#, "unsafe-integer"),
        (r#"{"title":"\udfff"}"#, "invalid-json"),
    ] {
        let response = handle(
            serde_json::to_string(&json!({"version":0,"operation":"parse-json","json":json}))
                .unwrap()
                .as_bytes(),
        );
        assert_eq!(response["ok"], false);
        assert_eq!(response["diagnostics"][0]["code"], code);
    }
}

fn validate(before: &Value, after: &Value, comparison: Value) -> Value {
    handle(
        serde_json::to_string(&json!({"version": 0, "operation": "validate-comparison",
            "before": before, "after": after, "comparison": comparison}))
        .unwrap()
        .as_bytes(),
    )
}

fn change(id: &str, collection: &str, before: &[&str], after: &[&str], status: &str, correspondence: &str) -> Value {
    json!({"id": id, "collection": collection, "before": before, "after": after,
        "status": status, "correspondence": correspondence})
}

fn comparison(changes: Vec<Value>) -> Value {
    let steps: Vec<_> = changes.iter().map(|change| json!({"changes": [change["id"]]})).collect();
    json!({"protocolVersion": 0, "changes": changes, "steps": steps})
}

#[test]
fn comparisons_must_reference_existing_items_once() {
    let before = state("graph/v0", json!([node("a"), node("b")]), json!([]));
    let after = state("graph/v0", json!([node("a")]), json!([]));
    let removed = change("b", "entities", &["b"], &[], "removed", "none");
    assert_eq!(validate(&before, &after, comparison(vec![removed.clone()]))["ok"], true);
    error(
        &validate(
            &before,
            &after,
            comparison(vec![change("c", "entities", &["c"], &[], "removed", "none")]),
        ),
        "unknown-reference",
        "/comparison/changes/0/before/0",
    );
    error(
        &validate(
            &before,
            &after,
            comparison(vec![change("b", "relationships", &["b"], &[], "removed", "none")]),
        ),
        "unknown-reference",
        "/comparison/changes/0/before/0",
    );
    let mut twice = removed.clone();
    twice["id"] = json!("again");
    error(
        &validate(&before, &after, comparison(vec![removed.clone(), twice])),
        "duplicate-reference",
        "/comparison/changes/1/before/0",
    );
    error(
        &validate(&before, &after, comparison(vec![removed.clone(), removed.clone()])),
        "duplicate-change",
        "/comparison/changes/1/id",
    );
    let mut unknown = comparison(vec![removed.clone()]);
    unknown["changes"][0]["position"] = json!({"x": 1});
    error(
        &validate(&before, &after, unknown),
        "unknown-field",
        "/comparison/changes/0/position",
    );
    let mut v1 = comparison(vec![removed]);
    v1["protocolVersion"] = json!(1);
    error(&validate(&before, &after, v1), "unsupported-version", "/comparison/protocolVersion");
}

#[test]
fn change_shapes_follow_status_and_correspondence() {
    let before = state("graph/v0", json!([node("a"), node("b")]), json!([]));
    let after = state("graph/v0", json!([node("c"), node("d")]), json!([]));
    for invalid in [
        change("c", "entities", &["a"], &["c"], "added", "none"),
        change("c", "entities", &["a"], &["c"], "modified", "exact"),
        change("c", "entities", &["a"], &["c", "d"], "modified", "declared"),
        change("c", "entities", &["a", "b"], &["c", "d"], "modified", "merge"),
        change("c", "entities", &["a"], &["c"], "added", "declared"),
    ] {
        error(
            &validate(&before, &after, comparison(vec![invalid])),
            "invalid-change-shape",
            "/comparison/changes/0",
        );
    }
    let merge = change("c", "entities", &["a", "b"], &["c"], "modified", "merge");
    let added = change("d", "entities", &[], &["d"], "added", "none");
    assert_eq!(
        validate(&before, &after, comparison(vec![merge.clone(), added.clone()]))["ok"],
        true
    );
    let split = change("c", "entities", &["a"], &["c", "d"], "unchanged", "split");
    let removed = change("b", "entities", &["b"], &[], "removed", "none");
    assert_eq!(validate(&before, &after, comparison(vec![split, removed]))["ok"], true);
}

#[test]
fn a_comparator_cannot_hide_or_misstate_a_change() {
    let before = state(
        "graph/v0",
        json!([node("old"), node("stable")]),
        json!([{"id":"e","kind":"uses","from":"old","to":"stable"}]),
    );
    let after = state(
        "graph/v0",
        json!([node("new"), node("stable")]),
        json!([{"id":"e","kind":"uses","from":"new","to":"stable"}]),
    );
    let mut renamed = change("new", "entities", &["old"], &["new"], "modified", "declared");
    // The relationship is unchanged through the declared endpoint correspondence.
    assert_eq!(validate(&before, &after, comparison(vec![renamed.clone()]))["ok"], true);
    renamed["status"] = json!("unchanged");
    error(
        &validate(&before, &after, comparison(vec![renamed.clone()])),
        "inconsistent-status",
        "/comparison/changes/0/status",
    );
    // Without the entity correspondence, the relationship content differs.
    let removed = change("old", "entities", &["old"], &[], "removed", "none");
    let added = change("new", "entities", &[], &["new"], "added", "none");
    error(
        &validate(&before, &after, comparison(vec![removed.clone(), added.clone()])),
        "hidden-change",
        "/comparison/changes",
    );
    let relationship = change("e", "relationships", &["e"], &["e"], "modified", "exact");
    assert_eq!(
        validate(&before, &after, comparison(vec![removed, added, relationship.clone()]))["ok"],
        true
    );
    error(
        &validate(&before, &after, comparison(vec![])),
        "hidden-change",
        "/comparison/changes",
    );
    error(
        &validate(&before, &state("dag/v0", json!([]), json!([])), comparison(vec![])),
        "schema-mismatch",
        "/after/schema",
    );
}

#[test]
fn steps_cover_every_change_once_and_reverse_order_is_explicit_or_mirrored() {
    let before = state("graph/v0", json!([]), json!([]));
    let after = state("graph/v0", json!([node("a"), node("b")]), json!([]));
    let changes = vec![
        change("a", "entities", &[], &["a"], "added", "none"),
        change("b", "entities", &[], &["b"], "added", "none"),
    ];
    let mut value = comparison(changes.clone());
    value["steps"] = json!([{"changes": ["a", "b"], "kind": "add", "summary": "Both"}]);
    assert_eq!(validate(&before, &after, value.clone())["ok"], true);
    for (steps, code, path) in [
        (json!([{"changes": ["a"]}]), "step-coverage", "/comparison/steps"),
        (
            json!([{"changes": ["a", "b"]}, {"changes": ["a"]}]),
            "step-coverage",
            "/comparison/steps/1/changes/0",
        ),
        (
            json!([{"changes": ["a", "b", "c"]}]),
            "unknown-change",
            "/comparison/steps/0/changes/2",
        ),
        (
            json!([{"changes": ["a", "b"]}, {"changes": []}]),
            "empty-step",
            "/comparison/steps/1/changes",
        ),
        (
            json!([{"changes": ["a", "b"], "kind": "move"}]),
            "invalid-step",
            "/comparison/steps/0/kind",
        ),
        (
            json!([{"changes": ["a", "b"], "time": 0.5}]),
            "unknown-field",
            "/comparison/steps/0/time",
        ),
    ] {
        let mut invalid = value.clone();
        invalid["steps"] = steps;
        error(&validate(&before, &after, invalid), code, path);
    }
    let mut explicit = value.clone();
    explicit["order"] = json!({"reverse": "explicit"});
    error(
        &validate(&before, &after, explicit.clone()),
        "missing-reverse-steps",
        "/comparison/reverseSteps",
    );
    explicit["reverseSteps"] = json!([{"changes": ["b"]}, {"changes": ["a"]}]);
    assert_eq!(validate(&before, &after, explicit.clone())["ok"], true);
    explicit["reverseSteps"] = json!([{"changes": ["b"]}]);
    error(&validate(&before, &after, explicit), "step-coverage", "/comparison/reverseSteps");
    let mut mirror = value;
    mirror["order"] = json!({"reverse": "mirror"});
    mirror["reverseSteps"] = json!([{"changes": ["a", "b"]}]);
    error(
        &validate(&before, &after, mirror),
        "unexpected-reverse-steps",
        "/comparison/reverseSteps",
    );
}
