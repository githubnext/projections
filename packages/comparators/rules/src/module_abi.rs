//! The comparator module ABI's entry points: a comparison from JSON input,
//! and the check of a rules file, each JSON out.

use crate::{Comparator, DEFAULT_BUDGET, MAX_INPUT_BYTES};
use projections_engine::{Diagnostic, Extraction, Failure, fail};
use serde_json::{Value, json};

fn describe(failure: &Failure) -> String {
    failure.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n")
}

fn diagnostics(failure: &Failure) -> Value {
    Value::Array(
        failure
            .iter()
            .map(|Diagnostic { code, path, message }| json!({"code": code, "path": path, "message": message}))
            .collect(),
    )
}

/// Runs a module call's comparison; with `coverage`, the comparator is read
/// for coverage and `covered` receives its report, even when the comparison
/// fails.
fn module_call(input: &[u8], covered: Option<&mut Option<Value>>) -> Result<Value, Failure> {
    if input.len() > MAX_INPUT_BYTES {
        return Err(fail("input-size-limit", "", "Comparator input exceeds 64 MiB"));
    }
    let raw = std::str::from_utf8(input).map_err(|_| fail("invalid-unicode", "", "Input must be valid UTF-8"))?;
    let mut request = projections_engine::parse_json(raw)?;
    if request["protocolVersion"].as_f64() != Some(0.0) {
        return Err(fail("unsupported-version", "/protocolVersion", "Expected protocolVersion 0"));
    }
    let options = request["options"].take();
    let Some(text) = options["rules"].as_str() else {
        return Err(fail("invalid-options", "/options/rules", "Expected the rules file's text"));
    };
    for key in options.as_object().into_iter().flat_map(|fields| fields.keys()) {
        if key != "rules" && key != "options" {
            return Err(fail(
                "invalid-options",
                &projections_engine::pointer("/options", key),
                "Unknown field",
            ));
        }
    }
    let comparator = match covered {
        Some(_) => Comparator::with_coverage(text)?,
        None => Comparator::from_yaml(text)?,
    };
    let options = options.get("options").cloned().unwrap_or_else(|| json!({}));
    // Inputs are released as soon as they are no longer needed, which keeps
    // limit-sized extractions within the module's memory bound. The host
    // validates the module's output against both extractions.
    let before = Extraction::from_json(&request["before"].take(), "/before")?;
    let after = Extraction::from_json(&request["after"].take(), "/after")?;
    drop(request);
    let result = comparator
        .compare_normalized(&before, &after, &options, DEFAULT_BUDGET)
        .map(|(comparison, _)| comparison);
    if let Some(covered) = covered {
        *covered = comparator.coverage();
    }
    result
}

/// The comparator module ABI's JSON-in, JSON-out function: input is
/// `{"protocolVersion": 0, "before", "after", "baseline"?, "options": {"rules": "<YAML>", "options"?}}`
/// and the output is a comparison or `{"error": "message"}`.
pub fn call(input: &[u8]) -> Vec<u8> {
    let output = match module_call(input, None) {
        Ok(comparison) => comparison,
        Err(failure) => json!({"error": describe(&failure)}),
    };
    serde_json::to_vec(&output).expect("JSON values serialize")
}

/// [`call`] with rule coverage: the input is the same, and the output is
/// `{"comparison"}` or `{"error"}`, with `"coverage"`, the
/// `projections.rules-coverage` report of this comparison (`null` when the
/// rules didn't load).
pub fn cover(input: &[u8]) -> Vec<u8> {
    let mut coverage = None;
    let mut output = match module_call(input, Some(&mut coverage)) {
        Ok(comparison) => json!({"comparison": comparison}),
        Err(failure) => json!({"error": describe(&failure)}),
    };
    output["coverage"] = coverage.unwrap_or(Value::Null);
    serde_json::to_vec(&output).expect("JSON values serialize")
}

/// Checks a rules file's UTF-8 text: `{"canonical": "..."}`, or
/// `{"diagnostics": [{code, path, message}]}` with every problem found.
pub fn inspect(input: &[u8]) -> Vec<u8> {
    let output = match std::str::from_utf8(input)
        .map_err(|_| fail("invalid-unicode", "", "Comparator files are UTF-8"))
        .and_then(Comparator::from_yaml)
    {
        Ok(comparator) => {
            let mut report = json!({"canonical": comparator.canonical});
            if !comparator.warnings().is_empty() {
                report["warnings"] = diagnostics(&comparator.warnings().to_vec());
            }
            report
        }
        Err(failure) => json!({"diagnostics": diagnostics(&failure)}),
    };
    serde_json::to_vec(&output).expect("JSON values serialize")
}
