//! The Tetragon agent's Helm values, and the policies its settings stop from loading.

use super::{finding, lookup};
use crate::policy::{ENGINE, Model};
use crate::terms::Terms;
use anyhow::{Result, bail};
use projections_extractor_sdk::{key, parse_yaml_documents, read_source};
use serde_json::{Value, json};
use std::path::Path;

/// The Tetragon agent's configuration from its Helm values file
/// (`install/kubernetes/tetragon/values.yaml` keys), with the chart's defaults.
pub fn agent(model: &mut Model, root: &Path, path: &str) -> Result<()> {
    let documents = parse_yaml_documents(&read_source(root, path)?, path)?;
    let values = documents.into_iter().find(|document| !document.is_null()).unwrap_or(json!({}));
    let flag = |keys: &[&str], default: bool| -> Result<bool> {
        match lookup(&values, keys) {
            None => Ok(default),
            Some(Value::Bool(flag)) => Ok(*flag),
            Some(other) => bail!("{path}: {} must be true or false, not {other}", keys.join(".")),
        }
    };
    let policy_filter = flag(&["tetragon", "enablePolicyFilter"], true)?;
    let persistent = flag(&["tetragon", "enableKeepSensorsOnExit"], false)?;
    let crds = flag(&["tetragonOperator", "tracingPolicy", "enabled"], true)?;
    let id = key(&["agent", ENGINE]);
    model.entities.push(json!({
        "id":id,"kind":"agent","label":"Tetragon agent","confidence":"authoritative",
        "data":{"engine":ENGINE,"path":path,"policyFilter":policy_filter,"persistentEnforcement":persistent,"policyCrds":crds},
        "evidence":[{"kind":"helm-values","source":path}],
    }));
    if !crds {
        finding(
            model,
            &id,
            "crds-disabled",
            Terms::new()
                .code("tetragonOperator.tracingPolicy.enabled")
                .text(" is false, so the ")
                .code("TracingPolicy")
                .text(" CRDs aren't installed and these policies can't be applied as resources."),
            None,
        );
    }
    if !policy_filter {
        let filtered: Vec<String> = model
            .scopes
            .iter()
            .filter(|(_, scope)| {
                !scope.all
                    && (scope.namespace.is_some() || scope.pods.as_ref().is_some_and(|pods| !pods.is_empty()) || scope.containers.is_some())
            })
            .map(|(policy, _)| policy.clone())
            .collect();
        for policy in filtered {
            finding(
                model,
                &policy,
                "policy-filter-disabled",
                Terms::new()
                    .text("The agent's policy filter is off (")
                    .code("tetragon.enablePolicyFilter: false")
                    .text("), so Tetragon rejects this policy's namespace, pod or container filtering and the policy doesn't load."),
                None,
            );
        }
    }
    Ok(())
}
