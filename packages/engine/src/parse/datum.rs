//! JSON values to the Engine's own [`Datum`], under the strict parser's
//! number rules: finite numbers, safe integers. `encode` writes them back.

use super::json::SAFE_INTEGER;
use crate::model::{Datum, Fields, Number};
use crate::{Failure, fail, pointer};
use serde_json::{Map, Value};

/// A JSON number as the Engine holds it.
pub(crate) fn number(number: &serde_json::Number, path: &str) -> Result<Number, Failure> {
    let unsafe_integer = || fail("unsafe-integer", path, "Integer exceeds the JavaScript safe-integer range");
    if let Some(integer) = number.as_i64() {
        return if integer.unsigned_abs() > SAFE_INTEGER as u64 {
            Err(unsafe_integer())
        } else {
            Ok(Number::Integer(integer))
        };
    }
    // Not an `i64`: a float, which JSON values hold only finite, or a larger
    // unsigned integer.
    match number.as_f64() {
        Some(value) if value.fract() != 0.0 || value.abs() <= SAFE_INTEGER => Ok(Number::Float(value)),
        _ => Err(unsafe_integer()),
    }
}

/// A JSON value as a [`Datum`]. Nesting is already bounded.
pub(crate) fn datum(value: &Value, path: &str) -> Result<Datum, Failure> {
    Ok(match value {
        Value::Null => Datum::Null,
        Value::Bool(value) => Datum::Bool(*value),
        Value::Number(value) => Datum::Number(number(value, path)?),
        Value::String(text) => Datum::String(text.clone()),
        Value::Array(items) => Datum::Array(
            items
                .iter()
                .enumerate()
                .map(|(index, item)| datum(item, &pointer(path, &index.to_string())))
                .collect::<Result<_, _>>()?,
        ),
        Value::Object(object) => Datum::Object(fields(object, path)?),
    })
}

/// A JSON object's fields as [`Fields`].
pub(crate) fn fields(object: &Map<String, Value>, path: &str) -> Result<Fields, Failure> {
    object
        .iter()
        .map(|(key, value)| Ok((key.clone(), datum(value, &pointer(path, key))?)))
        .collect()
}
