//! Tools that check projections, run comparator tests and prepare the environment.

use std::{fmt::Write as _, time::Duration};

use serde_json::{Value, json};

use super::{Answer, Failure, OnDrop, Outcome, POLL, get, plural, post, text};
use crate::service::Service;

pub(super) async fn prepare(service: &Service, input: &Value) -> Answer {
    let mut body = json!({});
    for key in ["revision", "steps", "force"] {
        if !input[key].is_null() {
            body[key] = input[key].clone();
        }
    }
    let created = post(service, "/api/prepare", &body).await?;
    let id = text(&created["id"]).to_owned();
    let mut cancel = OnDrop(Some({
        let id = id.clone();
        move || service.cancel_prepare(&id)
    }));
    let run = loop {
        let run = get(service, &format!("/api/prepare/{id}")).await?;
        if run["status"] != "running" {
            break run;
        }
        tokio::time::sleep(POLL).await;
    };
    cancel.disarm();
    if run["status"] != "succeeded" {
        let log = text(&run["log"]);
        let tail: Vec<&str> = log.lines().collect();
        return Err(Failure(format!(
            "Preparing {}: {}{}",
            text(&run["status"]),
            text(&run["error"]),
            if tail.is_empty() {
                String::new()
            } else {
                format!("\nThe log ends:\n{}", tail[tail.len().saturating_sub(20)..].join("\n"))
            }
        )));
    }
    let report = &run["report"];
    let mut summary = format!(
        "Prepared {} ({}):\n",
        if report["target"] == "working-tree" {
            "the working tree".to_owned()
        } else {
            format!("the workspace for {}", text(&report["target"]))
        },
        text(&report["root"])
    );
    for step in report["steps"].as_array().into_iter().flatten() {
        let _ = writeln!(
            summary,
            "- {}: {}",
            text(&step["id"]),
            if step["status"] == "current" {
                "up to date".to_owned()
            } else {
                format!("ran in {} ms", step["durationMs"])
            }
        );
    }
    Ok(Outcome::new(summary, report.clone()))
}

pub(super) async fn check(service: &Service, input: &Value) -> Answer {
    let runner = service.runner().without_trials();
    let ids: Vec<String> = input["projections"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|id| id.as_str().map(str::to_owned))
        .collect();
    let cancel = runner.cancel.clone();
    let _cancel = OnDrop(Some(move || cancel.store(true, std::sync::atomic::Ordering::SeqCst)));
    let options = crate::check::Options {
        ids,
        render: input["render"] == true,
        browser: None,
        png: None,
        from: None,
        timeout: Duration::from_secs(60),
        cancel: runner.cancel.clone(),
        update: false,
        coverage: false,
        parity: None,
        strict_determinism: false,
    };
    let report = crate::check::check(&runner, options).await?;
    let projections: Vec<Value> = report["projections"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|projection| {
            let steps: Vec<Value> = projection["steps"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|step| json!({"id": step["id"], "title": step["title"], "status": step["status"], "message": step["message"]}))
                .collect();
            json!({"id": projection["id"], "title": projection["title"], "ok": projection["ok"], "steps": steps})
        })
        .collect();
    let mut outcome = Outcome::new(crate::check::text(&report), json!({"ok": report["ok"], "projections": projections}));
    outcome.error = report["ok"] != true;
    Ok(outcome)
}

/// A comparator test run's results: per file and projection, counts and failures.
pub(super) fn summarize_tests(results: &Value) -> (String, Value) {
    let mut out = String::new();
    let mut items = Vec::new();
    let results: Vec<&Value> = results["results"].as_array().into_iter().flatten().collect();
    if results.is_empty() {
        out.push_str("No comparator tests here: add X.comparator.test.yaml beside a comparator file X.comparator.yaml.\n");
    }
    for result in &results {
        let cases: Vec<&Value> = result["cases"].as_array().into_iter().flatten().collect();
        let count = |status: &str| cases.iter().filter(|case| case["status"] == status).count();
        let (passed, failed, skipped) = (count("pass"), count("fail"), count("skip"));
        let diagnostics = result["diagnostics"].as_array().map_or(0, Vec::len);
        let _ = writeln!(
            out,
            "{} ({}): {}",
            text(&result["path"]),
            result["projection"]
                .as_str()
                .map(|id| format!("projection {id}"))
                .unwrap_or_else(|| "no projection".to_owned()),
            if diagnostics > 0 {
                format!("the test file is invalid ({})", plural(diagnostics, "problem", "problems"))
            } else {
                format!("{passed} pass, {failed} fail, {skipped} skip")
            }
        );
        out.push_str(&crate::comparator_tests::text(result));
        for case in cases.iter().filter(|case| case["status"] == "skip") {
            let _ = writeln!(out, "         skip {}: {}", text(&case["name"]), text(&case["message"]));
        }
        if let Some(written) = result["written"].as_array() {
            let names: Vec<&str> = written.iter().filter_map(Value::as_str).collect();
            let _ = writeln!(out, "  wrote {}", names.join(", "));
        }
        let summary: Vec<Value> = cases
            .iter()
            .map(|case| json!({"name": case["name"], "status": case["status"], "message": case["message"]}))
            .collect();
        let mut item = json!({"path": result["path"], "projection": result["projection"], "passed": passed,
            "failed": failed, "skipped": skipped, "diagnostics": result["diagnostics"], "cases": summary,
            "written": result["written"]});
        if let Some(coverage) = result.get("coverage").filter(|coverage| !coverage["summary"].is_null()) {
            let _ = writeln!(
                out,
                "  coverage of {}: {}",
                text(&coverage["comparator"]),
                projections_rules_yaml::coverage::summary_text(&coverage["summary"])
            );
            item["coverage"] = json!({"comparator": coverage["comparator"], "summary": coverage["summary"],
                "uncovered": coverage["uncovered"], "excluded": coverage["excluded"]});
        }
        items.push(item);
    }
    let ok = items.iter().all(|item| item["failed"] == 0 && item["diagnostics"].is_null());
    (out, json!({"ok": ok, "results": items}))
}

pub(super) fn tests_request(input: &Value) -> Value {
    let mut body = json!({});
    for key in ["path", "cases", "projection", "coverage"] {
        if !input[key].is_null() {
            body[key] = input[key].clone();
        }
    }
    body
}

pub(super) async fn run_comparator_tests(service: &Service, input: &Value) -> Answer {
    let results = post(service, "/api/comparator-tests/run", &tests_request(input)).await?;
    let (text, structured) = summarize_tests(&results);
    let mut outcome = Outcome::new(text, structured);
    outcome.error = outcome.structured["ok"] != true;
    Ok(outcome)
}
