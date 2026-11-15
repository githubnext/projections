//! `projections-rules --interpreter rules.wasm`: runs comparator rules for a
//! host process, sandboxed in wasmi under `Limits::rules()` (fuel and a
//! 256 MiB memory cap), exactly as the CLI runs them. A server spawns one per
//! request, as it spawns the native Engine.
//!
//! Reads one JSON request from stdin and writes one JSON response to stdout:
//!
//! - `{"operation": "check", "rules": "<text>"}` → `{"ok": true, "result": {"digest", "canonical", "warnings"}}`
//! - `{"operation": "compare", "rules": "<text>", "input": {protocolVersion, before, after, baseline, options}}`
//!   → `{"ok": true, "result": <comparison>}`
//!
//! A failure is `{"ok": false, "error": {"code", "message"}}`, with the
//! runtime's error codes (`invalid-module` for invalid rules, `out-of-fuel`,
//! `memory-limit`, `comparator-error`, ...). The comparison is not validated
//! here; the host validates it with the Engine.

use projections_comparator_runtime::{ComparatorError, ComparatorModule, Limits};
use serde_json::{Value, json};
use std::io::{Read, Write};

const MAX_REQUEST_BYTES: u64 = 40 * 1024 * 1024;

fn main() {
    let response = match respond() {
        Ok(result) => json!({"ok": true, "result": result}),
        Err((code, message)) => json!({"ok": false, "error": {"code": code, "message": message}}),
    };
    let mut stdout = std::io::stdout().lock();
    let written = serde_json::to_writer(&mut stdout, &response)
        .map_err(std::io::Error::other)
        .and_then(|()| stdout.flush());
    if written.is_err() {
        std::process::exit(2);
    }
}

fn respond() -> Result<Value, (&'static str, String)> {
    let mut args = std::env::args().skip(1);
    let interpreter = match (args.next().as_deref(), args.next(), args.next()) {
        (Some("--interpreter"), Some(path), None) => path,
        _ => {
            return Err(("usage", "projections-rules --interpreter <rules.wasm>".to_owned()));
        }
    };
    let interpreter = std::fs::read(&interpreter).map_err(|error| ("invalid-module", format!("{interpreter}: {error}")))?;
    let mut request = Vec::new();
    std::io::stdin()
        .take(MAX_REQUEST_BYTES + 1)
        .read_to_end(&mut request)
        .map_err(|error| ("invalid-input", error.to_string()))?;
    if request.len() as u64 > MAX_REQUEST_BYTES {
        return Err(("input-too-large", "the request exceeds 40 MiB".to_owned()));
    }
    let request: Value =
        serde_json::from_slice(&request).map_err(|error| ("invalid-input", format!("the request is not JSON: {error}")))?;
    let rules = request["rules"]
        .as_str()
        .ok_or(("invalid-input", "`rules` must be the rules' text".to_owned()))?;
    let failure = |error: ComparatorError| (error.code(), error.to_string());
    let module = ComparatorModule::load(&interpreter).map_err(failure)?;
    match request["operation"].as_str() {
        Some("check") => {
            let checked = ComparatorModule::rules(&module, rules.as_bytes()).map_err(failure)?;
            Ok(json!({
                "digest": checked.digest(),
                "canonical": checked.rules_canonical(),
                "warnings": checked.rules_warnings(),
            }))
        }
        Some("compare") => {
            let mut input = request["input"].clone();
            let Some(fields) = input.as_object_mut() else {
                return Err(("invalid-input", "`input` must be an object".to_owned()));
            };
            // The interpreter takes the rules and the definition's options together.
            let options = fields.remove("options").unwrap_or_else(|| json!({}));
            fields.insert("options".into(), json!({"rules": rules, "options": options}));
            module.compare(&input, &Limits::rules()).map_err(failure)
        }
        _ => Err(("invalid-input", "`operation` must be check or compare".to_owned())),
    }
}
