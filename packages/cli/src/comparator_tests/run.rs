//! Running a test file's cases and judging their comparisons and snapshots.

use super::{
    Context, MAX_FIXTURE_BYTES, MAX_RULES_BYTES, Report,
    paths::{inside, relative},
    sources::{Run, Skipped},
};
use crate::{artifact, runtime::read_regular};
use anyhow::{Context as _, Result, bail};
use projections_rules_yaml::suite::{self, Case, Outcome, Suite};
use serde_json::{Value, json};
use std::{collections::HashMap, fs, path::Path, time::Instant};

pub(super) fn location(path: &str, location: suite::Location) -> Value {
    json!({"path": path, "line": location.line, "column": location.column})
}

fn failure_json(path: &str, failure: &suite::Failure) -> Value {
    let mut value = failure.to_json();
    value["location"] = location(path, failure.location);
    value
}

/// A test file's diagnostics, located in it.
fn diagnostics(path: &str, diagnostics: &[suite::Diagnostic]) -> Vec<Value> {
    diagnostics
        .iter()
        .map(|diagnostic| {
            json!({"pointer": diagnostic.pointer, "message": diagnostic.message,
                "location": location(path, diagnostic.location)})
        })
        .collect()
}

/// Reads and parses a test file: its suite, or located diagnostics.
pub(super) fn read_suite(root: &Path, tests: &Path) -> Result<Suite, Vec<Value>> {
    let path = relative(root, tests);
    let text = read_regular(tests, suite::MAX_BYTES)
        .map_err(|error| format!("{error:#}"))
        .and_then(|bytes| String::from_utf8(bytes).map_err(|_| "The file is not UTF-8".into()));
    match text {
        Ok(text) => suite::parse(&text).map_err(|found| diagnostics(&path, &found)),
        Err(message) => Err(vec![json!({"pointer": "", "message": message,
            "location": location(&path, suite::Location { line: 1, column: 1 })})]),
    }
}

/// Runs the test file `tests` (an absolute path) beside its comparator file.
pub fn run_file(tests: &Path, context: &Context<'_>) -> Report {
    let root = context.root;
    let path = relative(root, tests);
    let rules = suite::rules_path(&path).unwrap_or_default();
    let mut report = Report {
        path: path.clone(),
        rules: rules.clone(),
        projection: context
            .projection
            .and_then(|definition| definition["id"].as_str().map(str::to_owned)),
        diagnostics: Vec::new(),
        cases: Vec::new(),
        written: Vec::new(),
        coverage: context.coverage.then_some(Value::Null),
    };
    let suite = match read_suite(root, tests) {
        Ok(suite) => suite,
        Err(diagnostics) => {
            report.diagnostics = diagnostics;
            return report;
        }
    };
    if let Some(names) = context.cases
        && let Some(unknown) = names.iter().find(|name| !suite.cases.iter().any(|case| &case.name == *name))
    {
        report.diagnostics = vec![json!({"pointer": "/cases",
                "message": format!("{path} has no case named {unknown}"),
                "location": location(&path, suite.location("/cases"))})];
        return report;
    }
    let bytes = read_regular(&root.join(&rules), MAX_RULES_BYTES);
    let mut run = Run {
        context,
        tests: tests.to_path_buf(),
        revisions: HashMap::new(),
    };
    for case in &suite.cases {
        if context.cases.is_some_and(|names| !names.iter().any(|name| name == &case.name)) {
            continue;
        }
        let started = Instant::now();
        let mut result = run_case(&mut run, &suite, case, &rules, &bytes, &path, &mut report);
        result["durationMs"] = json!(started.elapsed().as_millis() as u64);
        report.cases.push(result);
    }
    report
}

