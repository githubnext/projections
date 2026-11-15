//! Running the user's Azure CLI for a template's what-if and compiled dependencies.

use anyhow::{Context as _, Result, bail, ensure};
use projections_extractor_sdk::{Context, input, path, read_json, run, strings};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

/// Runs the user's Azure CLI: what-if, and `bicep build` for a Bicep template's dependencies;
/// `None` when the revision lacks the declared template.
pub(crate) fn native(root: &Path, d: &Value, cx: &Context) -> Result<Option<(Value, Option<Value>)>> {
    cx.require_trust()?;
    let az = input(d, "azPath", Some("az"))?.to_owned();
    let relative = input(d, "templateFile", None).context("azure-what-if needs whatIfJsonPath, or templateFile to run what-if")?;
    if !cx.input_exists(relative)? {
        return Ok(None);
    }
    let template = path(root, relative, false, false)?;
    let scope = input(d, "scope", Some("group"))?;
    let mut argv = vec![
        az.clone(),
        "deployment".into(),
        scope.into(),
        "what-if".into(),
        "--template-file".into(),
        template.to_string_lossy().into_owned(),
        "--no-pretty-print".into(),
        "--result-format".into(),
        "FullResourcePayloads".into(),
        "--only-show-errors".into(),
    ];
    scope_options(d, scope, &mut argv)?;
    parameters(root, d, &mut argv)?;
    let result = run(cx, root, argv, None, BTreeMap::new())?;
    let compiled = if relative.ends_with(".bicep") {
        run(
            cx,
            root,
            vec![
                az,
                "bicep".into(),
                "build".into(),
                "--file".into(),
                template.to_string_lossy().into_owned(),
                "--stdout".into(),
            ],
            None,
            BTreeMap::new(),
        )?
    } else {
        read_json(root, relative)?
    };
    Ok(Some((result, Some(compiled))))
}

/// The deployment-scope flags (`--resource-group`, `--location`, …) the scope requires or allows.
fn scope_options(d: &Value, scope: &str, argv: &mut Vec<String>) -> Result<()> {
    let mut option = |flag: &str, name: &str, required: bool| -> Result<()> {
        match d["inputs"].get(name) {
            Some(_) => {
                argv.push(flag.into());
                argv.push(input(d, name, None)?.into());
            }
            None if required => bail!("inputs.{name} is required for scope {scope}"),
            None => {}
        }
        Ok(())
    };
    match scope {
        "group" => {
            option("--resource-group", "resourceGroup", true)?;
            option("--mode", "mode", false)?;
        }
        "sub" | "tenant" => option("--location", "location", true)?,
        "mg" => {
            option("--management-group-id", "managementGroupId", true)?;
            option("--location", "location", true)?;
        }
        other => bail!("inputs.scope must be group, sub, mg or tenant, not {other}"),
    }
    if scope != "tenant" && scope != "mg" {
        option("--subscription", "subscription", false)?;
    }
    Ok(())
}

/// `--parameters` for each parameter file or `name=value` pair.
fn parameters(root: &Path, d: &Value, argv: &mut Vec<String>) -> Result<()> {
    for parameter in match d["inputs"].get("parameters") {
        Some(value) => strings(value, "inputs.parameters")?,
        None => vec![],
    } {
        argv.push("--parameters".into());
        let file = [".json", ".bicepparam"].iter().any(|suffix| parameter.ends_with(suffix));
        if file {
            argv.push(path(root, &parameter, false, false)?.to_string_lossy().into_owned());
        } else {
            ensure!(
                parameter.contains('=') && !parameter.starts_with('@'),
                "inputs.parameters entries are repository-relative .json/.bicepparam files or name=value pairs"
            );
            argv.push(parameter);
        }
    }
    Ok(())
}
