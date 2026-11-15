//! NestJS providers, their modules and the dependency graph NestJS resolves,
//! read through the application's own `@nestjs/core` in preview mode.
//!
//! Runs in the Node helper shipped with Projections (`../typescript-support`),
//! which loads the application with the repository's own TypeScript compiler.

use anyhow::Result;
use projections_extractor_sdk::{Context, Descriptor, Trust, exported, input, read_json};
use serde_json::{Value, json};

pub const ID: &str = "nestjs-di";

const SCHEMA: &str = "architecture/v0";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "NestJS dependency injection",
        description: "NestJS modules, providers and the dependency graph the application's own container resolves",
        schema: SCHEMA,
        renderer: "dependency-injection",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({"entry":"Bootstrap file calling NestFactory; default src/main.ts or the one file that does","module":"Root module as <file>#<class>, instead of the bootstrap file's","tsconfig":"tsconfig.json path; default the nearest to the root module","include":"application (default: application modules and the framework providers they inject) or all","snapshot":"Pre-exported DI state"}),
        template_inputs: None,
        detects: &["**/*.module.ts"],
    }
}

pub fn requires_trust(inputs: &Value) -> bool {
    inputs.get("snapshot").is_none()
}

/// The vocabulary every extraction declares, defined in `docs/models/dependency-injection-model.md`.
pub const VOCABULARY: &str = "dependency-injection/v0";

pub fn collect(cx: &Context) -> Result<Value> {
    let mut extraction = extract(cx)?;
    extraction["vocabularies"] = json!([VOCABULARY]);
    Ok(extraction)
}

fn extract(cx: &Context) -> Result<Value> {
    let (root, definition) = (cx.root(), cx.definition());
    if definition["inputs"].get("snapshot").is_some() {
        let snapshot = input(definition, "snapshot", None)?;
        // A revision without the snapshot (before it was added) has no services.
        if !cx.input_exists(snapshot)? {
            return Ok(projections_extractor_sdk::extraction(SCHEMA, vec![], vec![], None));
        }
        return exported(read_json(root, snapshot)?, SCHEMA);
    }
    // Loading the root module runs the application's decorators, module factories
    // and import-time code.
    cx.require_trust()?;
    // A revision without the declared bootstrap file, root module or configuration
    // (before the application was added) has no services.
    let inputs = &definition["inputs"];
    let module = inputs["module"]
        .as_str()
        .map(|module| module.rsplit_once('#').map_or(module, |(file, _)| file));
    for declared in [inputs["entry"].as_str(), module, inputs["tsconfig"].as_str()]
        .into_iter()
        .flatten()
    {
        if !cx.input_exists(declared)? {
            return Ok(projections_extractor_sdk::extraction(SCHEMA, vec![], vec![], None));
        }
    }
    projections_extractor_typescript_support::node_helper(cx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use projections_extractor_sdk::testing;

    fn fixtures() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
    }

    #[test]
    fn loading_the_application_requires_trust() {
        let definition = json!({"id":"services","extractor":ID,"inputs":{}});
        let error = format!("{:#}", collect(&testing::context(&fixtures(), definition.clone())).unwrap_err());
        assert!(error.contains("pass --trust"), "{error}");
        assert!(requires_trust(&definition["inputs"]));
    }

    #[test]
    fn a_pre_exported_snapshot_needs_no_trust_or_node() {
        let definition = json!({"id":"services","extractor":ID,"inputs":{"snapshot":"nestjs.json"}});
        assert!(!requires_trust(&definition["inputs"]));
        let state = collect(&testing::context(&fixtures(), definition)).unwrap();
        assert!(
            state["entities"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entity| entity["kind"] == "registration")
        );
    }
}
