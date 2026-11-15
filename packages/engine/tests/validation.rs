//! Extraction validation and normalization: every rule, its diagnostic and its
//! boundary.

use projections_engine::{MAX_ENTITIES, MAX_EXTRACTION_BYTES, MAX_RELATIONSHIPS, SCHEMAS, normalize};
use serde_json::{Value, json};

fn node(id: &str) -> Value {
    json!({"id": id, "kind": "entity", "label": id})
}

fn edge(id: &str, from: &str, to: &str) -> Value {
    json!({"id": id, "kind": "edge", "from": from, "to": to})
}

fn state(schema: &str, entities: Value, relationships: Value) -> Value {
    json!({"protocolVersion": 0, "schema": schema, "entities": entities, "relationships": relationships})
}

fn graph(entities: Value, relationships: Value) -> Value {
    state("graph/v0", entities, relationships)
}

fn rejects(value: &Value, code: &str, path: &str) -> String {
    let failure = normalize(value, "/x").expect_err(&value.to_string());
    assert_eq!(failure.len(), 1, "{failure:?}");
    assert_eq!(failure[0].code, code, "{failure:?}");
    assert_eq!(failure[0].path, path, "{failure:?}");
    failure[0].message.clone()
}

fn accepts(value: &Value) -> Value {
    normalize(value, "/x").unwrap_or_else(|failure| panic!("{value}: {failure:?}"))
}

/// One entity with `field` set, for entity-level rules.
fn with(field: &str, value: Value) -> Value {
    let mut entity = node("a");
    entity[field] = value;
    graph(json!([entity]), json!([]))
}

#[test]
fn every_standard_schema_is_supported() {
    assert_eq!(SCHEMAS.len(), 7);
    for schema in SCHEMAS {
        let result = accepts(&state(schema, json!([]), json!([])));
        assert_eq!(result["schema"], *schema);
    }
    rejects(&state(" ", json!([]), json!([])), "invalid-type", "/x/schema");
    rejects(&state("graph/v2", json!([]), json!([])), "unsupported-schema", "/x/schema");
}

#[test]
fn the_document_is_a_versioned_object_with_both_collections() {
    rejects(&json!([]), "invalid-type", "/x");
    let mut value = graph(json!([]), json!([]));
    value["protocolVersion"] = json!(0.0);
    assert_eq!(accepts(&value)["protocolVersion"], json!(0.0));
    value["protocolVersion"] = json!("0");
    rejects(&value, "unsupported-version", "/x/protocolVersion");
    for collection in ["entities", "relationships"] {
        let mut value = graph(json!([]), json!([]));
        value.as_object_mut().unwrap().remove(collection);
        rejects(&value, "invalid-type", &format!("/x/{collection}"));
        value[collection] = json!({});
        rejects(&value, "invalid-type", &format!("/x/{collection}"));
    }
}

#[test]
fn normalization_sorts_items_and_identity_claims_and_defaults_data() {
    let mut a = node("a");
    a["previousIds"] = json!(["\u{e000}", "\u{1f600}", "b-old"]);
    let value = graph(
        json!([node("\u{e000}x"), node("\u{1f600}x"), a]),
        json!([edge("r2", "a", "a"), edge("r1", "a", "a")]),
    );
    let result = accepts(&value);
    let ids = |collection: &str| -> Vec<&str> {
        result[collection]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["id"].as_str().unwrap())
            .collect()
    };
    assert_eq!(ids("entities"), ["a", "\u{1f600}x", "\u{e000}x"]);
    assert_eq!(ids("relationships"), ["r1", "r2"]);
    assert_eq!(result["entities"][0]["previousIds"], json!(["b-old", "\u{1f600}", "\u{e000}"]));
    for item in result["entities"].as_array().unwrap() {
        assert_eq!(item["data"], json!({}));
    }
    assert_eq!(result["relationships"][0]["data"], json!({}));
    assert!(result.get("metadata").is_none());
    let mut value = graph(json!([]), json!([]));
    value["metadata"] = json!({"run": 1});
    assert_eq!(accepts(&value)["metadata"], json!({"run": 1}));
    value["metadata"] = json!([]);
    rejects(&value, "invalid-type", "/x/metadata");
    // Existing data is preserved.
    assert_eq!(accepts(&with("data", json!({"k": 1})))["entities"][0]["data"], json!({"k": 1}));
}

