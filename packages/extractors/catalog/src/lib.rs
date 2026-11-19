//! The registry of built-in extractors.

use anyhow::{Context as _, Result};
use projections_extractor_sdk::{Context, Descriptor};
use serde_json::{Value, json};

pub use projections_extractor_sdk::Trust;

type Collect = fn(&Context) -> Result<Value>;

/// One registered built-in extractor.
pub struct Extractor {
    pub id: &'static str,
    pub descriptor: fn() -> Descriptor,
    pub requires_trust: fn(&Value) -> bool,
    pub collect: Collect,
}

/// Declares the registry once: each extractor crate supplies its `ID`,
/// `descriptor`, `requires_trust` and `collect`.
macro_rules! registry {
    ($($module:ident),+ $(,)?) => {
        /// Every built-in extractor, in published order.
        const EXTRACTORS: &[Extractor] = &[$(Extractor {
            id: $module::ID,
            descriptor: $module::descriptor,
            requires_trust: $module::requires_trust,
            collect: $module::collect,
        }),+];

        /// Built-in extractor IDs, in published order.
        pub const IDS: &[&str] = &[$($module::ID),+];
    };
}

registry!(
    projections_extractor_workspace_dependencies,
    projections_extractor_repository_map,
    projections_extractor_typescript_public_api,
    projections_extractor_rust_public_api,
    projections_extractor_go_public_api,
    projections_extractor_cargo_dependencies,
    projections_extractor_swift_package_dependencies,
    projections_extractor_xcode_modules,
    projections_extractor_nuget_dependencies,
    projections_extractor_terraform_infrastructure,
    projections_extractor_azure_what_if,
    projections_extractor_github_actions_jobs,
    projections_extractor_github_agentic_workflows,
    projections_extractor_tetragon_policies,
    projections_extractor_dotnet_public_api,
    projections_extractor_dotnet_di,
    projections_extractor_nestjs_di,
    projections_extractor_spring_di,
    projections_extractor_efcore_schema,
    projections_extractor_django_schema,
    projections_extractor_code_statistics,
    projections_extractor_prisma_schema,
    projections_extractor_rails_schema,
    projections_extractor_rails_routes,
    projections_extractor_renderer_scenarios,
    projections_extractor_scip_file_references,
    projections_extractor_command_output,
);

fn template(descriptor: &Descriptor) -> Value {
    let mut template = json!({"id":descriptor.id,"title":descriptor.title,"extractor":descriptor.id,"renderer":descriptor.renderer});
    if let Some(inputs) = &descriptor.template_inputs {
        template["inputs"] = inputs.clone();
    }
    template
}

fn find(id: &str) -> Option<&'static Extractor> {
    EXTRACTORS.iter().find(|extractor| extractor.id == id)
}

pub fn catalog() -> Value {
    let extractors: Vec<Value> = EXTRACTORS
        .iter()
        .map(|extractor| {
            let descriptor = (extractor.descriptor)();
            let template = template(&descriptor);
            json!({
                "id":descriptor.id,"title":descriptor.title,"description":descriptor.description,
                "schema":descriptor.schema,"renderer":descriptor.renderer,"trust":descriptor.trust.as_str(),
                "access":descriptor.access.as_str(),"determinism":descriptor.determinism.as_str(),
                "inputs":descriptor.inputs,"template":template,"detects":descriptor.detects
            })
        })
        .collect();
    json!({"extractors":extractors})
}

pub fn default_definitions() -> Vec<Value> {
    ["workspace-dependencies", "repository-map"]
        .iter()
        .map(|id| template(&(find(id).unwrap().descriptor)()))
        .collect()
}

/// Read-only eligibility; extractors still enforce trust immediately before executing tools.
pub fn requires_trust(definition: &Value) -> bool {
    let Some(id) = definition["extractor"].as_str() else {
        return true;
    };
    find(id).is_some_and(|extractor| (extractor.requires_trust)(&definition["inputs"]))
}

