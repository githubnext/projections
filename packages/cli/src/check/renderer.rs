//! The renderer's static steps: its bundle is built, valid and current, and
//! it has the diff mode comparisons open in.

use super::step;
use crate::{dev_server, fixtures};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

fn newest(path: &Path, depth: usize) -> Option<SystemTime> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.is_file() {
        return metadata.modified().ok();
    }
    if !metadata.is_dir() || depth == 0 {
        return None;
    }
    fs::read_dir(path)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name() != "node_modules" && entry.file_name() != "dist")
        .filter_map(|entry| newest(&entry.path(), depth - 1))
        .max()
}

/// Whether a custom renderer's bundle exists, is valid and is newer than its sources.
pub(super) fn renderer_step(root: &Path, definition: &Value) -> (Value, Option<PathBuf>) {
    let title = "Renderer";
    let renderer = &definition["renderer"];
    if let Some(name) = renderer.as_str() {
        return (step("renderer", title, "pass", format!("Built-in renderer {name}")), None);
    }
    let bundle = renderer["bundle"].as_str().unwrap_or_default();
    let directory = root.join(crate::project::renderer_bundle(definition).ok().flatten().unwrap_or_default());
    let package = dev_server::package(root, definition);
    let build = package.as_ref().map_or_else(
        || format!("build it into {bundle}"),
        |package| {
            format!(
                "run npm install && npm run build in {}",
                package.strip_prefix(root).unwrap_or(package).display()
            )
        },
    );
    let manifest = match fs::read(directory.join("renderer.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .map(|value| fixtures::renderer_manifest(&value))
    {
        Some(Ok(manifest)) if directory.join("index.html").is_file() => manifest,
        Some(Err(error)) => {
            return (
                step("renderer", title, "fail", format!("{bundle}/renderer.json is invalid: {error:#}")),
                None,
            );
        }
        _ => {
            return (
                step(
                    "renderer",
                    title,
                    "fail",
                    format!("The custom renderer bundle {bundle} has not been built: {build}"),
                ),
                None,
            );
        }
    };
    let name = manifest["name"].as_str().unwrap_or_default();
    let message = format!(
        "Custom renderer {name} ({bundle}){}",
        package
            .as_deref()
            .and_then(dev_server::find)
            .map_or_else(String::new, |(url, _)| format!("; its development server runs at {url}"))
    );
    let value = match &package {
        Some(package) if stale(&directory, package) => step(
            "renderer",
            title,
            "warn",
            format!("{message}. The bundle is older than its sources: {build}, and commit it"),
        ),
        Some(_) => step(
            "renderer",
            title,
            "pass",
            format!("{message}; built after its sources last changed"),
        ),
        None => step("renderer", title, "pass", message),
    };
    (value, Some(directory))
}

/// A warning when the custom renderer's `@githubnext/projections` isn't this
/// CLI's version; `None` when it is, or can't be told.
pub(super) fn renderer_package_step(root: &Path, definition: &Value) -> Option<Value> {
    let package = dev_server::package(root, definition)?;
    let shown = package.strip_prefix(root).unwrap_or(&package).display().to_string();
    let message = crate::scaffold::version_mismatch(&package, &shown)?;
    Some(step("renderer-package", "Renderer package", "warn", message))
}

/// Whether the bundle's `index.html` is older than a source in its package.
fn stale(directory: &Path, package: &Path) -> bool {
    let built = fs::metadata(directory.join("index.html")).and_then(|metadata| metadata.modified());
    let Ok(built) = built else {
        return false;
    };
    newest(&package.join("src"), 8).is_some_and(|source| source > built)
}

/// Whether the renderer has a diff mode, the view a comparison opens in when
/// it does; `None` when its modes can't be read.
pub(super) fn diff_step(definition: &Value, bundle: Option<&Path>) -> Option<Value> {
    let modes: Vec<String> = match bundle {
        Some(directory) => serde_json::from_slice::<Value>(&fs::read(directory.join("renderer.json")).ok()?).ok()?["comparisonModes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|mode| mode.as_str().map(str::to_owned))
            .collect(),
        None => {
            let name = definition["renderer"].as_str()?;
            crate::skill::builtin_renderers()
                .into_iter()
                .find(|renderer| renderer.handles.iter().any(|handle| handle == name))?
                .comparison_modes
        }
    };
    Some(if modes.iter().any(|mode| mode == "diff") {
        step("diff", "Diff mode", "pass", "Comparisons open in the renderer's diff")
    } else {
        step(
            "diff",
            "Diff mode",
            "warn",
            "The renderer has no diff mode, the view comparisons open in: draw the union of both revisions with every change marked in place (projections help authoring, \"Diff mode\"), and declare 'diff' first in comparisonModes",
        )
    })
}
