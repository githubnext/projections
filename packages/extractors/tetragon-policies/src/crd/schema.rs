//! The structural OpenAPI schema a CRD gives a version: types, enums,
//! required and unknown fields, and the bounds on lengths, counts and values.

use serde_json::{Map, Value};

const MAX_VIOLATIONS: usize = 20;

/// Every way `document` violates `schema`, as `path: problem` sentences.
pub(super) fn violations(schema: &Value, document: &Value) -> Vec<String> {
    let mut violations = vec![];
    check(schema, document, "", &mut violations);
    violations.truncate(MAX_VIOLATIONS);
    violations
}

fn kind_of(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(number) if number.is_i64() || number.is_u64() => "integer",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn at(path: &str) -> String {
    if path.is_empty() { "the document".into() } else { path.to_owned() }
}

fn check(schema: &Value, value: &Value, path: &str, violations: &mut Vec<String>) {
    if violations.len() >= MAX_VIOLATIONS || value.is_null() {
        return;
    }
    if schema["x-kubernetes-int-or-string"] == true {
        if !matches!(kind_of(value), "integer" | "string") {
            violations.push(format!("{}: must be an integer or a string", at(path)));
        }
        return;
    }
    if let Some(expected) = schema["type"].as_str() {
        let actual = kind_of(value);
        let fits = actual == expected || (expected == "number" && actual == "integer");
        if !fits {
            violations.push(format!("{}: must be {expected}, not {actual}", at(path)));
            return;
        }
    }
    if let Some(options) = schema["enum"].as_array()
        && !options.contains(value)
    {
        let names: Vec<String> = options
            .iter()
            .map(|o| o.as_str().map(str::to_owned).unwrap_or_else(|| o.to_string()))
            .collect();
        violations.push(format!("{}: {value} is not one of {}", at(path), names.join(", ")));
    }
    match value {
        Value::Object(object) => check_object(schema, object, path, violations),
        Value::Array(items) => {
            if let Some(maximum) = schema["maxItems"].as_u64()
                && items.len() as u64 > maximum
            {
                violations.push(format!("{}: has {} items; at most {maximum}", at(path), items.len()));
            }
            if let Some(minimum) = schema["minItems"].as_u64()
                && (items.len() as u64) < minimum
            {
                violations.push(format!("{}: has {} items; at least {minimum}", at(path), items.len()));
            }
            if let Some(item) = schema.get("items") {
                for (index, value) in items.iter().enumerate() {
                    check(item, value, &format!("{path}[{index}]"), violations);
                }
            }
        }
        Value::String(text) => {
            let length = text.chars().count() as u64;
            if let Some(maximum) = schema["maxLength"].as_u64()
                && length > maximum
            {
                violations.push(format!("{}: is longer than {maximum} characters", at(path)));
            }
            if let Some(minimum) = schema["minLength"].as_u64()
                && length < minimum
            {
                violations.push(format!("{}: is shorter than {minimum} characters", at(path)));
            }
            if let Some(pattern) = schema["pattern"].as_str()
                && let Ok(expression) = regex::Regex::new(pattern)
                && !expression.is_match(text)
            {
                violations.push(format!("{}: {text:?} doesn't match {pattern}", at(path)));
            }
        }
        Value::Number(_) => {
            let value = value.as_f64().unwrap_or_default();
            if let Some(minimum) = schema["minimum"].as_f64()
                && value < minimum
            {
                violations.push(format!("{}: is less than {minimum}", at(path)));
            }
            if let Some(maximum) = schema["maximum"].as_f64()
                && value > maximum
            {
                violations.push(format!("{}: is greater than {maximum}", at(path)));
            }
        }
        _ => {}
    }
}

fn check_object(schema: &Value, object: &Map<String, Value>, path: &str, violations: &mut Vec<String>) {
    let properties = schema["properties"].as_object();
    let join = |key: &str| {
        if path.is_empty() { key.to_owned() } else { format!("{path}.{key}") }
    };
    for required in schema["required"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        let defaulted = properties
            .and_then(|properties| properties.get(required))
            .is_some_and(|property| property.get("default").is_some());
        if !defaulted && object.get(required).is_none_or(Value::is_null) {
            violations.push(format!("{}: is required", join(required)));
        }
    }
    if let Some(maximum) = schema["maxProperties"].as_u64()
        && object.len() as u64 > maximum
    {
        violations.push(format!("{}: has more than {maximum} entries", at(path)));
    }
    // Kubernetes metadata is validated by the API server, not by the CRD.
    if path == "metadata" {
        return;
    }
    let open = schema["x-kubernetes-preserve-unknown-fields"] == true || schema["additionalProperties"] == true;
    for (key, value) in object {
        match (
            properties.and_then(|properties| properties.get(key)),
            schema.get("additionalProperties"),
        ) {
            (Some(property), _) => check(property, value, &join(key), violations),
            (None, Some(additional)) if additional.is_object() => check(additional, value, &join(key), violations),
            (None, _) if open || properties.is_none() => {}
            (None, _) => violations.push(format!("{}: is not a field the CRD defines", join(key))),
        }
    }
}

#[cfg(test)]
mod tests;
