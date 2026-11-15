//! Resolved NuGet `project.assets.json` graph: imported from the revision, or
//! restored for it with the repository's own `dotnet`.

use anyhow::{Context as _, Result, bail, ensure};
use projections_extractor_dotnet_support::Dotnet;
use projections_extractor_sdk::{
    Context, Descriptor, Scratch, Trust, array, extraction, key, object, path, read_json, relationship, strings, text, unique_relationships,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub const ID: &str = "nuget-dependencies";

/// The project files a restore covers by default: every one in the revision.
const PROJECT_EXTENSIONS: [&str; 3] = [".csproj", ".fsproj", ".vbproj"];

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "NuGet dependencies",
        description: "Resolved NuGet project.assets.json graph",
        schema: "graph/v0",
        renderer: "dependencies",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({
            "assetsPaths":"Explicit array of restored obj/project.assets.json paths, part of each revision; otherwise each revision is restored",
            "projects":"Array of project files to restore; default every .csproj, .fsproj and .vbproj",
            "dotnet":"The dotnet executable that restores; default dotnet"
        }),
        template_inputs: None,
        detects: &["**/*.csproj", "**/*.fsproj", "**/*.vbproj"],
    }
}

/// Importing assets reads files; restoring runs the repository's NuGet configuration and MSBuild.
pub fn requires_trust(inputs: &Value) -> bool {
    inputs.get("assetsPaths").is_none()
}

pub fn collect(cx: &Context) -> Result<Value> {
    let d = cx.definition();
    let assets = if d["inputs"].get("assetsPaths").is_some() {
        imported(cx, d)?
    } else {
        restored(cx, d)?
    };
    let restore = d["inputs"].get("assetsPaths").is_none();
    graph(assets, restore)
}

/// The declared assets files of the revision. One a checkout has on disk but Git
/// ignores isn't part of the revision, so it is named rather than treated as missing.
fn imported(cx: &Context, d: &Value) -> Result<Vec<(String, Value)>> {
    let mut assets = vec![];
    for filename in strings(&d["inputs"]["assetsPaths"], "inputs.assetsPaths")? {
        // A revision without a declared assets file (before its project was added) has no packages there.
        if cx.input_exists(&filename)? {
            assets.push((filename.clone(), cx.read_json(&filename)?));
        } else if ignored(cx, &filename) {
            bail!(
                "{filename} is ignored by Git, so it isn't part of the revision. Omit inputs.assetsPaths to restore each revision with the repository's dotnet (requires --trust), or commit the assets"
            );
        }
    }
    Ok(assets)
}

/// Whether a checkout has `relative` on disk although it isn't one of the revision's files.
fn ignored(cx: &Context, relative: &str) -> bool {
    matches!(cx.mode(), "in-place" | "workspace")
        && cx
            .directory()
            .and_then(|root| path(root, relative, false, false).ok())
            .is_some_and(|file| file.is_file())
}

/// Restores each project of the revision with the repository's `dotnet`, writing
/// its assets to a private folder rather than the project's `obj/`. Each restore
/// covers only its project (`RestoreRecursive=false`): referenced projects are
/// restored as projects of their own, and their assets never overwrite another's.
fn restored(cx: &Context, d: &Value) -> Result<Vec<(String, Value)>> {
    cx.require_trust()?;
    let projects = match d["inputs"].get("projects") {
        Some(value) => {
            let mut present = vec![];
            for project in strings(value, "inputs.projects")? {
                if cx.input_exists(&project)? {
                    present.push(project);
                }
            }
            present
        }
        None => cx
            .files()?
            .iter()
            .filter(|file| PROJECT_EXTENSIONS.iter().any(|extension| file.ends_with(extension)))
            .cloned()
            .collect(),
    };
    // A revision without projects (before the first was added) has no packages.
    if projects.is_empty() {
        return Ok(vec![]);
    }
    let root = cx.root();
    let scratch = Scratch::new(root, "nuget")?;
    let mut dotnet = Dotnet::new(cx, &scratch.0)?;
    let mut assets = vec![];
    for (index, project) in projects.iter().enumerate() {
        let file = path(root, project, false, false)?;
        dotnet.use_packages(cx, file.parent().unwrap_or(root), &scratch.0)?;
        let output = scratch.0.join("assets").join(index.to_string());
        dotnet.run(
            cx,
            root,
            vec![
                "restore".into(),
                file.to_string_lossy().into_owned(),
                "-p:RestoreRecursive=false".into(),
                // MSBuild expects the trailing separator.
                format!("-p:MSBuildProjectExtensionsPath={}{}", output.display(), std::path::MAIN_SEPARATOR),
                "-nodeReuse:false".into(),
                "--disable-build-servers".into(),
                "--nologo".into(),
                "--verbosity".into(),
                "quiet".into(),
            ],
            None,
        )?;
        let model = read_json(&output, "project.assets.json").with_context(|| format!("dotnet restore wrote no assets for {project}"))?;
        assets.push((project.clone(), model));
    }
    Ok(assets)
}

