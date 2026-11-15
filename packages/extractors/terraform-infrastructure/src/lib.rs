//! Terraform infrastructure graph, from `terraform show -json`.
//!
//! One extraction is the infrastructure a revision's plan leaves behind: every
//! resource after apply, with the planned action that gets it there, joined by
//! the references in the configuration and grouped by module. See
//! `docs/models/infrastructure-model.md`.

mod entity;
mod graph;
mod modules;
mod native;
mod plan;
mod references;
mod sensitive;

use anyhow::Result;
use graph::infrastructure;
use native::native;
use projections_extractor_sdk::{Context, Descriptor, Trust, input, read_json};
use serde_json::{Value, json};

#[cfg(test)]
use {
    modules::{module_of, module_parent},
    plan::action,
    references::configuration::longest,
    sensitive::{Secrets, safe},
};

pub const ID: &str = "terraform-infrastructure";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Terraform infrastructure",
        description: "Terraform resources, modules and references, with each resource's planned action",
        schema: "architecture/v0",
        renderer: "infrastructure",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({
            "planJsonPath":"Pre-exported `terraform show -json` of a saved plan (or of the state); read without running Terraform",
            "planPath":"Saved binary plan, read with `terraform show -json` (requires --trust)",
            "directory":"Terraform working directory to plan when neither file is given (requires --trust; default: the repository root)",
            "planArguments":"Extra `terraform plan` arguments, for example [\"-var-file=prod.tfvars\"]",
            "terraformPath":"Terraform (or OpenTofu) executable; default `terraform`"
        }),
        template_inputs: Some(json!({"planJsonPath":".projections/inputs/terraform.json"})),
        detects: &["*.tf", "**/*.tf"],
    }
}

pub fn requires_trust(inputs: &Value) -> bool {
    inputs.get("planJsonPath").is_none()
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
    let document = if definition["inputs"].get("planJsonPath").is_some() {
        let file = input(definition, "planJsonPath", None)?;
        if !cx.input_exists(file)? {
            return infrastructure(&ABSENT);
        }
        read_json(root, file)?
    } else {
        match native(root, definition, cx)? {
            Some(document) => document,
            None => return infrastructure(&ABSENT),
        }
    };
    infrastructure(&document)
}

/// What a revision without the declared plan or configuration describes: no resources.
static ABSENT: std::sync::LazyLock<Value> = std::sync::LazyLock::new(|| json!({"format_version": "1.0"}));

#[cfg(test)]
mod tests;
