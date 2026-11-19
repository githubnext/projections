//! Swift public API, from the compiler's symbol graphs.
//!
//! Runs the project's own `swift package dump-symbol-graph`, which builds the
//! package and writes one symbol graph per module, and converts the public
//! symbols of its library products' modules into `api/v0` declarations with
//! their contract facts. Symbol graphs generated elsewhere (by
//! `swift build -emit-symbol-graph`, `xcodebuild` or `swift-symbolgraph-extract`)
//! can be imported instead.

mod model;

pub use model::{Sources, api};

use anyhow::{Context as _, Result, bail};
use projections_extractor_sdk::{
    Context, Descriptor, Scratch, Trust, canonical, execute, input, parse_json, path, read_file, run, strings,
};
use projections_extractor_swift_support::manifest::dump;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

pub const ID: &str = "swift-public-api";

/// The largest symbol graph read.
const MAX_GRAPH_BYTES: usize = 32 * 1024 * 1024;

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Swift public API",
        description: "Swift compiler symbol graph public declarations",
        schema: "api/v0",
        renderer: "api",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({
            "packagePath": "Repository-relative package directory; default \".\"",
            "modules": "Modules to include; default the targets of the package's library products",
            "scratchPath": "Build directory, relative to the package; default a private one per run",
            "swiftPath": "Swift executable; default swift",
            "symbolGraphPath": "Directory of pre-generated *.symbols.json files; otherwise runs swift package dump-symbol-graph"
        }),
        template_inputs: None,
        detects: &["Package.swift"],
    }
}

pub fn requires_trust(inputs: &Value) -> bool {
    inputs.get("symbolGraphPath").is_none()
}

pub fn collect(cx: &Context) -> Result<Value> {
    let (root, definition) = (cx.root(), cx.definition());
    let imported = definition["inputs"].get("symbolGraphPath").is_some();
    let package = input(definition, "packagePath", Some("."))?;
    let declared = if imported {
        input(definition, "symbolGraphPath", None)?
    } else {
        package
    };
    let manifest = if package == "." {
        "Package.swift".to_owned()
    } else {
        format!("{}/Package.swift", package.trim_end_matches('/'))
    };
    // A revision without the package or the graphs (before they were added) has no API.
    if !cx.input_exists(if imported { declared } else { manifest.as_str() })? {
        return Ok(projections_extractor_sdk::extraction(
            "api/v0",
            vec![],
            vec![],
            Some(json!({"ecosystem": "swift"})),
        ));
    }
    let requested = match definition["inputs"].get("modules") {
        Some(modules) => Some(strings(modules, "inputs.modules")?.into_iter().collect::<BTreeSet<_>>()),
        None => None,
    };
    let (graphs, modules, absolute) = if imported {
        let graphs = revision_graphs(cx, declared)?;
        let modules = requested.unwrap_or_else(|| {
            graphs
                .iter()
                .filter_map(|graph| graph["module"]["name"].as_str().map(str::to_owned))
                .collect()
        });
        (graphs, modules, None)
    } else {
        let directory = canonical(&path(root, package, false, false)?)?;
        let (graphs, libraries) = dumped(cx, definition, &directory)?;
        (
            graphs,
            requested.unwrap_or(libraries),
            Some(directory.to_string_lossy().replace('\\', "/")),
        )
    };
    let base = if imported { "." } else { package };
    api(&graphs, &modules, &Sources { absolute, base })
}

/// Runs `swift package dump-symbol-graph` for the package in `directory` and
/// reads every graph it wrote, with the targets of the package's library
/// products (from `swift package dump-package`).
fn dumped(cx: &Context, definition: &Value, directory: &Path) -> Result<(Vec<Value>, BTreeSet<String>)> {
    cx.require_trust()?;
    let swift = input(definition, "swiftPath", Some("swift"))?.to_owned();
    let _scratch;
    let scratch = match definition["inputs"].get("scratchPath") {
        Some(_) => path(directory, input(definition, "scratchPath", None)?, false, true)?,
        None => {
            _scratch = Scratch::new(directory, "symbolgraph")?;
            _scratch.0.clone()
        }
    };
    let package = |command: &[&str]| -> Vec<String> {
        let mut argv = vec![
            swift.clone(),
            "package".into(),
            "--package-path".into(),
            directory.to_string_lossy().into_owned(),
        ];
        argv.extend(["--scratch-path".into(), scratch.to_string_lossy().into_owned()]);
        if directory.join("Package.resolved").is_file() {
            argv.push("--force-resolved-versions".into());
        }
        argv.extend(command.iter().map(|part| (*part).to_owned()));
        argv
    };
    let manifest = dump::read(&run(cx, directory, package(&["dump-package"]), None, BTreeMap::new())?)?;
    let libraries = manifest
        .products
        .iter()
        .filter(|product| product.kind == "library")
        .flat_map(|product| product.targets.iter().cloned())
        .collect();
    let output = execute(
        cx,
        directory,
        package(&[
            "dump-symbol-graph",
            "--skip-synthesized-members",
            "--minimum-access-level",
            "public",
            "--skip-inherited-docs",
        ]),
        None,
        BTreeMap::new(),
        true,
    )?;
    let written = output
        .lines()
        .find_map(|line| line.trim().strip_prefix("Files written to "))
        .map(PathBuf::from);
    let folder = match written {
        Some(folder) => folder,
        None => find(&scratch).context("`swift package dump-symbol-graph` wrote no symbol graphs")?,
    };
    Ok((graphs(&folder)?, libraries))
}

/// The `symbolgraph` folder under a build directory.
fn find(scratch: &Path) -> Option<PathBuf> {
    fs::read_dir(scratch)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path().join("symbolgraph"))
        .find(|folder| folder.is_dir())
}

/// The `*.symbols.json` files directly in the revision's `folder`, read through
/// the revision's files: an ignored or untracked graph beside them is not
/// part of the revision, so it never changes the API.
fn revision_graphs(cx: &Context, folder: &str) -> Result<Vec<Value>> {
    let prefix = format!("{}/", folder.trim_end_matches('/'));
    let files: Vec<&String> = cx
        .files()?
        .iter()
        .filter(|file| file.ends_with(".symbols.json") && file.strip_prefix(&prefix).is_some_and(|name| !name.contains('/')))
        .collect();
    if files.is_empty() {
        bail!("{folder} holds no *.symbols.json symbol graphs in the revision");
    }
    files
        .into_iter()
        .map(|file| {
            let text = String::from_utf8(cx.read_bytes(file, MAX_GRAPH_BYTES)?).context("A symbol graph isn't UTF-8")?;
            parse_json(&text).with_context(|| format!("{file} isn't a symbol graph"))
        })
        .collect()
}

/// Every `*.symbols.json` the compiler wrote in `folder`, in name order.
fn graphs(folder: &Path) -> Result<Vec<Value>> {
    let mut files: Vec<PathBuf> = fs::read_dir(folder)
        .with_context(|| format!("Cannot read symbol graphs in {}", folder.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|file| file.to_string_lossy().ends_with(".symbols.json"))
        .collect();
    files.sort();
    if files.is_empty() {
        bail!("{} holds no *.symbols.json symbol graphs", folder.display());
    }
    files
        .iter()
        .map(|file| {
            let text = String::from_utf8(read_file(file, MAX_GRAPH_BYTES)?).context("A symbol graph isn't UTF-8")?;
            parse_json(&text).with_context(|| format!("{} isn't a symbol graph", file.display()))
        })
        .collect()
}

#[cfg(test)]
mod tests;
