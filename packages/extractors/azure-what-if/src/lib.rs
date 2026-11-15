//! Azure infrastructure graph, from an Azure Resource Manager what-if result.
//!
//! One extraction is the resources a deployment leaves in its scope: every
//! resource ARM predicts, with the change that gets it there, contained by its
//! resource group and parent resource and joined by the resource IDs in its
//! properties. See `docs/models/infrastructure-model.md`.

mod expressions;
mod infrastructure;
mod native;
mod payload;
mod resource_id;

use anyhow::Result;
use infrastructure::infrastructure;
use native::native;
use projections_extractor_sdk::{Context, Descriptor, Trust, input, read_json};
use serde_json::{Value, json};

#[cfg(test)]
use expressions::{Evaluated, Expressions};
#[cfg(test)]
use payload::safe;
#[cfg(test)]
use resource_id::parse_id;

pub const ID: &str = "azure-what-if";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Azure infrastructure",
        description: "Azure resources, containment and references, with each resource's what-if change",
        schema: "architecture/v0",
        renderer: "infrastructure",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({
            "whatIfJsonPath":"Pre-exported `az deployment … what-if --no-pretty-print` result; read without running Azure CLI",
            "templateJsonPath":"Optional compiled ARM template (`bicep build` output) whose dependsOn adds dependencies",
            "templateFile":"Bicep or ARM template to run what-if for (requires --trust and an Azure CLI login)",
            "scope":"Deployment scope for templateFile: group (default), sub, mg or tenant",
            "resourceGroup":"Resource group (scope group)",
            "subscription":"Subscription name or ID; default the CLI's current subscription",
            "managementGroupId":"Management group (scope mg)",
            "location":"Deployment location (scopes sub, mg and tenant)",
            "mode":"Incremental (default) or Complete (scope group)",
            "parameters":"Parameter files (repository-relative) or name=value pairs",
            "azPath":"Azure CLI executable; default `az`"
        }),
        template_inputs: Some(json!({"whatIfJsonPath":".projections/inputs/what-if.json"})),
        detects: &["*.bicep", "**/*.bicep"],
    }
}

pub fn requires_trust(inputs: &Value) -> bool {
    inputs.get("whatIfJsonPath").is_none()
}

/// The vocabulary every extraction declares, defined in `docs/models/infrastructure-model.md`.
pub const VOCABULARY: &str = "infrastructure/v0";

pub fn collect(cx: &Context) -> Result<Value> {
    let mut extraction = extract(cx)?;
    extraction["vocabularies"] = json!([VOCABULARY]);
    Ok(extraction)
}

fn extract(cx: &Context) -> Result<Value> {
    let (root, definition) = (cx.root(), cx.definition());
    let inputs = &definition["inputs"];
    let absent = json!({"status": "Succeeded", "changes": []});
    let (result, template) = if inputs.get("whatIfJsonPath").is_some() {
        let file = input(definition, "whatIfJsonPath", None)?;
        if !cx.input_exists(file)? {
            return infrastructure(&absent, None);
        }
        let template = match inputs.get("templateJsonPath") {
            Some(_) => {
                let template = input(definition, "templateJsonPath", None)?;
                if cx.input_exists(template)? {
                    Some(read_json(root, template)?)
                } else {
                    None
                }
            }
            None => None,
        };
        (read_json(root, file)?, template)
    } else {
        match native(root, definition, cx)? {
            Some(native) => native,
            None => return infrastructure(&absent, None),
        }
    };
    infrastructure(&result, template.as_ref())
}

#[cfg(test)]
mod tests;
