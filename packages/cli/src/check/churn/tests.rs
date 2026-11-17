use super::{churn, churn_step, words};
use serde_json::{Value, json};

fn document(schema: &str, entities: Value, relationships: Value) -> Value {
    json!({"extraction": {"schema": schema, "entities": entities, "relationships": relationships}})
}

#[test]
fn counts_lists_and_positions_in_data_warn() {
    let custom = json!({"extractor": {"command": ["python3", "x.py"]}});
    let document = document(
        "architecture/v0",
        json!([
            {"id": "module:a", "kind": "module", "data": {"owner": "core", "fileCount": 4, "line": 12, "importers": ["b.swift"]}},
            {"id": "module:b", "kind": "module", "data": {"owner": "core", "file_count": 2, "version": 3}},
        ]),
        json!([{"id": "uses:a->b", "kind": "uses", "data": {"files": 7, "kind": "import"}}]),
    );
    let step = churn_step(&custom, &document).expect("a warning");
    assert_eq!(step["status"], "warn");
    let details: Vec<&str> = step["details"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
    assert_eq!(details.len(), 5, "{details:#?}");
    assert!(
        details
            .iter()
            .any(|detail| detail.starts_with("`data.fileCount` on 1 `module` entity (`module:a`) counts things elsewhere"))
    );
    assert!(
        details
            .iter()
            .any(|detail| detail.starts_with("`data.files` on 1 `uses` relationship (`uses:a->b`) counts"))
    );
    assert!(
        details
            .iter()
            .any(|detail| detail.starts_with("`data.importers` on 1 `module` entity (`module:a`) lists"))
    );
    assert!(
        details
            .iter()
            .any(|detail| detail.contains("`data.line`") && detail.contains("\"location\""))
    );
    // Facts about the item itself pass, and so does a built-in extractor's output.
    assert!(!details.iter().any(|detail| detail.contains("owner") || detail.contains("version")));
    assert!(churn_step(&json!({"extractor": "repository-map"}), &document).is_none());
}

#[test]
fn deliberate_and_quantity_fields_pass() {
    let entities = json!([{"id": "a", "kind": "file", "data": {"lines": 40, "value": 40}}]);
    let sized = json!({"extractor": {"command": ["x"]}, "presentation": {"rendererOptions": {"sizeBy": "/data/lines"}}});
    assert!(churn_step(&sized, &document("graph/v0", entities.clone(), json!([]))).is_none());
    let custom = json!({"extractor": {"command": ["x"]}});
    assert!(churn_step(&custom, &document("treemap/v0", entities.clone(), json!([]))).is_none());
    let mut volatile = document("graph/v0", entities, json!([]));
    volatile["extraction"]["volatile"] = json!([{"kinds": ["file"], "path": "/data/lines"}]);
    assert!(churn_step(&custom, &volatile).is_none());
}

#[test]
fn field_names_split_into_words() {
    assert_eq!(words("fileCount"), ["file", "count"]);
    assert_eq!(words("number_of-callers"), ["number", "of", "callers"]);
    assert_eq!(words("importedBy"), ["imported", "by"]);
    assert!(churn("count", &json!(2), true).is_some());
    assert!(churn("numFiles", &json!(2), true).is_some());
    assert!(churn("discount", &json!(2), true).is_none());
    assert!(churn("country", &json!(2), true).is_none());
    assert!(churn("lines", &json!(["a"]), true).is_none());
}
