//! Small `api/v0` extractions compared by the API compatibility rules. These
//! were the unit tests of the Rust comparator the rules replaced; their
//! expectations hold for the rules unchanged, over the normalized contract
//! facts.

use serde_json::{Value, json};

/// An `api/v0` extraction of `entities`, with `contains` relationships from
/// each `parent` field (removed from the entity).
pub fn api(ecosystem: &str, entities: Vec<Value>) -> Value {
    let mut relationships = Vec::new();
    let entities: Vec<Value> = entities
        .into_iter()
        .map(|mut entity| {
            if let Some(parent) = entity.as_object_mut().unwrap().remove("parent") {
                let id = entity["id"].as_str().unwrap();
                relationships.push(
                    json!({"id": format!("contains:{}:{id}", parent.as_str().unwrap()), "kind": "contains", "from": parent, "to": id}),
                );
            }
            entity
        })
        .collect();
    json!({"protocolVersion": 0, "schema": "api/v0", "entities": entities, "relationships": relationships,
        "metadata": {"ecosystem": ecosystem}})
}

/// A declaration with a signature and contract. The contract states what
/// every extractor writes when a test leaves it out: `visibility` `public`,
/// and each parameter's `passing` by `value`.
pub fn entity(id: &str, kind: &str, signature: &str, mut contract: Value) -> Value {
    if let Some(facts) = contract.as_object_mut() {
        facts.entry("visibility").or_insert(json!("public"));
        for signature in facts.get_mut("signatures").and_then(Value::as_array_mut).into_iter().flatten() {
            for parameter in signature["parameters"].as_array_mut().into_iter().flatten() {
                if let Some(parameter) = parameter.as_object_mut() {
                    parameter.entry("passing").or_insert(json!("value"));
                }
            }
        }
    }
    let label = id.rsplit(['.', ':', '/']).next().unwrap_or(id).split('(').next().unwrap();
    json!({"id": id, "kind": kind, "label": label, "data": {"signature": signature, "contract": contract}})
}

/// `entity` contained in `parent`.
pub fn member(id: &str, parent: &str, kind: &str, signature: &str, contract: Value) -> Value {
    let mut value = entity(id, kind, signature, contract);
    value["parent"] = json!(parent);
    value
}

/// Runs `f` on a thread with a large stack, as every rules test does
/// (`common::with_stack`), and returns its result.
fn on_stack<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(f)
        .unwrap()
        .join()
        .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
}

/// The rules' comparison of two extractions, or the failure's text.
pub fn compare(before: &Value, after: &Value, options: Value) -> Result<Value, String> {
    let (before, after) = (before.clone(), after.clone());
    on_stack(move || {
        crate::common::comparator("api-compatibility")
            .compare(&before, &after, &options)
            .map_err(|failure| failure.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n"))
    })
}

/// The rules' comparison of two extractions, which must succeed.
pub fn classify_pair(before: &Value, after: &Value, options: Value) -> Value {
    compare(before, after, options).unwrap_or_else(|failure| panic!("{failure}"))
}

/// The value of a CEL expression over the rules' functions, evaluated as a
/// metadata value of the rules file.
pub fn function_value(expression: &str) -> Value {
    let text = crate::common::rules_text("api-compatibility");
    assert!(text.trim_end().ends_with('}'), "the rules end with their metadata values");
    let rules = format!("{}\n    probe: {}\n", text.trim_end(), serde_json::to_string(expression).unwrap());
    on_stack(move || {
        let empty = api("typescript", vec![]);
        let comparison = crate::common::covered("api-compatibility", &rules)
            .compare(&empty, &empty, &json!({}))
            .unwrap_or_else(|failure| panic!("{failure:?}"));
        comparison["metadata"]["probe"].clone()
    })
}

/// `(level, rules, reason)` of the change `id`.
pub fn verdict(comparison: &Value, id: &str) -> (String, Vec<String>, String) {
    let change = &comparison["metadata"]["compatibility"]["changes"][id];
    assert!(change.is_object(), "no classification for {id}: {comparison}");
    (
        change["level"].as_str().unwrap().to_owned(),
        change["findings"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|finding| finding["level"] == change["level"])
            .map(|finding| finding["rule"].as_str().unwrap().to_owned())
            .collect(),
        change["reason"].as_str().unwrap().to_owned(),
    )
}

/// The breaking kinds of the change `id`.
pub fn kinds(comparison: &Value, id: &str) -> Vec<String> {
    comparison["metadata"]["compatibility"]["changes"][id]["kinds"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|kind| kind.as_str().unwrap().to_owned())
        .collect()
}
