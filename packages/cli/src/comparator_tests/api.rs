//! The Inspector API's comparator tests: listing every test file and
//! running a selection of them.

use super::{
    Context,
    run::{location, read_suite, run_file},
};
use crate::runtime::Runner;
use anyhow::{Context as _, Result, bail, ensure};
use projections_rules_yaml::suite;
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path};

/// The comparator files with a test file beside them, and the projections using
/// each: every comparator file in the working tree, and every one a definition names.
fn test_files(runner: &Runner, root: &Path) -> Vec<(String, String, Vec<Value>)> {
    let definitions = runner.discover("working-tree").unwrap_or_default();
    let mut rules: BTreeMap<String, Vec<Value>> = runner
        .rules_files("working-tree")
        .unwrap_or_default()
        .into_iter()
        .map(|path| (path, Vec::new()))
        .collect();
    for definition in definitions {
        if let Some(path) = crate::project::comparator_file(&definition) {
            rules.entry(path).or_default().push(definition);
        }
    }
    rules
        .into_iter()
        .filter_map(|(rules, definitions)| {
            let tests = suite::tests_path(&rules)?;
            root.join(&tests).is_file().then_some((tests, rules, definitions))
        })
        .collect()
}

fn ids(definitions: &[Value]) -> Vec<Value> {
    definitions.iter().map(|definition| definition["id"].clone()).collect()
}

/// `GET /api/comparator-tests`: every test file and its cases, parsed but
/// not run.
pub fn list(runner: &Runner) -> Result<Value> {
    let root = runner.repository_root()?;
    let files: Vec<Value> = test_files(runner, &root)
        .into_iter()
        .map(|(tests, rules, definitions)| {
            let (cases, diagnostics) = match read_suite(&root, &root.join(&tests)) {
                Ok(suite) => (
                    suite
                        .cases
                        .iter()
                        .map(|case| {
                            json!({"id": case.name, "name": case.name,
                                "location": location(&tests, case.location)})
                        })
                        .collect(),
                    Vec::new(),
                ),
                Err(diagnostics) => (Vec::new(), diagnostics),
            };
            json!({"path": tests, "comparator": rules, "projections": ids(&definitions),
                "cases": cases, "diagnostics": diagnostics})
        })
        .collect();
    Ok(json!({"files": files}))
}

/// What `POST /api/comparator-tests/run` runs.
pub struct RunRequest {
    pub path: Option<String>,
    pub cases: Option<Vec<String>>,
    pub projection: Option<String>,
    pub update: bool,
    /// Report each file's rule coverage.
    pub coverage: bool,
}

impl RunRequest {
    pub fn parse(body: &Value) -> Result<Self> {
        let fields = body.as_object().context("The body must be an object")?;
        if let Some(key) = fields
            .keys()
            .find(|key| !["path", "cases", "projection", "update", "coverage"].contains(&key.as_str()))
        {
            bail!("Unknown field {key}: expected path, cases, projection, update or coverage");
        }
        let text = |key: &str| -> Result<Option<String>> {
            match fields.get(key) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(text)) if !text.is_empty() => Ok(Some(text.clone())),
                Some(_) => bail!("{key} must be a non-empty string"),
            }
        };
        let flag = |key: &str| -> Result<bool> {
            match fields.get(key) {
                None | Some(Value::Null) => Ok(false),
                Some(Value::Bool(flag)) => Ok(*flag),
                Some(_) => bail!("{key} must be a boolean"),
            }
        };
        let cases = match fields.get("cases") {
            None | Some(Value::Null) => None,
            Some(Value::Array(items)) => Some(
                items
                    .iter()
                    .map(|item| item.as_str().map(str::to_owned))
                    .collect::<Option<Vec<_>>>()
                    .context("cases must be a list of case IDs")?,
            ),
            Some(_) => bail!("cases must be a list of case IDs"),
        };
        let request = Self {
            path: text("path")?,
            cases,
            projection: text("projection")?,
            update: flag("update")?,
            coverage: flag("coverage")?,
        };
        ensure!(
            request.cases.is_none() || request.path.is_some(),
            "cases selects cases of one test file: give its path"
        );
        Ok(request)
    }
}

/// `POST /api/comparator-tests/run`: runs the selected test files (all by
/// default), once per projection using each, or once alone when none does.
pub fn run(runner: &Runner, request: &RunRequest) -> Result<Value> {
    let root = runner.repository_root()?;
    let mut files = test_files(runner, &root);
    if let Some(path) = &request.path {
        files.retain(|(tests, _, _)| tests == path);
        ensure!(
            !files.is_empty(),
            "{path} is not a comparator test file beside a comparator file in the working tree"
        );
    }
    let mut results = Vec::new();
    for (tests, _, definitions) in &files {
        let selected: Vec<Option<&Value>> = match &request.projection {
            Some(id) => {
                let definition = definitions.iter().find(|definition| definition["id"] == id.as_str());
                if definition.is_none() {
                    if request.path.is_some() {
                        bail!("Projection {id} does not use the comparator beside {tests}");
                    }
                    continue;
                }
                vec![definition]
            }
            None if definitions.is_empty() => vec![None],
            None => definitions.iter().map(Some).collect(),
        };
        for projection in selected {
            let report = run_file(
                &root.join(tests),
                &Context {
                    root: &root,
                    projection,
                    runner: Some(runner),
                    update: request.update,
                    cases: request.cases.as_deref(),
                    coverage: request.coverage,
                },
            );
            results.push(report.to_json());
        }
    }
    Ok(json!({"results": results}))
}
