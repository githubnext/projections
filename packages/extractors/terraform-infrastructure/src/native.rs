//! Running the user's Terraform to export a plan as JSON.

use anyhow::{Result, ensure};
use projections_extractor_sdk::{Context, Scratch, input, path, run, strings};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

/// Runs the user's Terraform: `show -json` of a saved plan, or `plan` then `show -json`;
/// `None` when the revision lacks the declared plan or directory.
pub(crate) fn native(root: &Path, d: &Value, cx: &Context) -> Result<Option<Value>> {
    let terraform = input(d, "terraformPath", Some("terraform"))?.to_owned();
    if d["inputs"].get("planPath").is_some() {
        let relative = input(d, "planPath", None)?;
        if !cx.input_exists(relative)? {
            return Ok(None);
        }
        let plan = path(root, relative, false, false)?;
        return show(root, cx, &terraform, &plan).map(Some);
    }
    cx.require_trust()?;
    let relative = input(d, "directory", Some("."))?;
    if !cx.input_exists(relative)? {
        return Ok(None);
    }
    let directory = path(root, relative, false, false)?;
    ensure!(directory.is_dir(), "inputs.directory must be a Terraform working directory");
    let extra = match d["inputs"].get("planArguments") {
        Some(value) => strings(value, "inputs.planArguments")?,
        None => vec![],
    };
    ensure!(
        !extra
            .iter()
            .any(|a| a.starts_with("-out") || a.starts_with("-chdir") || a == "-destroy"),
        "inputs.planArguments may not choose the plan file, the directory or a destroy plan"
    );
    let scratch = Scratch::new(root, "terraform")?;
    let plan = scratch.0.join("projections.tfplan");
    // Materialized revisions omit ignored files: use the working checkout's initialized
    // providers and modules, as installed packages are, unless the definition grants its own.
    let mut environment = BTreeMap::new();
    let relative = directory.strip_prefix(root).unwrap_or(Path::new(""));
    let installed = cx.checkout()?.join(relative).join(".terraform");
    let granted = d["execution"]["environment"]
        .as_array()
        .is_some_and(|names| names.iter().any(|n| n == "TF_DATA_DIR"));
    if !granted && installed.is_dir() {
        environment.insert("TF_DATA_DIR".into(), installed.to_string_lossy().into_owned());
    }
    let mut argv = vec![
        terraform.clone(),
        format!("-chdir={}", directory.to_string_lossy()),
        "plan".into(),
        "-input=false".into(),
        "-lock=false".into(),
        "-no-color".into(),
        format!("-out={}", plan.to_string_lossy()),
    ];
    argv.extend(extra);
    projections_extractor_sdk::execute(cx, root, argv, None, environment, true)?;
    show(root, cx, &terraform, &plan).map(Some)
}

fn show(root: &Path, cx: &Context, terraform: &str, plan: &Path) -> Result<Value> {
    run(
        cx,
        root,
        vec![terraform.into(), "show".into(), "-json".into(), plan.to_string_lossy().into_owned()],
        None,
        BTreeMap::new(),
    )
}
