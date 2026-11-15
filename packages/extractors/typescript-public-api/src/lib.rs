//! TypeScript compiler public export model.
//!
//! Runs in the Node helper shipped with Projections, using the repository's own
//! TypeScript compiler's checker.

use anyhow::Result;
use projections_extractor_sdk::{Context, Descriptor, Trust};
use serde_json::{Value, json};

pub const ID: &str = "typescript-public-api";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "TypeScript public API",
        description: "TypeScript compiler public export model",
        schema: "api/v0",
        renderer: "api",
        trust: Trust::None,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({"tsconfig":"tsconfig.json path","tsconfigs":"Several tsconfig.json paths, instead of tsconfig","entrypoints":"Source paths or export subpath-to-source map"}),
        template_inputs: None,
        detects: &["tsconfig.json", "**/tsconfig.json"],
    }
}

pub fn requires_trust(_inputs: &Value) -> bool {
    false
}

pub fn collect(cx: &Context) -> Result<Value> {
    match projections_extractor_typescript_support::present_inputs(cx)? {
        Some(request) => projections_extractor_typescript_support::node_helper_with(cx, &request),
        // A revision without the declared configuration or entrypoints (before they were added) has no API.
        None => Ok(projections_extractor_sdk::extraction(
            "api/v0",
            vec![],
            vec![],
            Some(json!({"ecosystem": "typescript"})),
        )),
    }
}
