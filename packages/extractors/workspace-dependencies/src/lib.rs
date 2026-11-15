//! Node workspace package graph with declared ranges and lockfile resolutions,
//! read the way npm, pnpm and Yarn read them.

mod declarations;
mod installed;
mod lockfile;
mod manager;
mod patterns;
mod workspace;

use anyhow::{Context as _, Result};
use lockfile::Lockfile;
pub use manager::Manager;
use projections_extractor_sdk::{Context, Descriptor, Trust, extraction, input, object, relative_path};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use workspace::{Package, Workspace};

pub const ID: &str = "workspace-dependencies";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Workspace dependencies",
        description: "Node workspace packages, declared dependency ranges and lockfile resolutions for npm, pnpm and Yarn",
        schema: "graph/v0",
        renderer: "dependencies",
        trust: Trust::None,
        access: projections_extractor_sdk::Access::Files,
        determinism: projections_extractor_sdk::Determinism::Pure,
        inputs: json!({"root":"Repository-relative workspace root; default \".\"","packageManager":"npm, pnpm or yarn; default from package.json packageManager or the lockfile present"}),
        template_inputs: None,
        detects: &["package.json"],
    }
}

pub fn requires_trust(_inputs: &Value) -> bool {
    false
}

/// External packages, relationships and unresolved dependencies, as the graph
/// is assembled.
#[derive(Default)]
struct Graph {
    external: BTreeMap<String, Value>,
    relationships: Vec<Value>,
    unresolved: Vec<Value>,
}

pub fn collect(cx: &Context) -> Result<Value> {
    let (files, definition) = (cx.files()?, cx.definition());
    let requested = input(definition, "root", Some("."))?;
    let prefix = relative_path(requested)?.to_string_lossy().replace('\\', "/");
    let base = if prefix.is_empty() { String::new() } else { format!("{prefix}/") };
    let present: BTreeSet<&str> = files.iter().map(String::as_str).collect();
    let root_file = format!("{base}package.json");
    // A revision without the workspace (before it was added) has no packages.
    if !cx.input_exists(&root_file)? {
        return Ok(extraction("graph/v0", vec![], vec![], None));
    }
    let root_manifest = cx.read_json(&root_file)?;
    object(&root_manifest, &root_file)?;
    let read_text = |name: &str| -> Result<Option<String>> {
        let file = format!("{base}{name}");
        if present.contains(file.as_str()) {
            Ok(Some(cx.read_source(&file)?))
        } else {
            Ok(None)
        }
    };
    let lockfiles: Vec<&str> = manager::LOCKFILES
        .into_iter()
        .filter(|name| present.contains(format!("{base}{name}").as_str()))
        .collect();
    let manager = manager::detect(definition, &root_manifest, &lockfiles, &read_text)?;
    let lockfile_name = manager.lockfile(&lockfiles);
    let selection = workspace::selection(manager, &root_manifest, &read_text)?;
    let root = Package {
        directory: String::new(),
        manifest_path: root_file,
        manifest: root_manifest,
    };
    let workspace = Workspace::read(cx, files, &base, &selection, root)?;
    let lockfile = match lockfile_name {
        Some(name) => Some(Lockfile::parse(manager, name, &read_text(name)?.context("lockfile disappeared")?)?),
        None => None,
    };
    let lockfile_path = lockfile_name.map(|n| format!("{base}{n}"));

    let mut entities = workspace.entities();
    let mut graph = Graph::default();
    let declarations = declarations::declare(&workspace, lockfile.as_ref(), &mut graph.unresolved)?;
    let installed: &[lockfile::Installed] = lockfile.as_ref().map_or(&[], |l| &l.packages);
    let reached = installed::reached(installed, &declarations);
    let installed_ids = installed::identities(installed, &reached);
    declarations::relate(declarations, &workspace, &installed_ids, &mut graph);
    installed::Transitive {
        installed,
        reached: &reached,
        ids: &installed_ids,
        workspace: &workspace,
        lockfile_path: lockfile_path.as_deref(),
    }
    .relate(&mut graph)?;

    entities.extend(graph.external.into_values());
    let mut relationships = graph.relationships;
    relationships.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    let mut metadata = json!({
        "packageManager":manager.name(),
        "lockfile":lockfile_path,
        "unresolved":graph.unresolved,
    });
    if let Some(lockfile) = &lockfile {
        metadata["lockfileVersion"] = json!(lockfile.version);
    }
    if !selection.ignored.is_empty() {
        metadata["ignoredPatterns"] = json!(selection.ignored);
        metadata["limitations"] = json!(["Yarn classic ignores negated workspace patterns, so the packages they name remain workspaces."]);
    }
    Ok(extraction("graph/v0", entities, relationships, Some(metadata)))
}