#[test]
fn missing_inputs_are_distinct_paths_sorted_and_part_of_the_digest() {
    let mut value = graph(json!([]), json!([]));
    value["missingInputs"] = json!(["b/schema.prisma", "a/*.yaml"]);
    let result = accepts(&value);
    assert_eq!(result["missingInputs"], json!(["a/*.yaml", "b/schema.prisma"]));
    let empty = accepts(&graph(json!([]), json!([])));
    assert!(empty.get("missingInputs").is_none());
    assert_ne!(
        projections_engine::canonicalize(&result).unwrap().1,
        projections_engine::canonicalize(&empty).unwrap().1
    );
    // An empty list is the same as none.
    value["missingInputs"] = json!([]);
    assert!(accepts(&value).get("missingInputs").is_none());
    value["missingInputs"] = json!(["a", "a"]);
    rejects(&value, "duplicate-missing-input", "/x/missingInputs");
    value["missingInputs"] = json!([" "]);
    rejects(&value, "invalid-type", "/x/missingInputs/0");
    value["missingInputs"] = json!(["a\u{0}"]);
    rejects(&value, "invalid-missing-input", "/x/missingInputs/0");
    value["missingInputs"] = json!("a");
    rejects(&value, "invalid-type", "/x/missingInputs");
    value["missingInputs"] = json!((0..257).map(|n| n.to_string()).collect::<Vec<_>>());
    rejects(&value, "missing-inputs-limit", "/x/missingInputs");
    // The limits are inclusive: 256 inputs, each of up to 1024 characters.
    value["missingInputs"] = json!((0..256).map(|n| n.to_string()).collect::<Vec<_>>());
    assert_eq!(accepts(&value)["missingInputs"].as_array().unwrap().len(), 256);
    value["missingInputs"] = json!(["é".repeat(1024)]);
    assert_eq!(accepts(&value)["missingInputs"][0], json!("é".repeat(1024)));
    value["missingInputs"] = json!(["é".repeat(1025)]);
    rejects(&value, "invalid-missing-input", "/x/missingInputs/0");
}

#[test]
fn entities_require_a_nonempty_id_and_kind_and_a_string_label() {
    for field in ["id", "kind"] {
        for invalid in [json!(""), json!("  "), json!(1), Value::Null] {
            rejects(&with(field, invalid), "invalid-type", &format!("/x/entities/0/{field}"));
        }
    }
    assert_eq!(accepts(&with("label", json!("")))["entities"][0]["label"], "");
    rejects(&with("label", json!(1)), "invalid-type", "/x/entities/0/label");
    let mut entity = node("a");
    entity.as_object_mut().unwrap().remove("label");
    rejects(&graph(json!([entity]), json!([])), "invalid-type", "/x/entities/0/label");
    for relationship_only in ["from", "to"] {
        rejects(
            &with(relationship_only, json!("a")),
            "unknown-field",
            &format!("/x/entities/0/{relationship_only}"),
        );
    }
    rejects(&with("data", json!([])), "invalid-type", "/x/entities/0/data");
}

#[test]
fn relationships_require_endpoints_and_may_omit_or_set_a_label() {
    let nodes = json!([node("a"), node("b")]);
    let mut labelled = edge("r", "a", "b");
    labelled["label"] = json!("uses");
    assert_eq!(
        accepts(&graph(nodes.clone(), json!([labelled])))["relationships"][0]["label"],
        "uses"
    );
    let mut unlabelled = edge("r", "a", "b");
    unlabelled["label"] = json!(1);
    rejects(
        &graph(nodes.clone(), json!([unlabelled])),
        "invalid-type",
        "/x/relationships/0/label",
    );
    for key in ["from", "to"] {
        let mut relationship = edge("r", "a", "b");
        relationship[key] = json!("");
        rejects(
            &graph(nodes.clone(), json!([relationship])),
            "invalid-type",
            &format!("/x/relationships/0/{key}"),
        );
        relationship[key] = json!("missing");
        let message = rejects(
            &graph(nodes.clone(), json!([relationship])),
            "missing-endpoint",
            &format!("/x/relationships/0/{key}"),
        );
        assert_eq!(message, "Relationship endpoint must identify an existing entity");
    }
    // A relationship cannot point at another relationship.
    rejects(
        &graph(nodes, json!([edge("r", "a", "b"), edge("s", "a", "r")])),
        "missing-endpoint",
        "/x/relationships/1/to",
    );
}

