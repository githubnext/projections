//! Effective EF Core model from the application's `DbContext`, found the way
//! `dotnet ef` finds it, or from an explicit factory.
//!
//! Shares the .NET helper in `../dotnet-support`.

use anyhow::{Result, ensure};
use projections_extractor_dotnet_support::Contract;
use projections_extractor_sdk::{Context, Descriptor, Trust, array};
use serde_json::{Value, json};

pub const ID: &str = "efcore-schema";

const CONTRACT: Contract = Contract {
    id: ID,
    schema: "database/v0",
    composition: true,
    validate,
};

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "EF Core schema",
        description: "Effective EF Core model",
        schema: "database/v0",
        renderer: "database",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({
            "project": "Application project path",
            "assembly": "Assembly path; default the project's build output",
            "context": "DbContext type when there are several",
            "factoryType": "Optional factory type; default design-time factories or the application's host",
            "factoryMethod": "Optional static factory method",
            "environment": "Context environment; default Development",
            "dotnet": "The dotnet executable path, not a shell command; default dotnet on PATH",
            "snapshot": "Pre-exported effective schema",
        }),
        template_inputs: Some(json!({"project":"src/App/App.csproj"})),
        detects: &["**/*DbContext.cs"],
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
        if node["kind"] == "column" {
            ensure!(node["data"]["type"].is_string(), "Every EF Core column must have data.type");
        }
    }
    Ok(())
}
