//! The runner API's conformance: each response the service writes for a
//! request its clients decode with `@githubnext/projections-schemas/runner`
//! matches that response's schema in the generated
//! `packages/schemas/internal/runner-api.json`, so the Rust service and the
//! TypeScript decoders can't drift apart.
//!
//! It is stricter than the clients: a property the schema doesn't declare
//! fails it unless the schema allows `additionalProperties`, so a field the
//! service adds is declared, and typed, in the TypeBox source first. It
//! supports only the keywords the generator writes and refuses any other, so
//! a schema can't silently go unchecked.

use serde_json::{Map, Value, json};

const SCHEMA: &str = include_str!("../../../schemas/internal/runner-api.json");

/// The keywords the check applies, and the annotations it ignores.
const KEYWORDS: &[&str] = &[
    "type",
    "required",
    "properties",
    "additionalProperties",
    "items",
    "anyOf",
    "enum",
    "const",
    "minimum",
    "maximum",
    "title",
    "description",
    "x-request",
];

/// Asserts that `value` is a valid `name` response (`adopt`, `explore`, …).
pub(super) fn conforms(name: &str, value: &Value) {
    let problems = problems(name, value);
    assert!(
        problems.is_empty(),
        "the {name} response doesn't match its schema in packages/schemas/internal/runner-api.json:\n{}\n{value:#}",
        problems.join("\n")
    );
}

/// Where and why `value` isn't a valid `name` response.
fn problems(name: &str, value: &Value) -> Vec<String> {
    let schema: Value = serde_json::from_str(SCHEMA).unwrap();
    let definition = &schema["$defs"][name];
    assert!(definition.is_object(), "runner-api.json has no {name} response");
    let mut problems = Vec::new();
    check(definition, value, "", &mut problems);
    problems
}

fn check(schema: &Value, value: &Value, pointer: &str, problems: &mut Vec<String>) {
    let schema = schema.as_object().expect("a schema is an object");
    if let Some(keyword) = schema.keys().find(|keyword| !KEYWORDS.contains(&keyword.as_str())) {
        panic!("the conformance check doesn't support {keyword} (at {pointer})");
    }
    assert!(
        schema.get("type") == Some(&json!("object"))
            || !["properties", "required", "additionalProperties"]
                .iter()
                .any(|keyword| schema.contains_key(*keyword)),
        "the conformance check applies object keywords only with type object (at {pointer})"
    );
    let at = if pointer.is_empty() { "the root" } else { pointer };
    if let Some(alternatives) = schema.get("anyOf").and_then(Value::as_array)
        && !alternatives.iter().any(|alternative| {
            let mut nested = Vec::new();
            check(alternative, value, pointer, &mut nested);
            nested.is_empty()
        })
    {
        problems.push(format!("{at}: matches none of {}", Value::Array(alternatives.clone())));
    }
    if let Some(kind) = schema.get("type").and_then(Value::as_str)
        && !is(kind, value)
    {
        problems.push(format!("{at}: {value} is not {kind}"));
        return;
    }
    if let Some(constant) = schema.get("const")
        && value != constant
    {
        problems.push(format!("{at}: {value} is not {constant}"));
    }
    if let Some(values) = schema.get("enum").and_then(Value::as_array)
        && !values.contains(value)
    {
        problems.push(format!("{at}: {value} is not one of {}", Value::Array(values.clone())));
    }
    if let (Some(minimum), Some(number)) = (schema.get("minimum").and_then(Value::as_f64), value.as_f64())
        && number < minimum
    {
        problems.push(format!("{at}: {number} is less than {minimum}"));
    }
    if let (Some(maximum), Some(number)) = (schema.get("maximum").and_then(Value::as_f64), value.as_f64())
        && number > maximum
    {
        problems.push(format!("{at}: {number} is more than {maximum}"));
    }
    if let Some(object) = value.as_object()
        && schema.get("type") == Some(&json!("object"))
    {
        object_problems(schema, object, pointer, problems);
    }
    if let (Some(items), Some(array)) = (schema.get("items"), value.as_array()) {
        for (index, item) in array.iter().enumerate() {
            check(items, item, &format!("{pointer}/{index}"), problems);
        }
    }
}

fn object_problems(schema: &Map<String, Value>, object: &Map<String, Value>, pointer: &str, problems: &mut Vec<String>) {
    let at = if pointer.is_empty() { "the root" } else { pointer };
    for name in schema.get("required").and_then(Value::as_array).into_iter().flatten() {
        let name = name.as_str().unwrap();
        if !object.contains_key(name) {
            problems.push(format!("{at}: {name} is missing"));
        }
    }
    let empty = Map::new();
    let properties = schema.get("properties").and_then(Value::as_object).unwrap_or(&empty);
    for (name, item) in object {
        let path = format!("{pointer}/{}", name.replace('~', "~0").replace('/', "~1"));
        match (properties.get(name), schema.get("additionalProperties")) {
            (Some(property), _) => check(property, item, &path, problems),
            (None, Some(Value::Bool(true))) => {}
            (None, Some(additional @ Value::Object(_))) => check(additional, item, &path, problems),
            (None, _) => problems.push(format!("{path}: is not declared in the schema")),
        }
    }
}

fn is(kind: &str, value: &Value) -> bool {
    match kind {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        "number" => value.is_number(),
        "integer" => value.is_i64() || value.is_u64() || value.as_f64().is_some_and(|number| number.fract() == 0.0),
        _ => panic!("the conformance check doesn't support type {kind}"),
    }
}

#[test]
fn the_conformance_check_refuses_malformed_nested_entries_and_undeclared_fields() {
    let preview = json!({"files": [], "digest": "sha256:00", "written": false});
    assert_eq!(problems("adopt", &preview), Vec::<String>::new());
    let mut nested = preview.clone();
    nested["files"] = json!([null]);
    assert_eq!(problems("adopt", &nested), ["/files/0: null is not object"]);
    let mut undeclared = preview.clone();
    undeclared["extra"] = json!(1);
    assert_eq!(problems("adopt", &undeclared), ["/extra: is not declared in the schema"]);
    // An opaque document is checked only by its envelope.
    let document = json!({"document": {"format": "projections.extraction", "version": 0, "extraction": {}}});
    assert_eq!(problems("document", &document), Vec::<String>::new());
}
