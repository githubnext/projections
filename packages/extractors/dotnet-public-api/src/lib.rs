//! Roslyn/.NET effective public API, compiled with the project's own SDK.
//!
//! Shares the .NET helper in `../dotnet-support`.

use anyhow::{Result, ensure};
use projections_extractor_dotnet_support::Contract;
use projections_extractor_sdk::{Context, Descriptor, Trust, array};
use serde_json::{Value, json};

pub const ID: &str = "dotnet-public-api";

const CONTRACT: Contract = Contract {
    id: ID,
    schema: "api/v0",
    composition: false,
    validate,
};

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: ".NET public API",
        description: "Roslyn/.NET effective public API",
        schema: "api/v0",
        renderer: "api",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({"project":"Project path to compile","dotnet":"The dotnet executable path, not a shell command; default dotnet on PATH","snapshot":"Pre-exported graph-backed API state","framework":"Target framework","configuration":"Build configuration; default Release"}),
        template_inputs: Some(json!({"project":"src/App/App.csproj"})),
        detects: &["**/*.csproj"],
    }
}

pub fn requires_trust(inputs: &Value) -> bool {
    projections_extractor_dotnet_support::requires_trust(inputs)
}

pub fn collect(cx: &Context) -> Result<Value> {
    projections_extractor_dotnet_support::collect(cx, &CONTRACT)
}

fn validate(value: &Value) -> Result<()> {
    for node in array(&value["entities"], "entities")? {
        ensure!(
            node["data"]["signature"].is_string(),
            "Every .NET API node must have `data.signature`"
        );
    }
    Ok(())
}
