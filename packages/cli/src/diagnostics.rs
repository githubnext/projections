//! Failures as structured, actionable reports: what failed (a stable code),
//! where (engine diagnostics with JSON paths), the evidence (an extractor's
//! exit status and stderr) and what to do next. The CLI prints them as text or,
//! with `--json`, as a `projections.error` document; the Inspector shows the
//! same diagnostics.

use crate::runtime::{ProcessFailure, TrustRequired};
use serde_json::{Value, json};

/// Engine diagnostics carried by an error (`Engine rejected input: [...]`),
/// normalized to `{severity, code, path, message, entityId?}`.
pub fn engine_diagnostics(error: &anyhow::Error) -> Option<Vec<Value>> {
    for cause in error.chain() {
        let Some(raw) = cause.to_string().strip_prefix("Engine rejected input: ").map(str::to_owned) else {
            continue;
        };
        let Ok(values) = serde_json::from_str::<Vec<Value>>(&raw) else {
            continue;
        };
        if values.is_empty()
            || !values
                .iter()
                .all(|value| ["code", "path", "message"].iter().all(|key| value[*key].is_string()))
        {
            continue;
        }
        return Some(
            values
                .into_iter()
                .map(|value| {
                    let mut normalized = json!({
                        "severity": if value["severity"] == "warning" { "warning" } else { "error" },
                        "code": value["code"], "path": value["path"], "message": value["message"],
                    });
                    if value["entityId"].is_string() {
                        normalized["entityId"] = value["entityId"].clone();
                    }
                    normalized
                })
                .collect(),
        );
    }
    None
}

/// The diagnostics an Inspector job reports for a failure.
pub fn error_diagnostics(error: &anyhow::Error) -> Vec<Value> {
    engine_diagnostics(error).unwrap_or_else(|| vec![crate::runtime::diagnostic(error)])
}

/// A failure report: `{code, message, hint?, diagnostics, stderr?}`.
pub fn report(error: &anyhow::Error) -> Value {
    let message = format!("{error:#}");
    if error.chain().any(|cause| cause.is::<TrustRequired>()) {
        return json!({
            "code": "TRUST_REQUIRED",
            "message": message,
            "hint": "This projection runs repository code. Review it, then add --trust.",
            "diagnostics": [],
        });
    }
    if let Some(failure) = error
        .chain()
        .find_map(|cause| cause.downcast_ref::<ProcessFailure>())
        .filter(|failure| !failure.is_git())
    {
        let hint = if failure.timed_out() {
            "The extractor ran out of time. Raise execution.timeoutMs in its definition (30000 by default, at most 300000), or narrow what it reads with execution.scope."
        } else {
            "The extractor failed; its stderr says why. Run it yourself with a request on stdin to debug (projections help authoring)."
        };
        let mut report = json!({
            "code": "EXTRACTOR_FAILED",
            "message": failure.message(),
            "hint": hint,
            "diagnostics": [],
        });
        let stderr = failure.stderr();
        if !stderr.is_empty() {
            report["stderr"] = json!(stderr);
        }
        return report;
    }
    if let Some(diagnostics) = engine_diagnostics(error) {
        let invalid_extraction = diagnostics
            .iter()
            .any(|diagnostic| diagnostic["path"].as_str().is_some_and(|path| path.starts_with('/')));
        return json!({
            "code": if invalid_extraction { "INVALID_EXTRACTION" } else { "INVALID_INPUT" },
            "message": message,
            "hint": "Fix what each diagnostic names (path is a JSON pointer into the extraction), then run again.",
            "diagnostics": diagnostics,
        });
    }
    json!({"code": "ERROR", "message": message, "diagnostics": []})
}

/// A failure report as text for a terminal: the message, then diagnostics,
/// stderr and the hint.
pub fn text(report: &Value) -> String {
    let mut text = format!("projections: {}\n", report["message"].as_str().unwrap_or_default());
    for diagnostic in report["diagnostics"].as_array().into_iter().flatten() {
        let path = diagnostic["path"].as_str().unwrap_or_default();
        text.push_str(&format!(
            "  {} {}{}: {}\n",
            diagnostic["severity"].as_str().unwrap_or("error"),
            diagnostic["code"].as_str().unwrap_or_default(),
            if path.is_empty() { String::new() } else { format!(" at {path}") },
            diagnostic["message"].as_str().unwrap_or_default()
        ));
    }
    if let Some(hint) = report["hint"].as_str() {
        text.push_str(&format!("hint: {hint}\n"));
    }
    text
}

/// The `projections.error` document `--json` prints for a failure.
pub fn document(report: Value) -> Value {
    json!({"format": "projections.error", "version": 0, "error": report})
}