fn run_case(run: &mut Run<'_>, suite: &Suite, case: &Case, rules: &str, bytes: &Result<Vec<u8>>, path: &str, report: &mut Report) -> Value {
    let mut result = json!({"id": case.name, "name": case.name, "status": "pass",
        "location": location(path, case.location), "failures": []});
    let fail = |result: &mut Value, pointer: String, message: String| {
        result["status"] = json!("fail");
        result["message"] = json!(message.clone());
        result["failures"] = json!([{"expectation": pointer, "message": message,
            "location": location(path, suite.location(&pointer))}]);
    };
    let mut sides = Vec::new();
    for (key, source) in [("before", &case.before), ("after", &case.after)] {
        match run.source(source) {
            Ok(value) => sides.push(value),
            Err(error) if error.is::<Skipped>() => {
                result["status"] = json!("skip");
                result["message"] = json!(error.to_string());
                return result;
            }
            Err(error) => {
                fail(&mut result, format!("/cases/{}/{key}", case.index), format!("{key}: {error:#}"));
                return result;
            }
        }
    }
    let bytes = match bytes {
        Ok(bytes) => bytes,
        Err(error) => {
            fail(
                &mut result,
                format!("/cases/{}", case.index),
                format!("Cannot read the comparator file {rules}: {error:#}"),
            );
            return result;
        }
    };
    let options = suite
        .options(case)
        .cloned()
        .or_else(|| {
            run.context
                .projection
                .and_then(|definition| definition["comparator"].get("options").cloned())
        })
        .unwrap_or_else(|| json!({}));
    let outcome = if run.context.coverage {
        let (outcome, coverage) = artifact::run_custom_comparator_with_coverage(rules, bytes, &sides[0], &sides[1], &options);
        if let (Some(merged), Some(coverage)) = (report.coverage.as_mut(), coverage) {
            projections_rules_yaml::coverage::merge(merged, &coverage);
        }
        outcome
    } else {
        artifact::run_custom_comparator(rules, bytes, &sides[0], &sides[1], &options).map(|(comparison, _)| comparison)
    };
    let outcome = outcome.map_err(|error| format!("{error:#}"));
    let mut failures: Vec<Value> = suite
        .evaluate(
            case,
            match &outcome {
                Ok(comparison) => Outcome::Comparison(comparison),
                Err(message) => Outcome::Error(message),
            },
        )
        .iter()
        .map(|failure| failure_json(path, failure))
        .collect();
    if let (Some(name), Ok(comparison)) = (&case.snapshot, &outcome) {
        match snapshot(run, suite, case, name, comparison, path, report) {
            Ok(Some(failure)) => failures.push(failure),
            Ok(None) => {}
            Err(error) => {
                let pointer = format!("/cases/{}/snapshot", case.index);
                failures.push(json!({"expectation": pointer,
                    "message": format!("{error:#}"),
                    "location": location(path, suite.location(&pointer))}));
            }
        }
    }
    if !failures.is_empty() {
        result["status"] = json!("fail");
        result["message"] = json!(failures[0]["message"].clone());
        result["failures"] = json!(failures);
    }
    result
}

/// Checks a case's snapshot, or writes it with `update`.
fn snapshot(
    run: &Run<'_>,
    suite: &Suite,
    case: &Case,
    name: &str,
    comparison: &Value,
    path: &str,
    report: &mut Report,
) -> Result<Option<Value>> {
    let root = run.context.root;
    let file = inside(root, &run.tests, name)?;
    let existing = match fs::symlink_metadata(&file) {
        Ok(metadata) if metadata.is_file() => {
            Some(String::from_utf8(read_regular(&file, MAX_FIXTURE_BYTES)?).with_context(|| format!("The snapshot {name} is not UTF-8"))?)
        }
        Ok(_) => bail!("The snapshot {name} is not a regular file"),
        Err(_) => None,
    };
    let text = suite::snapshot(comparison);
    if run.context.update {
        if existing.as_deref() != Some(text.as_str()) {
            if let Some(parent) = file.parent() {
                fs::create_dir_all(parent).with_context(|| format!("Cannot create {}", parent.display()))?;
            }
            // Recheck once the directories exist, in case one is a link.
            inside(root, &run.tests, name)?;
            fs::write(&file, &text).with_context(|| format!("Cannot write {name}"))?;
            report.written.push(relative(root, &file));
        }
        return Ok(None);
    }
    Ok(suite
        .check_snapshot(case, comparison, existing.as_deref())
        .map(|failure| failure_json(path, &failure)))
}