/// The resolved graph of every assets file: `(name, assets)` pairs, named in errors.
fn graph(assets: Vec<(String, Value)>, restore: bool) -> Result<Value> {
    let (mut nodes, mut edges) = (vec![], vec![]);
    let mut project_names = BTreeSet::new();
    for (filename, model) in assets {
        ensure!(
            model["version"] == 3 || model["version"] == 4,
            "Unsupported NuGet assets version {}; expected version 3 or 4",
            model["version"]
        );
        for log in array(model.get("logs").unwrap_or(&json!([])), "assets.logs")? {
            ensure!(
                object(log, "restore log")?.get("level") != Some(&json!("Error")),
                "NuGet assets contain restore errors: {filename}"
            );
        }
        let project = &model["project"];
        object(project, "assets.project")?;
        object(&project["restore"], "assets.project.restore")?;
        let name = text(&project["restore"]["projectName"], "restore.projectName")?;
        ensure!(
            project_names.insert(name.to_owned()),
            "Ambiguous NuGet project name {name}; project names must be unique"
        );
        let project_id = key(&["nuget-project", name]);
        nodes.push(json!({"id":project_id,"kind":"project","label":name,"confidence":"authoritative"}));
        let frameworks = object(&project["frameworks"], "project.frameworks")?;
        let libraries = object(&model["libraries"], "assets.libraries")?;
        for (target, resolved) in object(&model["targets"], "assets.targets")? {
            let tfm = target.split('/').next().unwrap();
            let framework = frameworks
                .get(tfm)
                .or_else(|| frameworks.values().find(|f| f["targetAlias"] == tfm))
                .with_context(|| format!("NuGet target {target} has no project framework"))?;
            object(framework, "framework")?;
            let framework_name = if model["version"] == 4 {
                text(&framework["framework"], "NuGet v4 framework.framework")?
            } else {
                tfm
            };
            let framework_id = key(&["nuget-target", name, target]);
            nodes.push(json!({"id":framework_id,"kind":"target-framework","label":target,"data":{"framework":framework_name},"confidence":"authoritative"}));
            edges.push(relationship("targets", &project_id, &framework_id));
            let resolved = object(resolved, &format!("target {target}"))?;
            let mut packages = BTreeMap::new();
            for (identity, info) in resolved {
                let (package_name, version) = identity
                    .rsplit_once('/')
                    .filter(|(n, _)| !n.is_empty())
                    .with_context(|| format!("Invalid NuGet resolved identity {identity}"))?;
                let lib = libraries.get(identity).with_context(|| format!("Missing libraries.{identity}"))?;
                object(info, "target library")?;
                object(lib, "library")?;
                let kind = text(info.get("type").unwrap_or(&lib["type"]), "library.type")?;
                // NuGet package IDs are case-insensitive, and the version is data, so a
                // version bump is one modified package.
                let id = key(&["nuget-library", name, target, &package_name.to_lowercase()]);
                ensure!(
                    packages.insert(package_name.to_lowercase(), id.clone()).is_none(),
                    "Ambiguous NuGet resolution for {package_name}"
                );
                nodes.push(
                    json!({"id":id,"kind":if kind=="project"{"project-reference"}else{"package"},"label":package_name,
                    "data":{"version":version,"target":target,"type":kind},"confidence":"authoritative"}),
                );
                edges.push(relationship("resolved", &framework_id, &id));
            }
            for (identity, info) in resolved {
                let from = &packages[&identity.rsplit_once('/').unwrap().0.to_lowercase()];
                for dependency in object(info.get("dependencies").unwrap_or(&json!({})), "library.dependencies")?.keys() {
                    let to = packages
                        .get(&dependency.to_lowercase())
                        .with_context(|| format!("Unresolved NuGet dependency {dependency} in {target}"))?;
                    edges.push(relationship("depends-on", from, to));
                }
            }
            for dependency in object(framework.get("dependencies").unwrap_or(&json!({})), "framework.dependencies")?.keys() {
                let to = packages
                    .get(&dependency.to_lowercase())
                    .with_context(|| format!("Unresolved direct NuGet dependency {dependency}"))?;
                edges.push(relationship("direct-dependency", &framework_id, to));
            }
        }
    }
    let projects: BTreeMap<_, _> = nodes
        .iter()
        .filter(|n| n["kind"] == "project")
        .map(|n| (n["label"].as_str().unwrap().to_lowercase(), n["id"].as_str().unwrap().to_owned()))
        .collect();
    for node in nodes.iter().filter(|n| n["kind"] == "project-reference") {
        if let Some(target) = projects.get(&node["label"].as_str().unwrap().to_lowercase()) {
            edges.push(relationship("references-project", node["id"].as_str().unwrap(), target));
        }
    }
    Ok(extraction(
        "graph/v0",
        nodes,
        unique_relationships(edges),
        Some(json!({
            "source":"NuGet project.assets.json","effective":true,
            "limitations":[if restore {"Each revision is restored with the repository's NuGet configuration and feeds, so floating versions resolve to what the feeds offer when it is extracted."} else {"Requires an existing successful restore; no restore is executed."},"Project names must be unique across the restored or supplied assets files."]
        })),
    ))
}
