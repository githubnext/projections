//! api/v0 contract facts.

use serde_json::{Value, json};

/// Facts without the ones that are false, null or empty, which mean the same
/// as absent ones.
fn facts(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .filter(|(_, value)| match value {
                    Value::Null | Value::Bool(false) => false,
                    Value::Array(items) => !items.is_empty(),
                    Value::Object(map) => !map.is_empty(),
                    _ => true,
                })
                .collect(),
        ),
        other => other,
    }
}

/// A contract: the kind of declaration in api/v0 terms, Rust's own word for
/// it, who can use it (everyone: the public API is only what is `pub`), and
/// the other facts (`native` among them).
pub(super) fn api_contract(declaration: &str, term: &str, mut other: Value) -> Value {
    if let Some(native) = other.get_mut("native") {
        *native = facts(native.take());
    }
    other["declaration"] = json!(declaration);
    other["term"] = json!(term);
    other["visibility"] = json!("public");
    facts(other)
}

/// A type where values flow, as api/v0 writes it.
pub(super) fn type_ref(text: &str) -> Value {
    json!({"text": text})
}
