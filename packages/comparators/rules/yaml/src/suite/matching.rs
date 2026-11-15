use projections_engine::pointer;
use serde_json::Value;

/// Whether `actual` has everything `expected` lists: objects by their listed
/// keys, arrays and scalars exactly; an expected `null` matches an absent key.
pub fn matches(expected: &Value, actual: Option<&Value>) -> bool {
    match (expected, actual) {
        (Value::Null, None) => true,
        (Value::Object(expected), Some(Value::Object(actual))) => expected.iter().all(|(key, value)| matches(value, actual.get(key))),
        (Value::Object(_), _) | (_, None) => false,
        (expected, Some(actual)) => equal(expected, actual),
    }
}

pub(super) fn equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => left.as_f64() == right.as_f64(),
        (Value::Array(left), Value::Array(right)) => left.len() == right.len() && left.iter().zip(right).all(|(a, b)| equal(a, b)),
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .all(|(key, value)| right.get(key).is_some_and(|other| equal(value, other)))
        }
        _ => left == right,
    }
}

/// The first place `actual` misses `expected`: a pointer relative to them.
pub(super) fn mismatch(expected: &Value, actual: Option<&Value>, path: &str) -> Option<String> {
    match (expected, actual) {
        (Value::Object(fields), Some(Value::Object(actual))) => fields
            .iter()
            .find_map(|(key, value)| mismatch(value, actual.get(key), &pointer(path, key))),
        _ if matches(expected, actual) => None,
        _ => Some(path.to_owned()),
    }
}

/// `actual` restricted to the keys `expected` lists, so a diff shows only
/// what the expectation is about.
pub(super) fn projected(expected: &Value, actual: Option<&Value>) -> Value {
    match (expected, actual) {
        (Value::Object(fields), Some(Value::Object(actual))) => Value::Object(
            fields
                .iter()
                .filter_map(|(key, value)| actual.get(key).map(|item| (key.clone(), projected(value, Some(item)))))
                .collect(),
        ),
        (_, Some(actual)) => actual.clone(),
        (_, None) => Value::Null,
    }
}

pub(super) fn get<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    if path.is_empty() { Some(value) } else { value.pointer(path) }
}

pub(super) fn shown(value: Option<&Value>) -> String {
    match value {
        None => "absent".into(),
        Some(value) => {
            let text = serde_json::to_string(value).unwrap_or_default();
            if text.chars().count() > 80 {
                format!("{}…", text.chars().take(79).collect::<String>())
            } else {
                text
            }
        }
    }
}

pub(super) fn ids(value: &Value) -> Vec<&str> {
    value.as_array().into_iter().flatten().filter_map(Value::as_str).collect()
}

/// The changes a token names: the change with that ID, and the changes whose
/// `before` or `after` includes it as an item ID.
pub(super) fn named<'a>(changes: &'a [Value], token: &str) -> Vec<&'a Value> {
    changes
        .iter()
        .filter(|change| change["id"] == token || ids(&change["before"]).contains(&token) || ids(&change["after"]).contains(&token))
        .collect()
}

pub(super) fn listed(values: &[&str]) -> String {
    let mut shown: Vec<String> = values.iter().take(10).map(|id| format!("`{id}`")).collect();
    if values.len() > 10 {
        shown.push(format!("and {} more", values.len() - 10));
    }
    shown.join(", ")
}
