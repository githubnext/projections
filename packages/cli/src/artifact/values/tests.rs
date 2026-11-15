use super::*;
use crate::artifact::validate_definition;

const TEXT: &str = "{\n  \"id\": \"legacy\",\n  \"tags\": [\"a\", {\"b\": 1}],\n  \"comparator\": {\n    \"options\": {\"x\": \"}\"},\n    \"module\": \"dist/order.wasm\"\n  }\n}\n";

#[test]
fn pointers_locate_their_member() {
    assert_eq!(locate(TEXT, "/comparator/module"), Some((6, 5)));
    assert_eq!(locate(TEXT, "/comparator"), Some((4, 3)));
    assert_eq!(locate(TEXT, "/tags/1/b"), Some((3, 18)));
    // A member that isn't there: the deepest one that is.
    assert_eq!(locate(TEXT, "/comparator/rules"), Some((4, 3)));
    assert_eq!(locate(TEXT, ""), Some((1, 1)));
    assert_eq!(locate("{\"a\" 1}", "/a/b"), None);
}

#[test]
fn validation_errors_name_their_field() {
    let error = validate_definition(&json!({"id": "x", "extractor": "repository-map", "renderer": "graph",
            "comparator": {"module": "dist/order.wasm"}}))
    .unwrap_err();
    assert_eq!(error_pointer(&error).as_deref(), Some("/comparator/module"));
    assert!(error.to_string().starts_with(
        "Module comparators were removed; name a comparator file instead: `\"comparator\": \"<path>.comparator.yaml\"`. See https://"
    ));
    let error = validate_definition(&json!({"id": "x", "extractor": "repository-map", "renderer": "graph",
            "comparator": {"rules": "x.rules.yaml"}}))
    .unwrap_err();
    assert_eq!(error_pointer(&error).as_deref(), Some("/comparator/rules"));
    assert!(
        error
            .to_string()
            .starts_with("`comparator.rules` was renamed: name the file directly")
    );
    let error = validate_definition(&json!({"id": "x", "extractor": "repository-map", "renderer": "graph",
            "comparator": {"file": "x.yaml"}}))
    .unwrap_err();
    assert_eq!(error_pointer(&error).as_deref(), Some("/comparator/file"));
    assert!(error.to_string().contains("for example `x.comparator.yaml`"));
    let error = validate_definition(&json!({"id": "x", "extractor": "repository-map", "renderer": "graph",
            "comparator": "x.rules.yaml"}))
    .unwrap_err();
    assert_eq!(error_pointer(&error).as_deref(), Some("/comparator"));
    for (comparator, normalized) in [
        (json!("a/x.comparator.yaml"), json!({"file": "a/x.comparator.yaml"})),
        (
            json!({"file": "x.comparator.yml", "options": {"a": 1}}),
            json!({"file": "x.comparator.yml", "options": {"a": 1}}),
        ),
        (
            json!({"options": {"order": {"by": "dependents"}}}),
            json!({"options": {"order": {"by": "dependents"}}}),
        ),
    ] {
        let definition =
            validate_definition(&json!({"id": "x", "extractor": "repository-map", "renderer": "graph", "comparator": comparator})).unwrap();
        assert_eq!(definition["comparator"], normalized);
    }
    let error = validate_definition(&json!({"id": "x", "extractor": "repository-map", "renderer": "graph", "colour": 1})).unwrap_err();
    assert_eq!(error_pointer(&error).as_deref(), Some("/colour"));
}
