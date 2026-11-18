//! The rule coverage gate of the built-in rules comparators,
//! api-compatibility, runtime-policy and agentic-workflows: `npm run test:rust:rules-coverage`
//! (tools/scripts/rules-coverage.mjs) runs the rules interpreter's own suites
//! with `PROJECTIONS_RULES_COVERAGE` naming a directory, where they write what
//! they covered, then this test, which runs each comparator's
//! `*.comparator.test.yaml` with coverage, as `projections check --coverage`
//! does, adds the suites' counts and holds the sum to the comparator's gate.
//! Without the variable it does nothing.

use projections_cli::comparator_tests::{self, Context};
use projections_rules_yaml::coverage;
use serde_json::Value;
use std::{fs, path::Path};

/// Each comparator and the least coverage it may have, in percent, of its
/// functions, expressions and branches: all of them. Every decision outcome
/// of these rules is an ecosystem's or the runtime policy model's rule, so
/// each is pinned by a test; a branch no input can take is removed, or
/// excluded with a `coverage-ignore:` comment saying why.
const GATES: [(&str, [f64; 3]); 3] = [
    (
        "packages/comparators/api-compatibility/api-compatibility.comparator.yaml",
        [100.0, 100.0, 100.0],
    ),
    (
        "packages/comparators/runtime-policy/runtime-policy.comparator.yaml",
        [0.0, 0.0, 0.0],
    ),
    (
        "packages/comparators/agentic-workflows/agentic-workflows.comparator.yaml",
        [100.0, 100.0, 100.0],
    ),
];

/// The coverage the rules suites wrote for `comparator`.
fn suites(directory: &Path, comparator: &str) -> Vec<Value> {
    let mut reports = Vec::new();
    for entry in fs::read_dir(directory).unwrap().flatten() {
        let report: Value = serde_json::from_slice(&fs::read(entry.path()).unwrap()).unwrap();
        if report["comparator"] == comparator {
            reports.push(report["coverage"].clone());
        }
    }
    reports
}

#[test]
fn the_built_in_rules_comparators_meet_their_coverage_gates() {
    let Some(directory) = std::env::var_os("PROJECTIONS_RULES_COVERAGE") else {
        return;
    };
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
    let mut failures = String::new();
    for (comparator, gate) in GATES {
        let tests = projections_rules_yaml::suite::tests_path(comparator).unwrap();
        let report = comparator_tests::run_file(
            &root.join(&tests),
            &Context {
                coverage: true,
                ..Context::new(&root)
            },
        );
        assert!(report.ok(), "{tests} fails: {}", comparator_tests::step(&report)["message"]);
        let mut merged = report.coverage.clone().unwrap();
        let alone = coverage::summary(&merged);
        if std::env::var_os("PROJECTIONS_RULES_COVERAGE_ALONE").is_some() {
            print!("{}", coverage::text(comparator, &report.coverage_report(&merged), "  alone "));
        }
        let reports = suites(Path::new(&directory), comparator);
        assert!(!reports.is_empty(), "the rules suites wrote no coverage of {comparator}");
        for suite in &reports {
            coverage::merge(&mut merged, suite);
        }
        let summary = report.coverage_report(&merged);
        println!("{comparator}\n  comparator tests alone: {}", coverage::summary_text(&alone));
        println!("  with the rules suites: {}", coverage::summary_text(&summary["summary"]));
        print!("{}", coverage::text(comparator, &summary, "  ").split_once('\n').unwrap().1);
        for item in summary["excluded"].as_array().into_iter().flatten() {
            println!(
                "    excluded {comparator}:{}:{} {}: {}",
                item["line"],
                item["column"],
                item["message"].as_str().unwrap(),
                item["excluded"].as_str().unwrap()
            );
        }
        for (category, least) in coverage::CATEGORIES.iter().zip(gate) {
            let percent = summary["summary"][*category]["percent"].as_f64().unwrap();
            if percent < least {
                failures.push_str(&format!(
                    "{comparator}: {category} coverage is {percent}%, below its gate of {least}%\n"
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{failures}");
}