#[test]
fn ids_are_unique_across_both_collections() {
    rejects(
        &graph(json!([node("a")]), json!([edge("a", "a", "a")])),
        "duplicate-id",
        "/x/relationships/0/id",
    );
}

#[test]
fn identity_claims_are_unique_unambiguous_strings() {
    rejects(&with("previousIds", json!("old")), "invalid-type", "/x/entities/0/previousIds");
    rejects(&with("previousIds", json!([""])), "invalid-type", "/x/entities/0/previousIds/0");
    let message = rejects(
        &with("previousIds", json!(["old", "old"])),
        "ambiguous-identity",
        "/x/entities/0/previousIds/1",
    );
    assert_eq!(message, "Duplicate previous ID");
    accepts(&with("previousIds", json!([])));
    // A claim may not name a current ID in either collection.
    let mut claimant = node("b");
    claimant["previousIds"] = json!(["old", "r"]);
    rejects(
        &graph(json!([node("a"), claimant]), json!([edge("r", "a", "a")])),
        "ambiguous-identity",
        "/x/entities/1/previousIds/1",
    );
    // Relationships claiming one previous ID declare a split, like entities.
    let mut first = edge("r1", "a", "a");
    first["previousIds"] = json!(["r0"]);
    let mut second = edge("r2", "a", "a");
    second["previousIds"] = json!(["r0"]);
    accepts(&graph(json!([node("a")]), json!([first, second.clone()])));
    // But one previous ID cannot be claimed from both collections.
    let mut entity = node("a");
    entity["previousIds"] = json!(["r0"]);
    rejects(
        &graph(json!([entity]), json!([second])),
        "ambiguous-identity",
        "/x/relationships/0/previousIds/0",
    );
}

#[test]
fn evidence_is_a_list_of_sourced_locations() {
    let evidence = |item: Value| with("evidence", json!([item]));
    accepts(&evidence(json!({"kind": "source", "source": "a.rs"})));
    accepts(&evidence(json!({"kind": "source", "source": "a.rs", "location": {"line": 1}})));
    accepts(&evidence(
        json!({"kind": "source", "source": "a.rs", "location": {"line": 2, "column": 3.0}}),
    ));
    rejects(&with("evidence", json!({})), "invalid-type", "/x/entities/0/evidence");
    rejects(
        &evidence(json!({"kind": "source", "source": "a.rs", "url": "x"})),
        "unknown-field",
        "/x/entities/0/evidence/0/url",
    );
    for key in ["kind", "source"] {
        let mut item = json!({"kind": "source", "source": "a.rs"});
        item[key] = json!(" ");
        rejects(&evidence(item), "invalid-type", &format!("/x/entities/0/evidence/0/{key}"));
    }
    rejects(
        &evidence(json!({"kind": "source", "source": "a.rs", "location": {"line": 1, "offset": 0}})),
        "unknown-field",
        "/x/entities/0/evidence/0/location/offset",
    );
    for (location, key) in [
        (json!({}), "line"),
        (json!({"column": 1}), "line"),
        (json!({"line": 0}), "line"),
        (json!({"line": -1}), "line"),
        (json!({"line": 1.5}), "line"),
        (json!({"line": "1"}), "line"),
        (json!({"line": 1, "column": 0}), "column"),
        (json!({"line": 1, "column": 0.5}), "column"),
        (json!({"line": 1, "column": null}), "column"),
    ] {
        let message = rejects(
            &evidence(json!({"kind": "source", "source": "a.rs", "location": location})),
            "invalid-location",
            &format!("/x/entities/0/evidence/0/location/{key}"),
        );
        assert_eq!(message, "Expected a positive safe integer");
    }
}

#[test]
fn confidence_is_one_of_three_levels() {
    for confidence in ["authoritative", "derived", "inferred"] {
        assert_eq!(
            accepts(&with("confidence", json!(confidence)))["entities"][0]["confidence"],
            confidence
        );
    }
    for invalid in [json!("certain"), json!(1), Value::Null] {
        rejects(&with("confidence", invalid), "invalid-confidence", "/x/entities/0/confidence");
    }
}

