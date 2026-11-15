//! Comparator tests: the `*.comparator.test.yaml` file beside a comparator file
//! (see `docs/contracts/comparisons.md`, "Comparator tests"). This module finds them,
//! resolves each case's extractions, runs the comparator in the sandboxed rules
//! interpreter, exactly as viewers do, and judges the comparisons with
//! `projections_rules_yaml::suite`. Comparator rules are never evaluated natively.
//!
//! `projections check` runs them as its `comparator-tests` step; the
//! Inspector API lists and runs them (`GET /api/comparator-tests`, `POST
//! /api/comparator-tests/run`), for editors' test views.

mod api;
mod paths;
mod run;
mod sources;
mod step;

pub use api::{RunRequest, list, run};
pub use run::run_file;
pub use step::{check_step, step, text};

use crate::runtime::Runner;
use projections_rules_yaml::suite;
use serde_json::{Value, json};
use std::path::Path;

/// The step ID in a `projections.check` report.
pub const STEP: &str = "comparator-tests";
const TITLE: &str = "Comparator tests";
/// Largest fixture or snapshot file read.
const MAX_FIXTURE_BYTES: usize = 64 * 1024 * 1024;
const MAX_RULES_BYTES: usize = 1024 * 1024;

/// What a test file runs with.
pub struct Context<'a> {
    /// The repository's root: every fixture and snapshot must be inside it.
    pub root: &'a Path,
    /// The projection whose rules these are: its definition's comparator
    /// options are the default options, and its working-tree definition
    /// extracts `revision` sources. Without one, revision cases are skipped.
    pub projection: Option<&'a Value>,
    /// Extracts revisions for the projection; its trust decides whether a
    /// repository extractor may run.
    pub runner: Option<&'a Runner>,
    /// Write every case's snapshot (never its expectations).
    pub update: bool,
    /// Only these cases, by name.
    pub cases: Option<&'a [String]>,
    /// Measure rule coverage: which of the comparator file's functions,
    /// expressions and branches the cases run.
    pub coverage: bool,
}

impl<'a> Context<'a> {
    /// A context for `root` alone: no projection, no revisions.
    pub fn new(root: &'a Path) -> Self {
        Self {
            root,
            projection: None,
            runner: None,
            update: false,
            cases: None,
            coverage: false,
        }
    }
}

/// One test file's run.
#[derive(Debug, Clone)]
pub struct Report {
    /// The test file, relative to the repository root.
    pub path: String,
    /// Its comparator file, relative to the repository root.
    pub rules: String,
    pub projection: Option<String>,
    /// Problems with the test file itself; nothing ran when there are any.
    pub diagnostics: Vec<Value>,
    pub cases: Vec<Value>,
    /// Snapshots written by `update`, relative to the repository root.
    pub written: Vec<String>,
    /// With `coverage`, the `projections.rules-coverage` report of every case
    /// run, merged; `null` when no case ran the rules.
    pub coverage: Option<Value>,
}

impl Report {
    /// Whether the file is valid and no case failed.
    pub fn ok(&self) -> bool {
        self.diagnostics.is_empty() && self.cases.iter().all(|case| case["status"] != "fail")
    }

    fn count(&self, status: &str) -> usize {
        self.cases.iter().filter(|case| case["status"] == status).count()
    }

    pub fn to_json(&self) -> Value {
        let mut value = json!({"path": self.path, "comparator": self.rules,
            "projection": self.projection, "cases": self.cases});
        if !self.diagnostics.is_empty() {
            value["diagnostics"] = json!(self.diagnostics);
        }
        if !self.written.is_empty() {
            value["written"] = json!(self.written);
        }
        if let Some(coverage) = &self.coverage {
            value["coverage"] = self.coverage_report(coverage);
        }
        value
    }

    /// The coverage of the comparator file as reported: its summary, what
    /// isn't covered and what is excluded, and the merged entries.
    pub fn coverage_report(&self, coverage: &Value) -> Value {
        if coverage.is_null() {
            return json!({"comparator": self.rules, "summary": null});
        }
        let mut report = projections_rules_yaml::coverage::report(coverage);
        report["comparator"] = json!(self.rules);
        report["entries"] = coverage.clone();
        report
    }
}

/// The test file beside a definition's comparator file, relative to the repository
/// root, whether or not it exists; `None` for the default comparator.
pub fn tests_for(definition: &Value) -> Option<String> {
    suite::tests_path(&crate::project::comparator_file(definition)?)
}
