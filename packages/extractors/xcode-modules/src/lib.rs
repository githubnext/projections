//! Xcode projects' modules: each target of every `.xcodeproj` with its
//! `PRODUCT_MODULE_NAME`, the targets it depends on and links, the Swift
//! package products it uses with the versions `Package.resolved` pins, and the
//! modules its Swift sources import. Everything is read from the project
//! files and sources; nothing runs.

mod graph;
mod packages;
mod plist;
mod project;
mod settings;
mod sources;
mod targets;

use anyhow::{Context as _, Result, ensure};
use project::Project;
use projections_extractor_sdk::{Context, Descriptor, Trust, extraction, input, strings};
use serde_json::{Value, json};

pub const ID: &str = "xcode-modules";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Xcode modules",
        description: "Xcode targets with their module names, target and package product dependencies, and the modules their Swift sources import",
        schema: "graph/v0",
        renderer: "dependencies",
        trust: Trust::None,
        access: projections_extractor_sdk::Access::Files,
        determinism: projections_extractor_sdk::Determinism::Pure,
        inputs: json!({
            "projects": "Array of .xcodeproj paths; default every one in the repository",
            "configuration": "Build configuration whose settings name modules; default each target's default configuration",
            "imports": "Read the modules each target's Swift files import; default true"
        }),
        template_inputs: None,
        detects: &["**/*.xcodeproj/project.pbxproj"],
    }
}

pub fn requires_trust(_inputs: &Value) -> bool {
    false
}

pub fn collect(cx: &Context) -> Result<Value> {
    let definition = cx.definition();
    let inputs = &definition["inputs"];
    let imports = match inputs.get("imports") {
        None => true,
        Some(value) => value.as_bool().context("`inputs.imports` must be a boolean")?,
    };
    let configuration = inputs
        .get("configuration")
        .map(|_| input(definition, "configuration", None))
        .transpose()?;
    let mut projects = Vec::new();
    for path in paths(cx, inputs)? {
        let file = join(&path, "project.pbxproj");
        projects.push(Project::read(&path, &cx.read_source(&file)?)?);
    }
    let found = targets::targets(cx, &projects, &targets::Options { configuration, imports })?;
    let mut pins = Vec::new();
    let mut described = Vec::new();
    for project in &projects {
        let resolved = packages::pins(cx, project, cx.files()?)?;
        described.push(
            json!({"path": project.path, "objectVersion": project.object_version, "resolved": resolved.as_ref().map(|(path, _)| path)}),
        );
        pins.extend(resolved.map(|(_, pins)| pins).unwrap_or_default());
    }
    let paths: Vec<String> = projects.iter().map(|project| project.path.clone()).collect();
    let graph = graph::build(&found, &pins, &paths, imports);
    let unnamed: Vec<&str> = found
        .iter()
        .filter(|target| target.module.is_none())
        .map(|target| target.id.as_str())
        .collect();
    let mut metadata = json!({"projects": described, "unresolvedModules": unnamed});
    if imports {
        metadata["limitations"] = json!([
            "Imports are read from the Swift sources' text: imports inside `#if` count whichever branch they're in (marked `conditional`), and `canImport` isn't evaluated."
        ]);
    }
    Ok(extraction("graph/v0", graph.entities, graph.relationships, Some(metadata)))
}

/// The `.xcodeproj` directories to read: those `inputs.projects` names that the
/// revision has, else every one in it.
fn paths(cx: &Context, inputs: &Value) -> Result<Vec<String>> {
    if let Some(declared) = inputs.get("projects") {
        let mut found = Vec::new();
        for path in strings(declared, "inputs.projects")? {
            let path = path.trim_end_matches('/').to_owned();
            ensure!(
                path.ends_with(".xcodeproj"),
                "`inputs.projects` names .xcodeproj directories, not {path}"
            );
            if cx.input_exists(&join(&path, "project.pbxproj"))? {
                found.push(path);
            }
        }
        return Ok(found);
    }
    Ok(cx
        .files()?
        .iter()
        .filter_map(|file| file.strip_suffix("/project.pbxproj"))
        .filter(|dir| dir.ends_with(".xcodeproj"))
        .map(str::to_owned)
        .collect())
}

/// `name` in the directory `dir` (empty for the project's root).
pub(crate) fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() || dir == "." {
        name.to_owned()
    } else {
        format!("{dir}/{name}")
    }
}

/// The directory holding `path`: empty for a file at the root.
pub(crate) fn parent_dir(path: &str) -> String {
    path.rsplit_once('/').map(|(dir, _)| dir.to_owned()).unwrap_or_default()
}

pub(crate) fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}