/// `data` nested `levels` objects deep under one entity. The entity's data
/// object is at depth 3 below the document root.
fn deep(levels: usize) -> Value {
    let mut data = json!(0);
    for _ in 0..levels {
        data = json!({"k": data});
    }
    with("data", json!({"k": data}))
}

#[test]
fn extraction_nesting_is_bounded_at_50_levels() {
    accepts(&deep(46));
    let path = format!("/x/entities/0/data{}", "/k".repeat(48));
    let message = rejects(&deep(47), "depth-limit", &path);
    assert_eq!(message, "Extraction JSON nesting exceeds 50 levels");
    let mut array = json!(0);
    for _ in 0..47 {
        array = json!([array]);
    }
    rejects(
        &with("data", json!({"k": array})),
        "depth-limit",
        &format!("/x/entities/0/data/k{}", "/0".repeat(47)),
    );
}

/// A graph whose serialized size is exactly `length` bytes, padded by one
/// entity label. With `data`, normalization adds nothing.
fn sized(length: usize, data: bool) -> Value {
    let mut entity = node("a");
    if data {
        entity["data"] = json!({});
    }
    entity["label"] = json!("");
    let mut value = graph(json!([entity]), json!([]));
    let base = serde_json::to_vec(&value).unwrap().len();
    value["entities"][0]["label"] = json!("x".repeat(length - base));
    assert_eq!(serde_json::to_vec(&value).unwrap().len(), length);
    value
}

#[test]
fn extractions_are_bounded_at_8_mib_before_and_after_normalization() {
    accepts(&sized(MAX_EXTRACTION_BYTES, true));
    let message = rejects(&sized(MAX_EXTRACTION_BYTES + 1, true), "extraction-size-limit", "/x");
    assert_eq!(message, "Extraction exceeds 8 MiB");
    // Defaulting `data` adds `,"data":{}`, 10 bytes.
    accepts(&sized(MAX_EXTRACTION_BYTES - 10, false));
    let message = rejects(&sized(MAX_EXTRACTION_BYTES - 9, false), "extraction-size-limit", "/x");
    assert_eq!(message, "Normalized extraction exceeds 8 MiB");
}

#[test]
fn collections_are_bounded_at_their_item_limits() {
    let nodes: Vec<_> = (0..MAX_ENTITIES)
        .map(|id| json!({"id": id.to_string(), "kind": "k", "label": ""}))
        .collect();
    assert_eq!(
        accepts(&graph(json!(nodes), json!([])))["entities"].as_array().unwrap().len(),
        MAX_ENTITIES
    );
    let edges: Vec<_> = (0..MAX_RELATIONSHIPS).map(|id| edge(&format!("e{id}"), "n", "n")).collect();
    let result = accepts(&graph(json!([node("n")]), json!(edges)));
    assert_eq!(result["relationships"].as_array().unwrap().len(), MAX_RELATIONSHIPS);
    let mut edges = edges;
    edges.push(edge("extra", "n", "n"));
    let message = rejects(&graph(json!([node("n")]), json!(edges)), "entity-limit", "/x/relationships");
    assert_eq!(message, "Collection exceeds 50000 items");
}

#[test]
fn forests_allow_one_parent_and_dags_allow_many() {
    let nodes = json!([node("a"), node("b"), node("c")]);
    let diamond = json!([edge("ab", "a", "b"), edge("ac", "a", "c"), edge("bc", "b", "c")]);
    let mut weighted = nodes.clone();
    weighted[1]["data"] = json!({"value": 1});
    weighted[2]["data"] = json!({"value": 1});
    let message = rejects(
        &state("treemap/v0", weighted.clone(), diamond.clone()),
        "multiple-parents",
        "/x/relationships/2",
    );
    assert_eq!(message, "A forest entity cannot have multiple incoming relationships");
    accepts(&state("treemap/v0", weighted, json!([edge("ab", "a", "b"), edge("ac", "a", "c")])));
    accepts(&state("dag/v0", nodes.clone(), diamond));
    // A cycle beside an acyclic component is still a cycle.
    let cyclic = json!([edge("ab", "a", "b"), edge("ba", "b", "a")]);
    let message = rejects(&state("dag/v0", nodes.clone(), cyclic), "cycle", "/x/relationships");
    assert_eq!(message, "This domain schema requires an acyclic graph");
    rejects(&state("dag/v0", nodes, json!([edge("cc", "c", "c")])), "cycle", "/x/relationships");
    // Long chains are acyclic.
    let chain: Vec<_> = (0..20).map(|id| node(&format!("n{id:02}"))).collect();
    let links: Vec<_> = (1..20)
        .map(|id| edge(&format!("e{id}"), &format!("n{:02}", id - 1), &format!("n{id:02}")))
        .collect();
    accepts(&state("dag/v0", json!(chain), json!(links)));
}