/// Whether the built-in extractor `id`, given `inputs`, only reads files
/// through the Context, so the runner may serve them from Git objects: it
/// declares `access: files`, and these inputs don't make it run a tool (as
/// `swift-package-dependencies` does for `manifest: "dump-package"`), which
/// needs the revision on disk.
pub fn reads_files_only(id: &str, inputs: &Value) -> bool {
    find(id).is_some_and(|extractor| {
        (extractor.descriptor)().access == projections_extractor_sdk::Access::Files && !(extractor.requires_trust)(inputs)
    })
}

/// The determinism class of the built-in extractor `id` given `inputs`, if it
/// exists: the one it declares, or `environmental` when a `pure` extractor's
/// inputs make it run a tool, whose output depends on the toolchain.
pub fn determinism(id: &str, inputs: &Value) -> Option<projections_extractor_sdk::Determinism> {
    use projections_extractor_sdk::Determinism;
    find(id).map(|extractor| match (extractor.descriptor)().determinism {
        Determinism::Pure if (extractor.requires_trust)(inputs) => Determinism::Environmental,
        declared => declared,
    })
}

/// The scope a built-in extractor's inputs imply: the files it reads when its
/// inputs name them (a workflow, schema files or folders, restored assets), or
/// `None` when it reads the whole revision.
pub fn scope(id: &str, inputs: &Value) -> Option<Vec<String>> {
    let paths = |value: &Value| -> Option<Vec<String>> {
        let paths: Vec<String> = match value {
            Value::String(path) => vec![path.clone()],
            Value::Array(items) => items.iter().map(|item| item.as_str().map(str::to_owned)).collect::<Option<_>>()?,
            _ => return None,
        };
        let paths: Vec<String> = paths
            .into_iter()
            .map(|path| path.trim_start_matches("./").trim_end_matches('/').to_owned())
            .collect();
        (!paths.is_empty() && paths.iter().all(|path| !path.is_empty())).then_some(paths)
    };
    match id {
        "github-actions-jobs" => paths(&inputs["workflowPath"]),
        "prisma-schema" => ["snapshot", "schemas", "schema"]
            .iter()
            .find_map(|name| inputs.get(*name).and_then(paths)),
        "nuget-dependencies" => paths(&inputs["assetsPaths"]),
        _ => None,
    }
}

/// The input of the built-in extractor `id` that names one detected file, when
/// it reads one file of several the repository may hold (a workflow): explore
/// then proposes it once per file, with that input set.
pub fn per_file_input(id: &str) -> Option<&'static str> {
    match id {
        "github-actions-jobs" => Some("workflowPath"),
        _ => None,
    }
}

/// Runs the built-in extractor `id` and returns its extraction before Engine
/// normalization. The ID comes from the invocation, not the definition, so a
/// definition may also name the built-in through its command.
pub fn collect(id: &str, cx: &Context) -> Result<Value> {
    let extractor = find(id).with_context(|| format!("No built-in extractor is registered for {id}"))?;
    (extractor.collect)(cx).with_context(|| format!("Extractor {id}"))
}

/// Whether `id` names a built-in extractor.
pub fn exists(id: &str) -> bool {
    find(id).is_some()
}

/// The renderer a built-in extractor's extraction is shown with.
pub fn renderer(id: &str) -> Option<&'static str> {
    find(id).map(|extractor| (extractor.descriptor)().renderer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descriptors_match_their_registered_ids_and_ids_are_unique() {
        let mut seen = std::collections::BTreeSet::new();
        for (id, extractor) in IDS.iter().zip(EXTRACTORS) {
            assert_eq!((extractor.descriptor)().id, *id);
            assert_eq!(extractor.id, *id);
            assert!(seen.insert(*id), "{id} is registered twice");
            // An extractor that only reads files is a function of them.
            let descriptor = (extractor.descriptor)();
            if descriptor.access == projections_extractor_sdk::Access::Files {
                assert_eq!(descriptor.determinism, projections_extractor_sdk::Determinism::Pure, "{id}");
            }
        }
        assert_eq!(IDS.len(), EXTRACTORS.len());
    }
}
