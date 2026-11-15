//! The scenarios document `check` renders.

use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

/// Writes the scenarios `check` renders into `directory`: the working tree's
/// extraction and, when there is one, the comparison with HEAD under the
/// definition's comparator. Scenario paths are relative to the scenarios file,
/// so a custom comparator's file is copied beside it under its repository path,
/// and the scenario names it as `show` and `compare` do. Both scenarios present
/// as the definition does (its `presentation`: renderer options and mode), so
/// the renderer is checked as people see it.
pub(super) fn write_scenarios(
    directory: &Path,
    root: &Path,
    definition: &Value,
    title: &str,
    renderer: Value,
    document: &Value,
    comparison: Option<&Value>,
) -> Result<PathBuf> {
    let mut scenarios = vec![json!({"id": "working-tree", "title": "Working tree", "extraction": document["extraction"]})];
    if let Some(compared) = comparison {
        let mut scenario = json!({
            "id": "head", "title": "HEAD → working tree",
            "before": compared["before"]["extraction"], "after": compared["after"]["extraction"],
        });
        match &definition["comparator"] {
            Value::Null => {}
            declared if let Some(file) = crate::project::comparator_file(definition) => {
                let file = file.as_str();
                let copy = directory.join(file);
                if let Some(parent) = copy.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(root.join(file), &copy).with_context(|| format!("The comparator file {file} is unavailable"))?;
                let mut comparator = json!({"file": file});
                if !declared["options"].is_null() {
                    comparator["options"] = declared["options"].clone();
                }
                scenario["comparator"] = comparator;
            }
            declared => scenario["comparator"] = json!({"options": declared["options"]}),
        }
        scenarios.push(scenario);
    }
    if !definition["presentation"].is_null() {
        for scenario in &mut scenarios {
            scenario["presentation"] = definition["presentation"].clone();
        }
    }
    let path = directory.join("check.json");
    fs::write(
        &path,
        serde_json::to_vec(&json!({
            "format": "projections.scenarios", "version": 0,
            "title": title, "renderer": renderer, "scenarios": scenarios,
        }))?,
    )?;
    Ok(path)
}
