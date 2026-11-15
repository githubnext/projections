//! The known differences between a comparator and its rules, each as the
//! smallest input that shows it. Every one is outside the equivalence corpus:
//! an input the original handled in a way that depended on its implementation
//! language rather than on its domain logic. The originals were deleted with
//! the module comparator kind; each test pins the rules' output and says what
//! the original's was.

mod common;

use serde_json::{Value, json};

fn graph(entities: Value, relationships: Value) -> Value {
    json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": relationships})
}

/// The default comparator orders values with `f64::total_cmp`, so `-0` sorts
/// below `0`; CEL compares them equal, so the tie keeps the default order.
#[test]
fn negative_zero_order_values() {
    common::with_stack(negative_zero_order_values_);
}

fn negative_zero_order_values_() {
    let entity = |id: &str, weight: Option<f64>| match weight {
        Some(weight) => {
            json!({"id": id, "kind": "package", "label": id, "data": {"weight": weight}})
        }
        None => json!({"id": id, "kind": "package", "label": id}),
    };
    let edge = |from: &str, to: &str| json!({"id": format!("{from}->{to}"), "kind": "dependency", "from": from, "to": to});
    // `a` and `b` arrive at different depths, as separate steps.
    let before = graph(json!([entity("root", None), entity("c", None)]), json!([edge("root", "c")]));
    let after = graph(
        json!([
            entity("root", None),
            entity("c", None),
            entity("a", Some(-0.0)),
            entity("b", Some(0.0))
        ]),
        json!([edge("root", "c"), edge("root", "a"), edge("c", "b")]),
    );
    let options = json!({"order": {"by": "data.weight"}});
    let steps = |comparison: Value| comparison["steps"].clone();
    let native = steps(projections_comparator_default::compare(&before, &after, &options).unwrap());
    let declarative = steps(common::comparator("default-order").compare(&before, &after, &options).unwrap());
    eprintln!("native {native}\nrules {declarative}");
    assert_ne!(native, declarative);
    assert_eq!(native[0]["changes"], json!(["b", "c->b"]));
    assert_eq!(declarative[0]["changes"], json!(["a", "root->a"]));
}

/// The moved-components comparator named a paired relationship's change by
/// its after ID without a uniqueness suffix, so a relationship whose ID was
/// also a changed entity's ID made its comparison invalid. That was a bug, not
/// a difference: the JavaScript original was fixed to add the suffix the core
/// adds, and agreed with the rules from then on.
#[test]
fn moved_relationship_ids_that_collide_with_entity_changes() {
    common::with_stack(moved_relationship_ids_that_collide_with_entity_changes_);
}

