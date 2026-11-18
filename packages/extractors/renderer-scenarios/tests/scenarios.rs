//! Scenarios documents become a gallery's data: each scenario with its renderer, its normalized extractions and, for
//! a comparison, the comparison the runner's sandbox computes with the scenario's comparator.

use projections_extractor_renderer_scenarios::{ID, collect};
use projections_extractor_sdk::testing;
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// A fresh directory with `files` written into it.
fn tree(name: &str, files: &[(&str, String)]) -> PathBuf {
    let root = std::env::temp_dir().join(format!("projections-renderer-scenarios-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    for (path, text) in files {
        let path = root.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    root
}

fn graph(ids: &[&str]) -> Value {
    json!({"protocolVersion": 0, "schema": "graph/v0",
        "entities": ids.iter().map(|id| json!({"id": id, "kind": "service", "label": id.to_uppercase()})).collect::<Vec<_>>(),
        "relationships": []})
}

/// What the stand-in comparison service was asked: the comparator file and options of each request.
type Requests = Arc<Mutex<Vec<(Option<String>, Value)>>>;

fn run(root: &Path, inputs: Value) -> (anyhow::Result<Value>, Requests) {
    let requests: Requests = Arc::default();
    let seen = requests.clone();
    let cx = testing::context(
        root,
        json!({"id": "gallery", "extractor": ID, "renderer": "gallery", "inputs": inputs}),
    )
    .with_comparisons(move |request| {
        seen.lock().unwrap().push((
            request.file.map(|(path, rules)| format!("{path} ({} bytes)", rules.len())),
            request.options.clone(),
        ));
        Ok(json!({"protocolVersion": 0, "changes": [], "steps": []}))
    });
    (collect(&cx), requests)
}

fn entity<'a>(extraction: &'a Value, id: &str) -> &'a Value {
    extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entity| entity["id"] == id)
        .unwrap_or_else(|| panic!("no {id}"))
}

fn documents() -> Vec<(&'static str, String)> {
    let graph_scenarios = json!({
        "format": "projections.scenarios", "version": 0, "title": "Graph", "renderer": "graph",
        "scenarios": [
            {"id": "platform", "title": "Service platform", "description": "Payments split out.",
             "before": "fixtures/before.json", "after": "fixtures/after.json"},
            {"id": "priority", "title": "Payments first", "group": "Custom order",
             "before": "fixtures/before.json", "after": "fixtures/saved.json",
             "comparator": {"file": "../comparators/priority.comparator.yaml", "options": {"priority": ["payments"]}},
             "presentation": {"mode": "side-by-side"}},
            {"id": "snapshot", "title": "One revision", "extraction": graph(&["api"])}
        ]
    });
    let custom = json!({
        "format": "projections.scenarios", "version": 0,
        "scenarios": [
            {"id": "named", "title": "Named bundle", "renderer": {"bundle": "dist"}, "extraction": graph(&["a"])},
            {"id": "unbuilt", "title": "Unbuilt bundle", "renderer": {"bundle": "missing"}, "extraction": graph(&["a"])}
        ]
    });
    vec![
        ("renderers/graph/scenarios.json", graph_scenarios.to_string()),
        ("renderers/graph/fixtures/before.json", graph(&["orders", "billing"]).to_string()),
        ("renderers/graph/fixtures/after.json", graph(&["orders", "payments"]).to_string()),
        (
            "renderers/graph/fixtures/saved.json",
            json!({"format": "projections.extraction", "extraction": graph(&["payments", "orders"])}).to_string(),
        ),
        (
            "renderers/comparators/priority.comparator.yaml",
            "format: projections.comparator\n".to_owned(),
        ),
        ("renderers/custom/scenarios.json", custom.to_string()),
        (
            "renderers/custom/dist/renderer.json",
            json!({"format": "projections.renderer", "version": 0, "name": "cards", "title": "Cards", "handles": []}).to_string(),
        ),
        ("renderers/other/scenarios.json", json!({"format": "something-else"}).to_string()),
    ]
}

