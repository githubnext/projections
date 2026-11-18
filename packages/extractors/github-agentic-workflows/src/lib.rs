//! GitHub Agentic Workflows (gh-aw): each markdown workflow under
//! `.github/workflows`, read from its front matter as gh-aw reads it: what
//! starts it, the engine, tools and their scope, network allowlist,
//! permissions, safe outputs and their limits, secrets, imports and skills,
//! budgets, and whether its compiled `.lock.yml` is current.
//!
//! The checked-in markdown is the workflow, so reading it runs nothing and
//! needs no trust. The vocabulary is in `docs/models/agentic-workflow-model.md`.

mod capabilities;
mod document;
mod fields;
mod groups;
mod hash;
mod imports;
mod lock;
mod outputs;
mod paths;
mod settings;
mod triggers;
mod workflow;

use anyhow::{Context as _, Result};
use projections_extractor_sdk::{Access, Context, Descriptor, Determinism, Trust, extraction, globs, relationship, unique_relationships};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use workflow::{Kind, classify, stem};

pub const ID: &str = "github-agentic-workflows";
pub const SCHEMA: &str = "architecture/v0";
/// The vocabulary every extraction declares, defined in `docs/models/agentic-workflow-model.md`.
pub const VOCABULARY: &str = "agentic-workflows/v0";
const DEFAULT_PATHS: &[&str] = &[".github/workflows/*.md"];

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Agentic workflows",
        description: "GitHub Agentic Workflows: what starts each one, its engine, tools and their scope, network, permissions, safe outputs, budgets and imports, and whether its lock file is current",
        schema: SCHEMA,
        renderer: "architecture",
        trust: Trust::None,
        access: Access::Files,
        determinism: Determinism::Pure,
        inputs: json!({
            "paths": "Array of globs selecting workflow markdown; default .github/workflows/*.md. Files without `on` (shared components) and README.md are skipped",
            "exclude": "Array of globs to skip",
            "groups": "\"prefix\" to group each workflow with the workflows named after it and a dash, or an object of group name to globs of workflow paths or names",
            "classes": "An object of class name (such as guardrail) to globs of import paths and skill references; the comparator warns when a classified import or skill is removed",
        }),
        template_inputs: None,
        detects: &[".github/workflows/*.md"],
    }
}

pub fn requires_trust(_inputs: &Value) -> bool {
    false
}

pub fn collect(cx: &Context) -> Result<Value> {
    let mut extraction = extract(cx)?;
    extraction["vocabularies"] = json!([VOCABULARY]);
    Ok(extraction)
}

/// The workflow files the inputs select, in path order.
fn workflow_files(cx: &Context, inputs: &Value) -> Result<Vec<String>> {
    let paths = match inputs.get("paths").filter(|paths| !paths.is_null()) {
        Some(paths) => globs(Some(paths), "inputs.paths")?,
        None => globs(Some(&json!(DEFAULT_PATHS)), "paths")?,
    };
    let exclude = globs(inputs.get("exclude").filter(|exclude| !exclude.is_null()), "inputs.exclude")?;
    Ok(cx
        .files()?
        .iter()
        .filter(|file| file.ends_with(".md") && !stem(file).eq_ignore_ascii_case("readme"))
        .filter(|file| paths.iter().any(|glob| glob.is_match(file)) && !exclude.iter().any(|glob| glob.is_match(file)))
        .cloned()
        .collect())
}

fn extract(cx: &Context) -> Result<Value> {
    let inputs = &cx.definition()["inputs"];
    let classes = imports::Classes::read(inputs.get("classes"))?;
    let read = |path: &str| -> Option<String> {
        if path.starts_with("..") || !cx.exists(path).ok()? || cx.is_dir(path).ok()? {
            return None;
        }
        cx.read_source(path).ok()
    };
    let mut entities = Vec::new();
    for path in workflow_files(cx, inputs)? {
        let content = cx.read_source(&path)?;
        let document = match document::split(&content) {
            Ok(document) => document,
            Err(error) => {
                entities.push(workflow::invalid(&path, &error.to_string()));
                continue;
            }
        };
        match classify(&document) {
            Kind::Workflow(front) => entities.push(workflow::entity(&path, &document, front, &classes, &read)),
            Kind::Invalid(reason) => entities.push(workflow::invalid(&path, &reason)),
            Kind::Other => {}
        }
    }
    let named: Vec<(String, String)> = entities
        .iter()
        .map(|entity| {
            (
                entity["data"]["path"].as_str().unwrap_or_default().to_owned(),
                entity["label"].as_str().unwrap_or_default().to_owned(),
            )
        })
        .collect();
    let grouped = groups::groups(inputs.get("groups"), &named).context("inputs.groups")?;
    let relationships = relationships(&mut entities, &grouped, &named);
    let workflows = named.len();
    let compilers: std::collections::BTreeSet<&str> = entities
        .iter()
        .filter_map(|entity| entity["data"]["lock"]["compiler"].as_str())
        .collect();
    let compilers = json!(compilers);
    Ok(extraction(
        SCHEMA,
        entities,
        relationships,
        Some(json!({
            "engine": "gh-aw",
            "ghAw": fields::source(),
            "workflows": workflows,
            "compilers": compilers,
            "limitations": [
                "The front matter as declared, merged with local imports: gh-aw's compiler isn't run, so natural-language triggers stay as written and defaults gh-aw fills in are shown only where noted.",
                "Imports from other repositories are listed but not read; gh-aw fetches them when it compiles.",
            ],
        })),
    ))
}

/// Groups as `group` entities containing their workflows, each workflow
/// naming its group, and `dispatches` from a workflow to the workflows its
/// safe outputs start.
fn relationships(entities: &mut Vec<Value>, grouped: &BTreeMap<String, String>, named: &[(String, String)]) -> Vec<Value> {
    let mut relationships = Vec::new();
    for entity in entities.iter() {
        let from = entity["id"].as_str().unwrap_or_default();
        let directory = paths::dir(entity["data"]["path"].as_str().unwrap_or_default());
        for name in workflow::dispatched(entity) {
            if let Some((target, _)) = named.iter().find(|(path, other)| *other == name && paths::dir(path) == directory) {
                relationships.push(relationship("dispatches", from, &format!("workflow:{target}")));
            }
        }
    }
    let mut members: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for entity in entities.iter_mut() {
        let path = entity["data"]["path"].as_str().unwrap_or_default().to_owned();
        if let Some(group) = grouped.get(&path) {
            entity["data"]["group"] = json!(group);
            relationships.push(relationship("contains", &format!("group:{group}"), &format!("workflow:{path}")));
        }
    }
    for (path, group) in grouped {
        members
            .entry(group)
            .or_default()
            .push(named.iter().find(|(other, _)| other == path).map_or("", |(_, name)| name));
    }
    for (group, mut names) in members {
        names.sort();
        entities.push(json!({
            "id": format!("group:{group}"), "kind": "group", "label": group, "confidence": "authoritative",
            "data": {"workflows": names},
        }));
    }
    unique_relationships(relationships)
}
