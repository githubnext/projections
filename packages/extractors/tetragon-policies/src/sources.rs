//! The manifests to read: rendered by helm or kustomize, an already rendered
//! file, or the repository's YAML files that mention `TracingPolicy`.

use anyhow::{Context as _, Result};
use projections_extractor_sdk::{Context, execute, globs, path, read_source, strings, text};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::Path;

const DEFAULT_PATHS: &[&str] = &["**/*.yaml", "**/*.yml"];

/// One file of manifests.
pub(crate) struct Source {
    pub(crate) label: String,
    pub(crate) text: String,
}

/// Renders a chart or kustomization with the user's own tool, without a shell.
fn rendered(root: &Path, definition: &Value, cx: &Context) -> Result<Vec<Source>> {
    let inputs = &definition["inputs"];
    let mut sources = vec![];
    let field = |object: &Value, name: &str, label: &str| -> Result<Option<String>> {
        object
            .get(name)
            .filter(|v| !v.is_null())
            .map(|v| text(v, &format!("{label}.{name}")).map(str::to_owned))
            .transpose()
    };
    let inside = |relative: &str| -> Result<String> {
        path(root, relative, false, false)?;
        Ok(relative.to_owned())
    };
    if let Some(helm) = inputs.get("helm").filter(|v| !v.is_null()) {
        cx.require_trust()?;
        let chart = field(helm, "chart", "inputs.helm")?.context("inputs.helm.chart is required")?;
        // A revision without the chart (before it was added) renders nothing from it.
        if cx.input_exists(&chart)? {
            sources.push(helm_template(cx, root, helm, &chart, &field, &inside)?);
        }
    }
    if let Some(kustomize) = inputs.get("kustomize").filter(|v| !v.is_null()) {
        cx.require_trust()?;
        let directory = field(kustomize, "path", "inputs.kustomize")?.context("inputs.kustomize.path is required")?;
        if cx.input_exists(&directory)? {
            let directory = inside(&directory)?;
            let argv = vec![
                field(kustomize, "kustomizePath", "inputs.kustomize")?.unwrap_or_else(|| "kustomize".into()),
                "build".into(),
                directory.clone(),
            ];
            let text = execute(cx, root, argv, None, BTreeMap::new(), true)?;
            sources.push(Source {
                label: format!("kustomize build {directory}"),
                text,
            });
        }
    }
    Ok(sources)
}

type Field<'a> = dyn Fn(&Value, &str, &str) -> Result<Option<String>> + 'a;
type Inside<'a> = dyn Fn(&str) -> Result<String> + 'a;

/// `helm template` of the chart, with the values files the revision has.
fn helm_template(cx: &Context, root: &Path, helm: &Value, chart: &str, field: &Field<'_>, inside: &Inside<'_>) -> Result<Source> {
    let chart = inside(chart)?;
    let mut argv = vec![
        field(helm, "helmPath", "inputs.helm")?.unwrap_or_else(|| "helm".into()),
        "template".into(),
        field(helm, "releaseName", "inputs.helm")?.unwrap_or_else(|| "release".into()),
        chart.clone(),
        "--skip-tests".into(),
    ];
    if let Some(namespace) = field(helm, "namespace", "inputs.helm")? {
        argv.extend(["--namespace".into(), namespace]);
    }
    if let Some(values) = helm.get("values").filter(|v| !v.is_null()) {
        for file in strings(values, "inputs.helm.values")? {
            if cx.input_exists(&file)? {
                argv.extend(["--values".into(), inside(&file)?]);
            }
        }
    }
    let text = execute(cx, root, argv, None, BTreeMap::new(), true)?;
    Ok(Source {
        label: format!("helm template {chart}"),
        text,
    })
}

/// The declared globs that match some file of the revision. One that matches
/// none (the revision predates what it selects) is recorded as missing.
pub(crate) fn matching(cx: &Context, files: &[String], patterns: &Value, label: &str) -> Result<Value> {
    let mut present = vec![];
    for pattern in strings(patterns, label)? {
        let glob = projections_extractor_sdk::glob(&pattern)?;
        if files.iter().any(|file| glob.is_match(file)) {
            present.push(pattern);
        } else {
            cx.missing_input(&pattern);
        }
    }
    Ok(json!(present))
}

pub(crate) fn sources(root: &Path, files: &[String], definition: &Value, cx: &Context) -> Result<Vec<Source>> {
    let inputs = &definition["inputs"];
    if let Some(path) = inputs.get("renderedManifestsPath").filter(|v| !v.is_null()) {
        let path = text(path, "inputs.renderedManifestsPath")?;
        if !cx.input_exists(path)? {
            return Ok(vec![]);
        }
        return Ok(vec![Source {
            label: path.to_owned(),
            text: read_source(root, path)?,
        }]);
    }
    let mut sources = rendered(root, definition, cx)?;
    let explicit = inputs
        .get("paths")
        .filter(|v| !v.is_null())
        .map(|paths| matching(cx, files, paths, "inputs.paths"))
        .transpose()?;
    if !sources.is_empty() && explicit.is_none() {
        return Ok(sources);
    }
    // Every declared glob matches nothing: the revision has none of the policies yet.
    if explicit.as_ref().is_some_and(|paths| paths == &json!([])) {
        return Ok(sources);
    }
    let explicit = explicit.as_ref();
    let include = match explicit {
        Some(paths) => globs(Some(paths), "inputs.paths")?,
        None => globs(Some(&json!(DEFAULT_PATHS)), "paths")?,
    };
    let exclude = globs(inputs.get("exclude").filter(|v| !v.is_null()), "inputs.exclude")?;
    let mut matched: Vec<&String> = files
        .iter()
        .filter(|file| include.iter().any(|glob| glob.is_match(file)))
        .filter(|file| !exclude.iter().any(|glob| glob.is_match(file)))
        .collect();
    matched.sort();
    for file in matched {
        let text = read_source(root, file)?;
        if text.contains("TracingPolicy") {
            sources.push(Source { label: file.clone(), text });
        }
    }
    Ok(sources)
}
