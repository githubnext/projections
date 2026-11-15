//! The default comparator's JSON boundary: comparisons of JSON extractions,
//! its options, and the comparator module ABI's JSON-in, JSON-out call.

use crate::options::{Options, OrderBy};
use crate::{MAX_INPUT_BYTES, plan};
use projections_engine::{Extraction, Failure, check_comparison, fail, pointer};
use serde_json::{Value, json};

/// Compares two extractions. Both are validated and normalized first, and the
/// result is checked by the Engine before it is returned.
pub fn compare(before: &Value, after: &Value, options: &Value) -> Result<Value, Failure> {
    let options = Options::from_json(options, "/options")?;
    let before = Extraction::from_json(before, "/before")?;
    let after = Extraction::from_json(after, "/after")?;
    let comparison = plan(&before, &after, &options)?.to_json();
    check_comparison(&before, &after, &comparison)?;
    Ok(comparison)
}

fn invalid(path: &str, message: &str) -> Failure {
    fail("invalid-options", path, message)
}

fn only(value: &Value, allowed: &[&str], path: &str) -> Result<(), Failure> {
    let fields = value.as_object().ok_or_else(|| invalid(path, "Expected an object"))?;
    for key in fields.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(invalid(&pointer(path, key), "Unknown default comparator option"));
        }
    }
    Ok(())
}

impl Options {
    /// Reads the default comparator's options.
    pub fn from_json(value: &Value, path: &str) -> Result<Self, Failure> {
        only(value, &["order"], path)?;
        let Some(order) = value.get("order") else {
            return Ok(Self::default());
        };
        let path = pointer(path, "order");
        only(order, &["by", "direction"], &path)?;
        let by = match order["by"].as_str() {
            Some("dependents") => OrderBy::Dependents,
            Some(by) if by.starts_with("data.") && by.len() > 5 => OrderBy::Data(by[5..].to_owned()),
            _ => {
                return Err(invalid(&pointer(&path, "by"), "Expected dependents or data.<key>"));
            }
        };
        let descending = match order.get("direction").map(Value::as_str) {
            None | Some(Some("descending")) => true,
            Some(Some("ascending")) => false,
            _ => {
                return Err(invalid(&pointer(&path, "direction"), "Expected ascending or descending"));
            }
        };
        Ok(Self {
            order: Some((by, descending)),
        })
    }
}

fn describe(failure: &Failure) -> String {
    failure.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n")
}

fn module_call(input: &[u8]) -> Result<Value, Failure> {
    if input.len() > MAX_INPUT_BYTES {
        return Err(fail("input-size-limit", "", "Comparator input exceeds 64 MiB"));
    }
    let raw = std::str::from_utf8(input).map_err(|_| fail("invalid-unicode", "", "Input must be valid UTF-8"))?;
    let mut request = projections_engine::parse_json(raw)?;
    let fields = request.as_object().ok_or_else(|| fail("invalid-type", "", "Expected an object"))?;
    for key in fields.keys() {
        if !["protocolVersion", "before", "after", "baseline", "options"].contains(&key.as_str()) {
            return Err(fail("unknown-field", &pointer("", key), "Unknown comparator input field"));
        }
    }
    if request["protocolVersion"].as_f64() != Some(0.0) {
        return Err(fail("unsupported-version", "/protocolVersion", "Expected protocolVersion 0"));
    }
    // The default comparator produces the baseline, so a supplied one is unused.
    if request.get("baseline").is_some_and(|baseline| !baseline.is_object()) {
        return Err(fail("invalid-type", "/baseline", "Expected an object"));
    }
    let options = Options::from_json(request.get("options").unwrap_or(&json!({})), "/options")?;
    // Inputs are released as soon as they are no longer needed, which keeps
    // limit-sized extractions within the module's memory bound. The host
    // validates the module's output against both extractions.
    let before = Extraction::from_json(&request["before"].take(), "/before")?;
    let after = Extraction::from_json(&request["after"].take(), "/after")?;
    drop(request);
    let comparison = plan(&before, &after, &options)?;
    drop((before, after));
    Ok(comparison.to_json())
}

/// The comparator module ABI's JSON-in, JSON-out function: input is
/// `{"protocolVersion": 0, "before", "after", "baseline"?, "options"?}` and the
/// output is a comparison or `{"error": "message"}`.
pub fn call(input: &[u8]) -> Vec<u8> {
    let output = match module_call(input) {
        Ok(comparison) => comparison,
        Err(failure) => json!({"error": describe(&failure)}),
    };
    serde_json::to_vec(&output).expect("JSON values serialize")
}