fn domain(schema: &str, kind: &str, data: Value) -> Value {
    state(schema, json!([{"id": "a", "kind": kind, "label": "", "data": data}]), json!([]))
}

#[test]
fn metrics_need_a_finite_value_and_an_optional_string_unit() {
    accepts(&domain("metrics/v0", "metric", json!({"value": 1.5})));
    accepts(&domain("metrics/v0", "metric", json!({"value": -1, "unit": "ms"})));
    let message = rejects(
        &domain("metrics/v0", "metric", json!({})),
        "invalid-domain-value",
        "/x/entities/0/data/value",
    );
    assert_eq!(message, "Expected a finite number");
    rejects(
        &domain("metrics/v0", "metric", json!({"value": 1, "unit": null})),
        "invalid-type",
        "/x/entities/0/data/unit",
    );
}

#[test]
fn treemap_leaves_and_valued_groups_need_nonnegative_values() {
    let tree = |parent: Value, leaf: Value| {
        state(
            "treemap/v0",
            json!([
                {"id": "p", "kind": "group", "label": "", "data": parent},
                {"id": "l", "kind": "leaf", "label": "", "data": leaf}
            ]),
            json!([edge("e", "p", "l")]),
        )
    };
    accepts(&tree(json!({}), json!({"value": 0})));
    accepts(&tree(json!({"value": 2}), json!({"value": 1})));
    let message = rejects(&tree(json!({}), json!({})), "invalid-domain-value", "/x/entities/1/data/value");
    assert_eq!(message, "Expected a finite nonnegative number");
    // Domain diagnostics use input positions.
    rejects(
        &tree(json!({"value": -1}), json!({"value": 1})),
        "invalid-domain-value",
        "/x/entities/0/data/value",
    );
    rejects(
        &tree(json!({"value": null}), json!({"value": 1})),
        "invalid-domain-value",
        "/x/entities/0/data/value",
    );
}

#[test]
fn api_declarations_need_a_signature() {
    for kind in [
        "export",
        "type",
        "member",
        "function",
        "class",
        "interface",
        "method",
        "property",
        "enum",
    ] {
        accepts(&domain("api/v0", kind, json!({"signature": ""})));
        rejects(&domain("api/v0", kind, json!({})), "invalid-type", "/x/entities/0/data/signature");
    }
    accepts(&domain("api/v0", "package", json!({})));
}

#[test]
fn database_columns_need_a_type_and_an_optional_boolean_nullable() {
    accepts(&domain("database/v0", "column", json!({"type": "int"})));
    accepts(&domain("database/v0", "column", json!({"type": "int", "nullable": false})));
    let message = rejects(
        &domain("database/v0", "column", json!({"type": "int", "nullable": 0})),
        "invalid-domain-value",
        "/x/entities/0/data/nullable",
    );
    assert_eq!(message, "Expected a boolean");
    rejects(
        &domain("database/v0", "column", json!({})),
        "invalid-type",
        "/x/entities/0/data/type",
    );
    accepts(&domain("database/v0", "table", json!({})));
}

#[test]
fn schemas_without_domain_rules_accept_any_data() {
    for schema in ["graph/v0", "architecture/v0", "dag/v0"] {
        accepts(&domain(schema, "anything", json!({"value": "x", "time": null})));
    }
}

#[test]
fn diagnostics_use_the_caller_path_prefix() {
    let failure = normalize(&json!({}), "").unwrap_err();
    assert_eq!(failure[0].path, "/protocolVersion");
    let failure = normalize(&json!({}), "/before").unwrap_err();
    assert_eq!(failure[0].path, "/before/protocolVersion");
}