#[test]
fn every_scenario_becomes_an_entity_with_its_renderer_and_synthetic_data() {
    let root = tree("all", &documents());
    let (result, requests) = run(&root, json!({}));
    let extraction = result.unwrap();
    // The Engine accepts it under the vocabulary's typed data rules.
    let normalized = projections_engine::normalize(&extraction, "").unwrap();
    assert_eq!(normalized["vocabularies"], json!(["scenarios/v0"]));
    assert_eq!(extraction["metadata"]["documents"], 2, "a file of another format is left out");

    let document = entity(&extraction, "scenarios:renderers%2Fgraph%2Fscenarios.json");
    assert_eq!(document["kind"], "scenarios");
    assert_eq!(document["label"], "Graph");
    assert_eq!(document["data"]["path"], "renderers/graph/scenarios.json");
    assert_eq!(document["data"]["renderer"], "graph");
    assert_eq!(
        document["data"]["scenarios"],
        json!([
            "scenario:renderers%2Fgraph%2Fscenarios.json:platform",
            "scenario:renderers%2Fgraph%2Fscenarios.json:priority",
            "scenario:renderers%2Fgraph%2Fscenarios.json:snapshot"
        ]),
        "in the document's order"
    );

    let platform = &entity(&extraction, "scenario:renderers%2Fgraph%2Fscenarios.json:platform")["data"];
    assert_eq!(platform["renderer"], "graph");
    assert_eq!(platform["mode"], "comparison");
    assert_eq!(platform["group"], "Graph", "grouped under the document's title by default");
    assert_eq!(platform["description"], "Payments split out.");
    assert_eq!(platform["comparator"], "default");
    assert_eq!(
        platform["before"]["entities"][0]["id"], "billing",
        "normalized: items in canonical order"
    );
    assert_eq!(platform["comparison"], json!({"protocolVersion": 0, "changes": [], "steps": []}));

    let priority = &entity(&extraction, "scenario:renderers%2Fgraph%2Fscenarios.json:priority")["data"];
    assert_eq!(priority["group"], "Custom order");
    assert_eq!(priority["comparator"], "renderers/comparators/priority.comparator.yaml");
    assert_eq!(
        priority["after"]["entities"][0]["id"], "orders",
        "a saved extraction document's extraction"
    );
    assert_eq!(priority["presentation"], json!({"mode": "side-by-side"}));

    let snapshot = &entity(&extraction, "scenario:renderers%2Fgraph%2Fscenarios.json:snapshot")["data"];
    assert_eq!(snapshot["mode"], "extraction");
    assert!(snapshot.get("comparison").is_none());

    let named = &entity(&extraction, "scenario:renderers%2Fcustom%2Fscenarios.json:named")["data"];
    assert_eq!(
        (named["renderer"].as_str(), named["bundle"].as_str()),
        (Some("cards"), Some("renderers/custom/dist"))
    );
    let unbuilt = &entity(&extraction, "scenario:renderers%2Fcustom%2Fscenarios.json:unbuilt")["data"];
    assert_eq!(unbuilt["renderer"], "custom");
    let contains = extraction["relationships"].as_array().unwrap();
    assert_eq!(contains.len(), 5);
    assert!(contains.iter().all(|edge| edge["kind"] == "contains"));

    assert_eq!(
        *requests.lock().unwrap(),
        vec![
            (None, json!({})),
            (
                Some(format!(
                    "renderers/comparators/priority.comparator.yaml ({} bytes)",
                    "format: projections.comparator\n".len()
                )),
                json!({"priority": ["payments"]})
            ),
        ]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn include_and_exclude_choose_the_documents() {
    let root = tree("globs", &documents());
    let (result, _) = run(
        &root,
        json!({"include": ["renderers/**/scenarios.json"], "exclude": ["renderers/graph/**"]}),
    );
    let extraction = result.unwrap();
    assert_eq!(extraction["metadata"]["documents"], 1);
    assert!(
        extraction["entities"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entity| entity["id"].as_str().unwrap().contains("custom"))
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn any_renderer_identifier_is_kept_for_the_gallery_to_judge() {
    let scenarios: Vec<Value> = ["Graph.Custom", "my_renderer"]
        .iter()
        .map(|name| json!({"id": name.replace('.', "-"), "title": name, "renderer": name, "extraction": graph(&["a"])}))
        .collect();
    let document = json!({"format": "projections.scenarios", "version": 0, "renderer": "graph", "scenarios": scenarios});
    let root = tree("identifiers", &[("a/scenarios.json", document.to_string())]);
    let extraction = run(&root, json!({})).0.unwrap();
    assert_eq!(
        entity(&extraction, "scenario:a%2Fscenarios.json:Graph-Custom")["data"]["renderer"],
        "Graph.Custom"
    );
    assert_eq!(
        entity(&extraction, "scenario:a%2Fscenarios.json:my_renderer")["data"]["renderer"],
        "my_renderer"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn invalid_scenarios_fail_with_where_and_why() {
    let cases = [
        (
            json!({"id": "a", "title": "A", "extraction": graph(&["a"]), "extra": 1}),
            "unknown field extra",
        ),
        (
            json!({"id": "a", "title": "A", "before": "../../../outside.json", "after": "x.json"}),
            "leaves the project",
        ),
        (
            json!({"id": "a", "title": "A", "before": "/etc/x.json", "after": "x.json"}),
            "never absolute or a URL",
        ),
        (
            json!({"id": "a", "title": "A", "extraction": graph(&["a"]), "comparator": "x.comparator.yaml"}),
            "comparator requires before",
        ),
        (
            json!({"id": "a", "title": "A", "extraction": {"protocolVersion": 0}}),
            "not a valid extraction",
        ),
        (json!({"id": "a b", "title": "A", "extraction": graph(&["a"])}), "filename-safe"),
        (
            json!({"id": "a", "title": "A", "renderer": "../graph", "extraction": graph(&["a"])}),
            "must be a renderer name",
        ),
    ];
    for (index, (scenario, expected)) in cases.into_iter().enumerate() {
        let document = json!({"format": "projections.scenarios", "version": 0, "renderer": "graph", "scenarios": [scenario]});
        let root = tree(&format!("invalid-{index}"), &[("a/scenarios.json", document.to_string())]);
        let error = format!("{:#}", run(&root, json!({})).0.unwrap_err());
        assert!(error.contains(expected), "{expected}: {error}");
        assert!(error.contains("a/scenarios.json"), "names the document: {error}");
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn comparing_needs_a_runner_that_provides_comparisons() {
    let root = tree("no-service", &documents());
    let cx = testing::context(&root, json!({"id": "gallery", "extractor": ID, "renderer": "gallery"}));
    let error = format!("{:#}", collect(&cx).unwrap_err());
    assert!(error.contains("needs a runner that provides comparisons"), "{error}");
    fs::remove_dir_all(root).unwrap();
}
