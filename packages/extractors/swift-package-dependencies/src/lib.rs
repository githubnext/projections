//! A Swift package's graph: its products and targets, what each target
//! depends on, and the packages it uses with the versions `Package.resolved`
//! pins. `Package.swift` is read without running it by default; SwiftPM's own
//! evaluation (`swift package dump-package`) is opt-in.

mod graph;
mod packages;

use anyhow::{Result, bail};
use packages::Mode;
use projections_extractor_sdk::{Context, Descriptor, Trust, extraction, input, relative_path};
use serde_json::{Value, json};

pub const ID: &str = "swift-package-dependencies";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Swift package dependencies",
        description: "Swift package products, targets, target dependencies and package dependencies with Package.resolved versions",
        schema: "graph/v0",
        renderer: "dependencies",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Files,
        determinism: projections_extractor_sdk::Determinism::Pure,
        inputs: json!({
            "root": "Repository-relative package directory; default \".\"",
            "manifest": "\"static\" reads Package.swift without running it (default); \"dump-package\" runs swift package dump-package",
            "manifestJsonPath": "Pre-exported swift package dump-package JSON for the root package",
            "swiftPath": "Swift executable for dump-package; default swift"
        }),
        template_inputs: None,
        detects: &["Package.swift"],
    }
}

/// Only `swift package dump-package` runs anything: it compiles and runs the manifest.
pub fn requires_trust(inputs: &Value) -> bool {
    inputs.get("manifest").and_then(Value::as_str) == Some("dump-package")
}

pub fn collect(cx: &Context) -> Result<Value> {
    let definition = cx.definition();
    let root = relative_path(input(definition, "root", Some("."))?)?
        .to_string_lossy()
        .replace('\\', "/");
    let mode = mode(definition)?;
    let manifest = join(&root, "Package.swift");
    let declared = match &mode {
        Mode::Imported(path) => path.to_string(),
        _ => manifest,
    };
    // A revision without the package (before it was added) has no graph.
    if !cx.input_exists(&declared)? {
        return Ok(extraction(
            "graph/v0",
            vec![],
            vec![],
            Some(json!({"packages": [], "unresolved": []})),
        ));
    }
    let packages = packages::read(cx, &root, &mode)?;
    let resolved = join(&root, "Package.resolved");
    let pins = if cx.exists(&resolved)? {
        projections_extractor_swift_support::resolved::read(&cx.read_json(&resolved)?)?
    } else {
        Vec::new()
    };
    let graph = graph::Graph::build(&packages, &pins);
    let mut metadata = json!({
        "packages": packages.iter().map(packages::Package::describe).collect::<Vec<_>>(),
        "resolved": (!pins.is_empty() || cx.exists(&resolved)?).then_some(resolved),
        "unresolved": graph.unresolved,
    });
    let limitations = packages::limitations(cx, &packages)?;
    if !limitations.is_empty() {
        metadata["limitations"] = json!(limitations);
    }
    Ok(extraction("graph/v0", graph.entities, graph.relationships, Some(metadata)))
}

fn mode(definition: &Value) -> Result<Mode<'_>> {
    let inputs = &definition["inputs"];
    let imported = inputs
        .get("manifestJsonPath")
        .map(|_| input(definition, "manifestJsonPath", None))
        .transpose()?;
    match (input(definition, "manifest", Some("static"))?, imported) {
        ("static", None) => Ok(Mode::Static),
        ("static", Some(path)) => Ok(Mode::Imported(path)),
        ("dump-package", None) => Ok(Mode::DumpPackage {
            swift: input(definition, "swiftPath", Some("swift"))?,
        }),
        ("dump-package", Some(_)) => {
            bail!("`inputs.manifestJsonPath` imports dump-package output; it can't be combined with `inputs.manifest: \"dump-package\"`")
        }
        (other, _) => bail!("`inputs.manifest` must be \"static\" or \"dump-package\", not {other:?}"),
    }
}

/// `name` in the directory `dir` (empty for the project's root).
pub(crate) fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() || dir == "." {
        name.to_owned()
    } else {
        format!("{dir}/{name}")
    }
}

#[cfg(test)]
mod tests;
