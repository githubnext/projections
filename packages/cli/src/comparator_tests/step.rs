//! A test file's report as a `projections check` step, and as text.

use super::{Context, Report, STEP, TITLE, run::run_file};
use crate::{artifact, runtime::Runner};
use projections_rules_yaml::suite;
use serde_json::{Value, json};
use std::path::Path;

fn plural(count: usize, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

/// The `comparator-tests` step of `projections check` for one definition.
pub fn check_step(root: &Path, runner: &Runner, definition: &Value, update: bool, coverage: bool) -> Value {
    if artifact::custom_comparator(definition).is_none() {
        return json!({"id": STEP, "title": TITLE, "status": "skip",
            "message": "The default comparator: there is no custom comparator to test"});
    }
    let Some(rules) = crate::project::comparator_file(definition) else {
        return json!({"id": STEP, "title": TITLE, "status": "skip",
            "message": "The comparator file is outside the repository"});
    };
    let Some(tests) = suite::tests_path(&rules) else {
        return json!({"id": STEP, "title": TITLE, "status": "skip",
            "message": format!("{rules} is not a comparator file")});
    };
    if !root.join(&tests).is_file() {
        return json!({"id": STEP, "title": TITLE, "status": "warn", "file": tests,
            "message": format!("No tests beside {rules}: add {tests} (projections help authoring)")});
    }
    let report = run_file(
        &root.join(&tests),
        &Context {
            root,
            projection: Some(definition),
            runner: Some(runner),
            update,
            cases: None,
            coverage,
        },
    );
    step(&report)
}

/// A report as a check step.
pub fn step(report: &Report) -> Value {
    let mut value = json!({"id": STEP, "title": TITLE, "file": report.path, "cases": report.cases});
    if !report.diagnostics.is_empty() {
        let first = &report.diagnostics[0];
        value["status"] = json!("fail");
        value["message"] = json!(format!(
            "{} is invalid: {}:{}: {}{}",
            report.path,
            first["location"]["line"],
            first["location"]["column"],
            first["message"].as_str().unwrap_or_default(),
            if report.diagnostics.len() > 1 {
                format!(" (and {} more)", report.diagnostics.len() - 1)
            } else {
                String::new()
            }
        ));
        value["diagnostics"] = json!(report.diagnostics);
        return value;
    }
    let total = report.cases.len();
    let (passed, failed, skipped) = (report.count("pass"), report.count("fail"), report.count("skip"));
    let mut message = if failed > 0 {
        format!(
            "{failed} of {} failed: {}",
            plural(total, "case", "cases"),
            report
                .cases
                .iter()
                .filter(|case| case["status"] == "fail")
                .filter_map(|case| case["name"].as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )
    } else {
        plural(passed, "case passes", "cases pass")
    };
    if skipped > 0 {
        message.push_str(&format!(
            "; {} skipped: {}",
            skipped,
            report
                .cases
                .iter()
                .find(|case| case["status"] == "skip")
                .and_then(|case| case["message"].as_str())
                .unwrap_or_default()
        ));
    }
    if !report.written.is_empty() {
        message.push_str(&format!("; wrote {}", report.written.join(", ")));
        value["written"] = json!(report.written);
    }
    if let Some(coverage) = &report.coverage {
        let coverage = report.coverage_report(coverage);
        if !coverage["summary"].is_null() {
            message.push_str(&format!(
                "; coverage: {}",
                projections_rules_yaml::coverage::summary_text(&coverage["summary"])
            ));
        }
        value["coverage"] = coverage;
    }
    value["status"] = json!(if failed > 0 { "fail" } else { "pass" });
    value["message"] = json!(message);
    value
}

/// The failed cases and file diagnostics of a step, as indented text, and
/// what its rules' coverage left uncovered.
pub fn text(step: &Value) -> String {
    let mut text = String::new();
    let at = |location: &Value| {
        format!(
            "{}:{}:{}",
            location["path"].as_str().unwrap_or_default(),
            location["line"],
            location["column"]
        )
    };
    for diagnostic in step["diagnostics"].as_array().into_iter().flatten() {
        text.push_str(&format!(
            "         {}: {}\n",
            at(&diagnostic["location"]),
            diagnostic["message"].as_str().unwrap_or_default()
        ));
    }
    for case in step["cases"].as_array().into_iter().flatten() {
        if case["status"] != "fail" {
            continue;
        }
        text.push_str(&format!(
            "         fail {} ({})\n",
            case["name"].as_str().unwrap_or_default(),
            at(&case["location"])
        ));
        for failure in case["failures"].as_array().into_iter().flatten() {
            text.push_str(&format!(
                "           {} {}: {}\n",
                at(&failure["location"]),
                failure["expectation"].as_str().unwrap_or_default(),
                failure["message"].as_str().unwrap_or_default()
            ));
            for line in failure["diff"].as_str().unwrap_or_default().lines() {
                text.push_str(&format!("             {line}\n"));
            }
        }
    }
    let coverage = &step["coverage"];
    if !coverage["summary"].is_null() {
        for item in coverage["uncovered"].as_array().into_iter().flatten() {
            text.push_str(&format!(
                "         uncovered {}:{}:{} {}\n",
                coverage["comparator"].as_str().unwrap_or_default(),
                item["line"],
                item["column"],
                item["message"].as_str().unwrap_or_default()
            ));
        }
    }
    text
}
