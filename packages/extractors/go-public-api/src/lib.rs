//! Go public API from go/types.
//!
//! Runs the shared Go helper's `api` mode with the project's own Go toolchain:
//! every exported package-level declaration of the importable matched packages,
//! with method sets and selectable fields, and the contract facts apidiff's
//! compatibility rules inspect. The helper uses only the Go standard library.

use anyhow::{Result, ensure};
use projections_extractor_go_support::{patterns, run_helper};
use projections_extractor_sdk::{Context, Descriptor, Trust, array, exported, extraction, object};
use serde_json::{Value, json};

pub const ID: &str = "go-public-api";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Go public API",
        description: "go/types exported declarations, method sets and fields",
        schema: "api/v0",
        renderer: "api",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({"patterns":"Go package patterns; default [\"./...\"]","goHelperPath":"Optional compatible helper executable","goPath":"Go executable"}),
        template_inputs: None,
        detects: &["go.mod", "**/go.mod"],
    }
}

pub fn requires_trust(_inputs: &Value) -> bool {
    true
}

pub fn collect(cx: &Context) -> Result<Value> {
    let d = cx.definition();
    let mut present = vec![];
    for pattern in patterns(d)? {
        // `./pkg/...` and `./pkg` name a directory; a revision without it (before it
        // was added) has no packages there. Import paths aren't checked.
        let directory = pattern.strip_suffix("/...").unwrap_or(&pattern);
        let local = directory == "." || directory.starts_with("./");
        if !local || cx.input_exists(directory)? {
            present.push(pattern);
        }
    }
    if present.is_empty() {
        return Ok(extraction("api/v0", vec![], vec![], Some(json!({"ecosystem": "go"}))));
    }
    let model = exported(run_helper(cx, "api", present)?, "api/v0")?;
    let entities = array(&model["entities"], "entities")?.clone();
    ensure!(
        entities.iter().all(|entity| entity["data"]["signature"].is_string()),
        "Every Go API declaration must have `data.signature`"
    );
    let metadata = object(&model["metadata"], "Go helper metadata")?.clone();
    ensure!(
        metadata.get("ecosystem") == Some(&json!("go")),
        "The Go helper's `api` mode must declare the `go` ecosystem"
    );
    Ok(extraction(
        "api/v0",
        entities,
        array(&model["relationships"], "relationships")?.clone(),
        Some(Value::Object(metadata)),
    ))
}
