//! Dependencies the workspace packages declare, and what each resolves to.

use crate::Graph;
use crate::lockfile::{Lockfile, Target};
use crate::workspace::Workspace;
use anyhow::{Context as _, Result, ensure};
use projections_extractor_sdk::object;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const KINDS: [&str; 4] = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/// A declaration's target: a workspace package, an installed package (an index
/// into the lockfile's packages) or, unresolved, a name.
pub(crate) enum To {
    Workspace(usize),
    Installed(usize),
    Unresolved(String),
}

pub(crate) struct Declaration {
    id: String,
    /// The declaring workspace package.
    from: usize,
    pub to: To,
    kind: &'static str,
    range: String,
    data: Value,
}

/// Every declared dependency, in package, kind and key order; dependencies the
/// lockfile should have resolved but didn't are added to `unresolved`.
pub(crate) fn declare(workspace: &Workspace, lockfile: Option<&Lockfile>, unresolved: &mut Vec<Value>) -> Result<Vec<Declaration>> {
    let mut declarations = vec![];
    for (index, package) in workspace.packages.iter().enumerate() {
        let owner = package.manifest["name"].as_str().unwrap_or(".");
        for kind in KINDS {
            let Some(dependencies) = package.manifest.get(kind) else {
                continue;
            };
            let dependencies = object(dependencies, &format!("{}: {kind}", package.manifest_path))?;
            for (key, range) in dependencies {
                let range = range
                    .as_str()
                    .with_context(|| format!("{}: {kind}.{key} must be a version string", package.manifest_path))?;
                let declared = Declared {
                    index,
                    owner,
                    kind,
                    key,
                    range,
                };
                declarations.push(declared.resolve(workspace, lockfile, unresolved)?);
            }
        }
    }
    Ok(declarations)
}

/// One dependency as a manifest declares it.
struct Declared<'a> {
    index: usize,
    owner: &'a str,
    kind: &'static str,
    key: &'a str,
    range: &'a str,
}

impl Declared<'_> {
    fn resolve(&self, workspace: &Workspace, lockfile: Option<&Lockfile>, unresolved: &mut Vec<Value>) -> Result<Declaration> {
        let Self {
            index,
            owner,
            kind,
            key,
            range,
        } = *self;
        let package = &workspace.packages[index];
        let target_name = target(key, range)?;
        let workspace_target = workspace.ids.get(&target_name).copied();
        ensure!(
            !range.starts_with("workspace:") || workspace_target.is_some(),
            "{}: {kind}.{key} uses the workspace: protocol, but no workspace package is named {target_name}",
            package.manifest_path
        );
        let resolution = lockfile.and_then(|l| l.resolve(&package.directory, key, range, workspace_target.is_some()));
        let (to, resolved, missing) = destination(workspace, lockfile, &target_name, workspace_target, resolution);
        if missing && lockfile.is_some() && kind != "peerDependencies" {
            unresolved.push(json!([owner, kind, key]));
        }
        let mut data = json!({"type":kind,"version":range});
        if let Some(resolved) = resolved {
            data["resolved"] = json!(resolved);
        }
        if key != target_name {
            data["alias"] = json!(key);
        }
        Ok(Declaration {
            id: format!("dependency:{}", serde_json::to_string(&json!([owner, kind, key]))?),
            from: index,
            to,
            kind,
            range: range.to_owned(),
            data,
        })
    }
}

/// Where a declaration points, the version it resolved to, and whether the
/// lockfile left it unresolved.
fn destination(
    workspace: &Workspace,
    lockfile: Option<&Lockfile>,
    target_name: &str,
    workspace_target: Option<usize>,
    resolution: Option<Target>,
) -> (To, Option<String>, bool) {
    let installed_version = |installed: usize| lockfile.map(|l| l.packages[installed].version.clone());
    match (workspace_target, resolution) {
        (_, Some(Target::Workspace(directory))) => {
            let linked = workspace.by_directory.get(directory.as_str()).copied();
            match workspace_target.or(linked) {
                Some(i) => (To::Workspace(i), linked.and_then(|l| workspace.version(l)), false),
                None => (To::Unresolved(target_name.to_owned()), None, false),
            }
        }
        (Some(i), Some(Target::WorkspaceName)) => (To::Workspace(i), workspace.version(i), false),
        (Some(i), Some(Target::Package(installed))) => (To::Workspace(i), installed_version(installed), false),
        (Some(i), None) => (To::Workspace(i), None, true),
        (None, Some(Target::Package(installed))) => (To::Installed(installed), installed_version(installed), false),
        (None, Some(Target::WorkspaceName) | None) => (To::Unresolved(target_name.to_owned()), None, true),
    }
}

/// The package a dependency installs: its key, or the name an `npm:` alias names.
fn target(key: &str, range: &str) -> Result<String> {
    let Some(aliased) = range.strip_prefix("npm:") else {
        return Ok(key.to_owned());
    };
    let name = match aliased[1.min(aliased.len())..].find('@') {
        Some(at) => &aliased[..at + 1],
        None => aliased,
    };
    ensure!(!name.is_empty(), "Dependency {key} has an npm: alias without a package name");
    Ok(name.to_owned())
}

/// The declarations' relationships, with an external package for each
/// unresolved name.
pub(crate) fn relate(declarations: Vec<Declaration>, workspace: &Workspace, installed_ids: &BTreeMap<usize, String>, graph: &mut Graph) {
    for declaration in declarations {
        let to = match declaration.to {
            To::Workspace(i) => workspace.package_ids[i].clone(),
            To::Installed(i) => installed_ids[&i].clone(),
            To::Unresolved(name) => {
                let id = format!("package:{name}");
                graph
                    .external
                    .entry(id.clone())
                    .or_insert_with(|| json!({"id":id,"kind":"external-package","label":name,"data":{},"confidence":"authoritative"}));
                id
            }
        };
        let from = declaration.from;
        graph.relationships.push(json!({
            "id":declaration.id,"from":workspace.package_ids[from],"to":to,"kind":declaration.kind,"label":declaration.range,"data":declaration.data,
            "confidence":"authoritative","evidence":[{"kind":"manifest","source":workspace.packages[from].manifest_path}]
        }));
    }
}
