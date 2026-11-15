//! Tetragon runtime security policies: which kernel and user-space hooks
//! `TracingPolicy` and `TracingPolicyNamespaced` resources observe or enforce,
//! under which conditions and for which workloads.
//!
//! The checked-in YAML is the policy, so reading it runs nothing and needs no
//! trust. The vocabulary is shared by every runtime policy extractor; see
//! `docs/models/runtime-policy-model.md`.

mod crd;
mod documents;
mod enrich;
mod hooks;
mod policy;
mod scope;
mod sources;
mod terms;

use anyhow::Result;
use projections_extractor_sdk::{Context, Descriptor, Trust, extraction, strings, text};
use serde_json::{Value, json};
use sources::{matching, sources};
use std::path::Path;

pub const ID: &str = "tetragon-policies";
pub const SCHEMA: &str = "architecture/v0";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Runtime security policies",
        description: "Kernel and user-space hooks that Tetragon tracing policies observe or enforce, with their conditions and the workloads they apply to",
        schema: SCHEMA,
        renderer: "runtime-policy",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({
            "paths":"Array of globs selecting YAML files to read; default every .yaml and .yml file (none when helm or kustomize is set). Files that don't mention TracingPolicy are skipped",
            "exclude":"Array of globs to skip",
            "namespace":"Namespace for TracingPolicyNamespaced resources and workloads that name none",
            "renderedManifestsPath":"A file of already rendered manifests (for example helm template output from CI) to read instead of paths",
            "helm":"{chart, values?, releaseName?, namespace?, helmPath?}: render a chart in the repository with helm template (requires trust)",
            "kustomize":"{path, kustomizePath?}: render a kustomization in the repository with kustomize build (requires trust)",
            "crdPath":"A file, or array of files, holding the TracingPolicy CRDs the repository deploys; policies are checked against them",
            "agentValuesPath":"The Tetragon Helm chart values file the repository deploys the agent with",
            "kernelProfilesPath":"A YAML or JSON file of kernel profiles ({profiles: [{name, kernel?, config?, symbols?, errorInjection?}]}) of the nodes policies load on",
            "workloadPaths":"Array of globs selecting Kubernetes workload manifests, to show which policies cover which workloads",
        }),
        template_inputs: Some(json!({"paths":["**/*.yaml","**/*.yml"]})),
        detects: &[],
    }
}

pub fn requires_trust(inputs: &Value) -> bool {
    ["helm", "kustomize"]
        .iter()
        .any(|tool| inputs.get(*tool).is_some_and(|value| !value.is_null()))
}

/// The vocabulary every extraction declares, defined in `docs/models/runtime-policy-model.md`.
pub const VOCABULARY: &str = "runtime-policy/v0";

pub fn collect(cx: &Context) -> Result<Value> {
    let mut extraction = extract(cx)?;
    extraction["vocabularies"] = json!([VOCABULARY]);
    Ok(extraction)
}

fn extract(cx: &Context) -> Result<Value> {
    let (root, files, definition) = (cx.root(), cx.files()?, cx.definition());
    let inputs = &definition["inputs"];
    let namespace = inputs
        .get("namespace")
        .filter(|v| !v.is_null())
        .map(|v| text(v, "inputs.namespace"))
        .transpose()?;
    let sources = sources(root, files, definition, cx)?;
    let crds = crds(cx, root, inputs)?;
    let mut model = policy::Model::default();
    let read = documents::read(&mut model, &sources, crds.as_ref(), namespace)?;
    if let Some(crds) = &crds {
        model.limitations.insert(format!(
            "Policies are checked against the CRDs in {} without their CEL rules (`x-kubernetes-validations`).",
            crds.paths
                .iter()
                .map(|path| format!("`{}`", terms::escape(path)))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if let Some(path) = inputs.get("agentValuesPath").filter(|v| !v.is_null()) {
        let path = text(path, "inputs.agentValuesPath")?;
        if cx.input_exists(path)? {
            enrich::agent(&mut model, root, path)?;
        }
    }
    if let Some(path) = inputs.get("kernelProfilesPath").filter(|v| !v.is_null()) {
        let path = text(path, "inputs.kernelProfilesPath")?;
        if cx.input_exists(path)? {
            enrich::kernels(&mut model, root, path)?;
        }
    }
    if let Some(patterns) = inputs.get("workloadPaths").filter(|v| !v.is_null()) {
        let patterns = matching(cx, files, patterns, "inputs.workloadPaths")?;
        if patterns != json!([]) {
            enrich::workloads(&mut model, root, files, &patterns, namespace)?;
        }
    }
    let policies = model.identities.len();
    let mut entities = model.entities;
    entities.extend(model.hooks.into_values());
    entities.extend(model.subjects.into_values());
    Ok(extraction(
        SCHEMA,
        entities,
        model.relationships,
        Some(json!({
            "engine":policy::ENGINE,"policies":policies,"sources":read,
            "limitations":model.limitations.into_iter().collect::<Vec<_>>(),
        })),
    ))
}

/// The repository's policy CRDs, when `inputs.crdPath` names some that exist.
fn crds(cx: &Context, root: &Path, inputs: &Value) -> Result<Option<crd::Crds>> {
    match inputs.get("crdPath").filter(|v| !v.is_null()) {
        None => None,
        Some(Value::String(path)) => Some(vec![path.clone()]),
        Some(paths) => Some(strings(paths, "inputs.crdPath")?),
    }
    .map(|paths| {
        paths
            .into_iter()
            .filter_map(|path| match cx.input_exists(&path) {
                Ok(true) => Some(Ok(path)),
                Ok(false) => None,
                Err(error) => Some(Err(error)),
            })
            .collect::<Result<Vec<_>>>()
    })
    .transpose()?
    .filter(|paths| !paths.is_empty())
    .map(|paths| crd::Crds::read(root, &paths, &["TracingPolicy", "TracingPolicyNamespaced"]))
    .transpose()
}
