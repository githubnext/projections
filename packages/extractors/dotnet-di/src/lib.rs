//! Executed .NET service registrations and the constructor graph they compose,
//! read from the application's host or an explicit factory.
//!
//! Shares the .NET helper in `../dotnet-support`.

use anyhow::Result;
use projections_extractor_dotnet_support::Contract;
use projections_extractor_sdk::{Context, Descriptor, Trust};
use serde_json::{Value, json};

pub const ID: &str = "dotnet-di";

const CONTRACT: Contract = Contract {
    id: ID,
    schema: "architecture/v0",
    composition: true,
    validate,
};

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: ".NET dependency injection",
        description: "Executed .NET service registrations and the constructor graph they compose",
        schema: "architecture/v0",
        renderer: "dependency-injection",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({
            "project": "Application project path",
            "assembly": "Application assembly; default the project's build output",
            "factoryType": "Optional factory type full name; default the application's host",
            "factoryMethod": "Optional static factory method",
            "environment": "Context environment; default Development",
            "dotnet": "The dotnet executable path, not a shell command; default dotnet on PATH",
            "snapshot": "Pre-exported DI state",
        }),
        template_inputs: Some(json!({"project":"src/App/App.csproj"})),
        detects: &["**/Program.cs", "**/Startup.cs"],
    }
}

pub fn requires_trust(inputs: &Value) -> bool {
    projections_extractor_dotnet_support::requires_trust(inputs)
}

/// The vocabulary every extraction declares, defined in `docs/models/dependency-injection-model.md`.
pub const VOCABULARY: &str = "dependency-injection/v0";

pub fn collect(cx: &Context) -> Result<Value> {
    let mut extraction = extract(cx)?;
    extraction["vocabularies"] = json!([VOCABULARY]);
    Ok(extraction)
}

fn extract(cx: &Context) -> Result<Value> {
    projections_extractor_dotnet_support::collect(cx, &CONTRACT)
}

fn validate(_value: &Value) -> Result<()> {
    Ok(())
}
