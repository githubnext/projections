use super::scenarios::write_scenarios;
use crate::fixtures;
use serde_json::json;
use std::fs;

#[test]
fn a_custom_comparator_scenario_names_its_file_by_its_repository_path() {
    let root = tempfile::tempdir().unwrap();
    let rules = "format: projections.comparator\nversion: 0\n";
    fs::create_dir_all(root.path().join("tools/order")).unwrap();
    fs::write(root.path().join("tools/order/order.comparator.yaml"), rules).unwrap();
    let extraction = json!({"protocolVersion": 0, "schema": "graph/v0",
            "entities": [{"id": "a", "kind": "item", "label": "A"}], "relationships": []});
    let definition = json!({"id": "deps", "renderer": "graph",
            "comparator": {"file": "tools/order/order.comparator.yaml", "options": {"x": 1}}});
    let directory = tempfile::tempdir().unwrap();
    let path = write_scenarios(
        directory.path(),
        root.path(),
        &definition,
        "Deps",
        json!("graph"),
        &json!({"extraction": extraction}),
        Some(&json!({"before": {"extraction": extraction}, "after": {"extraction": extraction}})),
    )
    .unwrap();
    let loaded = fixtures::load(&[path], &[], "", true, false);
    assert_eq!(loaded.errors(), Vec::<String>::new());
    let head = loaded.value["scenarios"]
        .as_array()
        .unwrap()
        .iter()
        .find(|scenario| scenario["id"] == "head")
        .unwrap();
    assert_eq!(head["comparator"]["id"], "tools/order/order.comparator.yaml");
    assert_eq!(head["comparator"]["options"], json!({"x": 1}));
}

#[test]
fn scenarios_present_as_the_definition_does() {
    let root = tempfile::tempdir().unwrap();
    let extraction = json!({"protocolVersion": 0, "schema": "graph/v0",
            "entities": [{"id": "a", "kind": "item", "label": "A", "data": {"size": 3}}], "relationships": []});
    let presentation = json!({"rendererOptions": {"sizeBy": "/data/size"}});
    let definition = json!({"id": "deps", "renderer": "graph", "presentation": presentation});
    let directory = tempfile::tempdir().unwrap();
    let path = write_scenarios(
        directory.path(),
        root.path(),
        &definition,
        "Deps",
        json!("graph"),
        &json!({"extraction": extraction}),
        Some(&json!({"before": {"extraction": extraction}, "after": {"extraction": extraction}})),
    )
    .unwrap();
    let loaded = fixtures::load(&[path], &[], "", true, false);
    assert_eq!(loaded.errors(), Vec::<String>::new());
    for scenario in loaded.value["scenarios"].as_array().unwrap() {
        assert_eq!(scenario["presentation"], presentation, "{}", scenario["id"]);
    }
}
