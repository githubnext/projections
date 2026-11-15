//! Reading JSON values: objects with known fields, strings, arrays and
//! choices, each failing with the protocol's diagnostic.

use crate::{Failure, fail, pointer};
use serde_json::{Map, Value};

pub(crate) fn object<'a>(value: &'a Value, path: &str) -> Result<&'a Map<String, Value>, Failure> {
    value.as_object().ok_or_else(|| fail("invalid-type", path, "Expected an object"))
}

/// An object with no fields but `allowed`.
pub(crate) fn fields(value: &Value, allowed: &[&str], path: &str) -> Result<(), Failure> {
    for key in object(value, path)?.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(fail(
                "unknown-field",
                &pointer(path, key),
                "Unknown field; extensions belong in data or metadata",
            ));
        }
    }
    Ok(())
}

pub(crate) fn text<'a>(value: &'a Value, path: &str, nonempty: bool) -> Result<&'a str, Failure> {
    match value.as_str() {
        Some(value) if !nonempty || !value.trim().is_empty() => Ok(value),
        _ => Err(fail(
            "invalid-type",
            path,
            if nonempty {
                "Expected a nonempty string"
            } else {
                "Expected a string"
            },
        )),
    }
}

/// A nonblank string, owned.
pub(crate) fn name(value: &Value, path: &str) -> Result<String, Failure> {
    text(value, path, true).map(str::to_owned)
}

/// A field that may be absent: `None`, or what `read` makes of it at its path.
pub(crate) fn optional<T>(
    value: &Value,
    key: &str,
    path: &str,
    read: impl FnOnce(&Value, &str) -> Result<T, Failure>,
) -> Result<Option<T>, Failure> {
    value.get(key).map(|field| read(field, &pointer(path, key))).transpose()
}

pub(crate) fn array<'a>(value: &'a Value, path: &str) -> Result<&'a Vec<Value>, Failure> {
    value.as_array().ok_or_else(|| fail("invalid-type", path, "Expected an array"))
}

/// A string that names one of `options`.
pub(crate) fn choice<T: Copy>(value: &Value, options: &[T], name: fn(T) -> &'static str, path: &str, message: &str) -> Result<T, Failure> {
    value
        .as_str()
        .and_then(|text| options.iter().copied().find(|option| name(*option) == text))
        .ok_or_else(|| fail("invalid-type", path, message))
}

/// A protocol version: a number equal to 0, in either form.
pub(crate) fn version_zero(value: &Value, path: &str) -> Result<(), Failure> {
    if value.as_f64() != Some(0.0) {
        return Err(fail("unsupported-version", path, "Expected protocolVersion 0"));
    }
    Ok(())
}

/// The length of a value's compact JSON.
pub(crate) fn length(value: &impl serde::Serialize) -> usize {
    serde_json::to_vec(value).expect("JSON values and the model serialize").len()
}