fn moved_relationship_ids_that_collide_with_entity_changes_() {
    let entity = |id: &str, label: &str| json!({"id": id, "kind": "component", "label": label});
    // `e` is removed as an entity and arrives as a relationship ID.
    let before = graph(
        json!([entity("a/X", "X"), entity("z", "Z"), entity("e", "E")]),
        json!([{"id": "r", "kind": "calls", "from": "a/X", "to": "z"}]),
    );
    let after = graph(
        json!([entity("b/X", "X"), entity("z", "Z")]),
        json!([{"id": "e", "kind": "calls", "from": "b/X", "to": "z"}]),
    );
    let declarative = common::comparator("moved-components").compare(&before, &after, &json!({})).unwrap();
    let ids: Vec<&str> = declarative["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["b/X", "e", "e~1"]);
    assert_eq!(declarative["changes"][2]["correspondence"], "declared");
}

/// The JavaScript runtime policy comparator quoted data with template
/// literals, so a non-string `scope` read `[object Object]` (its summary here
/// was "Policy `p` now applies to [object Object] (was all pods)."); the rules
/// quote it with CEL's `%s`. The runtime-policy/v0 vocabulary requires a string scope; a graph/v0
/// input doesn't.
#[test]
fn runtime_policy_quotes_non_string_data() {
    common::with_stack(runtime_policy_quotes_non_string_data_);
}

fn runtime_policy_quotes_non_string_data_() {
    let policy = |scope: Value| json!({"id": "policy:p", "kind": "policy", "label": "p", "data": {"scope": scope}});
    let subject = |id: &str| json!({"id": id, "kind": "subject", "label": id});
    let applies = |to: &str| json!([{"id": "applies-to:p", "kind": "applies-to", "from": "policy:p", "to": to}]);
    let before = graph(json!([policy(json!("all pods")), subject("s1"), subject("s2")]), applies("s1"));
    let after = graph(
        json!([policy(json!({"pods": "app=web"})), subject("s1"), subject("s2")]),
        applies("s2"),
    );
    let summary = |comparison: &Value| {
        comparison["changes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == "policy:p")
            .unwrap()["summary"]
            .clone()
    };
    let declarative = common::comparator("runtime-policy").compare(&before, &after, &json!({})).unwrap();
    assert_eq!(summary(&declarative), "Policy `p` now applies to {pods: app=web} (was all pods).");
}

/// serde_json tells `1` from `1.0`, so the Rust API compatibility comparator
/// found a changed contract fact where JSON (and CEL, and the Engine's
/// canonical content) sees none: it classified this change `unknown`. Typed
/// contract facts can't be numbers; `native` facts, which are open JSON, can.
#[test]
fn api_contract_numbers_by_representation() {
    common::with_stack(api_contract_numbers_by_representation_);
}

fn api_contract_numbers_by_representation_() {
    let entity = |extra: Value, signature: &str| {
        json!({"id": "go:p.Limit", "kind": "const", "label": "Limit",
            "data": {"signature": signature, "contract": {"declaration": "constant", "term": "const", "visibility": "public",
                "type": {"text": "int"}, "value": "1", "native": {"extra": extra}}}})
    };
    let api = |entity: Value| json!({"protocolVersion": 0, "schema": "api/v0", "metadata": {"ecosystem": "go"}, "entities": [entity], "relationships": []});
    let before = api(entity(json!(1), "const Limit = 1"));
    let after = api(entity(json!(1.0), "const Limit int = 1"));
    let declarative = common::comparator("api-compatibility")
        .compare(&before, &after, &json!({}))
        .unwrap();
    let level = |comparison: &Value| comparison["metadata"]["compatibility"]["changes"]["go:p.Limit"]["level"].clone();
    assert_eq!(level(&declarative), "compatible");
}

/// The Rust .NET rules quoted a non-string constant value with serde's
/// formatting ("Value changed from `1.0` to `2.0`; code compiled earlier
/// keeps `1.0`"); the rules quoted it with JSON.stringify's (`1`). The .NET
/// extractor writes constant values as strings, and now the api/v0 schema
/// requires them: the Engine rejects a number before any rules run.
#[test]
fn dotnet_quotes_numbers_by_representation() {
    common::with_stack(dotnet_quotes_numbers_by_representation_);
}

fn dotnet_quotes_numbers_by_representation_() {
    let field = |value: f64| {
        json!({"id": "api:P:F:P.T.Max", "kind": "field", "label": "Max",
            "data": {"signature": format!("P.T.Max = {value}"),
                "contract": {"declaration": "constant", "term": "const", "visibility": "public", "static": true, "value": value}}})
    };
    let api = |entity: Value| json!({"protocolVersion": 0, "schema": "api/v0", "metadata": {"ecosystem": "dotnet"}, "entities": [entity], "relationships": []});
    let (before, after) = (api(field(1.0)), api(field(2.0)));
    let failure = common::comparator("api-compatibility")
        .compare(&before, &after, &json!({}))
        .unwrap_err();
    assert_eq!(
        (failure[0].code.as_str(), failure[0].path.as_str()),
        ("invalid-type", "/before/entities/0/data/contract/value")
    );
}

/// The original began a warning's sentence with the item's kind as it is
/// written, so a hook's or a policy's read "hook `tcp_connect` gains a
/// warning: …" and an agent's "agent Tetragon agent gains a warning: …". The
/// rules capitalize the kind, and name an agent as its configuration sentence
/// does; golden/runtime-policy.json records the corrected sentences.
#[test]
fn runtime_policy_warning_sentences_begin_with_a_capital() {
    common::with_stack(runtime_policy_warning_sentences_begin_with_a_capital_);
}

fn runtime_policy_warning_sentences_begin_with_a_capital_() {
    let item = |id: &str, kind: &str, label: &str, findings: Value| json!({"id": id, "kind": kind, "label": label, "data": {"findings": findings}});
    let side = |findings: Value| {
        graph(
            json!([
                item("hook:h", "hook", "tcp_connect", findings.clone()),
                item("agent:a", "agent", "Tetragon agent", findings)
            ]),
            json!([]),
        )
    };
    let comparison = common::comparator("runtime-policy")
        .compare(&side(json!([])), &side(json!([{"kind": "note", "message": "A note."}])), &json!({}))
        .unwrap();
    let summaries: Vec<&str> = comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["summary"].as_str().unwrap())
        .collect();
    assert_eq!(
        summaries,
        [
            "The Tetragon agent gains a warning: A note.",
            "Hook `tcp_connect` gains a warning: A note."
        ]
    );
}
