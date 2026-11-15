//! `update_snapshots`: previewing and, once confirmed, rewriting the comparator
//! test snapshots that differ from what the comparator produces.

use std::fmt::Write as _;

use serde_json::{Value, json};

use crate::{
    service::Service,
    tools::{
        Answer, Host, Outcome, TRUST_HINT,
        checks::{summarize_tests, tests_request},
        confirm_hint, plural, post, text, token,
    },
};

/// The snapshots a comparator test run finds different: `(test file, projection, case, failure)`.
fn snapshot_failures(results: &Value) -> Vec<Value> {
    let mut found = Vec::new();
    for result in results["results"].as_array().into_iter().flatten() {
        for case in result["cases"].as_array().into_iter().flatten() {
            for failure in case["failures"].as_array().into_iter().flatten() {
                if text(&failure["expectation"]).ends_with("/snapshot") {
                    found.push(json!({"path": result["path"], "projection": result["projection"],
                        "case": case["name"], "message": failure["message"], "diff": failure["diff"]}));
                }
            }
        }
    }
    found
}

pub(in crate::tools) async fn update_snapshots(service: &Service, host: Host, input: &Value) -> Answer {
    let mut body = tests_request(input);
    let results = post(service, "/api/comparator-tests/run", &body).await?;
    let differing = snapshot_failures(&results);
    let serialized: Vec<String> = differing.iter().map(Value::to_string).collect();
    let confirm = token("update_snapshots", &serialized.iter().map(String::as_str).collect::<Vec<_>>());
    let mut structured = json!({"written": [], "snapshots": differing});
    if differing.is_empty() {
        let (summary, _) = summarize_tests(&results);
        return Ok(Outcome::new(
            format!("Every snapshot matches what the comparator produces; nothing to update.\n{summary}"),
            structured,
        ));
    }
    let mut previewed = format!(
        "{} differ from what the comparator produces now:\n",
        plural(differing.len(), "snapshot", "snapshots")
    );
    for snapshot in &differing {
        let _ = writeln!(
            previewed,
            "- {} case {}{}: {}",
            text(&snapshot["path"]),
            text(&snapshot["case"]),
            snapshot["projection"]
                .as_str()
                .map(|id| format!(" (projection {id})"))
                .unwrap_or_default(),
            text(&snapshot["message"])
        );
        for line in text(&snapshot["diff"]).lines().take(40) {
            let _ = writeln!(previewed, "    {line}");
        }
    }
    previewed.push_str("Updating makes this output what the tests expect: confirm only if it is right.\n");
    match input["confirm"].as_str() {
        None => {
            structured["confirm"] = json!(confirm);
            if !service.trusted() {
                let _ = writeln!(previewed, "Writing snapshots needs trust. {TRUST_HINT}.");
            }
            previewed.push_str(&confirm_hint(host, "update_snapshots", &confirm));
            Ok(Outcome::new(previewed, structured))
        }
        Some(given) if given != confirm => {
            structured["confirm"] = json!(confirm);
            let mut outcome = Outcome::new(
                format!(
                    "Not written: the snapshots or the comparator changed since the preview that was confirmed. Now {previewed}{}",
                    confirm_hint(host, "update_snapshots", &confirm)
                ),
                structured,
            );
            outcome.error = true;
            Ok(outcome)
        }
        Some(_) => {
            body["update"] = json!(true);
            let written = post(service, "/api/comparator-tests/run", &body).await?;
            let files: Vec<Value> = written["results"]
                .as_array()
                .into_iter()
                .flatten()
                .flat_map(|result| result["written"].as_array().cloned().unwrap_or_default())
                .collect();
            let names: Vec<&str> = files.iter().filter_map(Value::as_str).collect();
            structured["written"] = json!(files);
            Ok(Outcome::new(
                format!(
                    "Wrote {}: {}. Run run_comparator_tests to see them pass.\n",
                    plural(names.len(), "snapshot", "snapshots"),
                    names.join(", ")
                ),
                structured,
            ))
        }
    }
}
