//! Where an extraction ran and how faithful it is: an extraction document's
//! `provenance.execution`.

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};

use super::{
    fields, identifier, text,
    values::{hex, strings},
};

/// Where an extraction ran and how faithful it is (`provenance.execution`).
pub fn validate_execution(value: &Value) -> Result<Value> {
    fields(
        value,
        &[
            "source",
            "fidelity",
            "tree",
            "strategy",
            "prepared",
            "scope",
            "ci",
            "determinism",
            "environment",
            "at",
            "official",
        ],
        "provenance.execution",
    )?;
    let source = value["source"].as_str().unwrap_or_default();
    ensure!(
        matches!(
            source,
            "ci" | "local-in-place" | "local-git-objects" | "local-workspace" | "local-materialized"
        ),
        "Unsupported provenance.execution.source"
    );
    let fidelity = value["fidelity"].as_str().unwrap_or_default();
    ensure!(
        matches!(fidelity, "exact" | "approximate" | "stale"),
        "Unsupported provenance.execution.fidelity"
    );
    let mut normalized = json!({"source": source, "fidelity": fidelity});
    if let Some(tree) = value.get("tree") {
        let tree = tree.as_str().unwrap_or_default();
        ensure!(hex(tree, &[40, 64]), "provenance.execution.tree must be a Git tree ID");
        normalized["tree"] = json!(tree);
    }
    if let Some(strategy) = value.get("strategy") {
        let strategy = strategy.as_str().unwrap_or_default();
        ensure!(
            matches!(strategy, "fresh" | "worktree" | "clone" | "sparse"),
            "Unsupported provenance.execution.strategy"
        );
        normalized["strategy"] = json!(strategy);
    }
    if let Some(prepared) = value.get("prepared") {
        let steps = prepared.as_array().context("provenance.execution.prepared must be an array")?;
        ensure!(steps.len() <= 50, "At most 50 prepared steps");
        for step in steps {
            fields(step, &["id", "key"], "provenance.execution.prepared[]")?;
            identifier(&step["id"], "prepared step id")?;
            let key = step["key"].as_str().unwrap_or_default();
            ensure!(
                key.strip_prefix("sha256:").is_some_and(|key| hex(key, &[64])),
                "A prepared step key must be a sha256: digest"
            );
        }
        normalized["prepared"] = prepared.clone();
    }
    if let Some(scope) = value.get("scope") {
        normalized["scope"] = strings(scope, "provenance.execution.scope")?;
    }
    if let Some(determinism) = value.get("determinism") {
        ensure!(
            determinism
                .as_str()
                .and_then(projections_extractor_sdk::Determinism::parse)
                .is_some(),
            "Unsupported provenance.execution.determinism"
        );
        normalized["determinism"] = determinism.clone();
    }
    if let Some(environment) = value.get("environment") {
        let environment = environment.as_str().unwrap_or_default();
        ensure!(
            environment.strip_prefix("sha256:").is_some_and(|hash| hex(hash, &[64])),
            "provenance.execution.environment must be a sha256: fingerprint"
        );
        normalized["environment"] = json!(environment);
    }
    if let Some(at) = value.get("at") {
        let at = at.as_str().unwrap_or_default();
        ensure!(
            regex::Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")?.is_match(at),
            "provenance.execution.at must be a UTC time such as 2026-01-31T12:00:00Z"
        );
        normalized["at"] = json!(at);
    }
    if let Some(official) = value.get("official") {
        ensure!(official.is_boolean(), "provenance.execution.official must be a boolean");
        normalized["official"] = official.clone();
    }
    if let Some(ci) = value.get("ci") {
        fields(ci, &["repository", "run", "workflow", "authentication"], "provenance.execution.ci")?;
        if let Some(workflow) = ci.get("workflow") {
            text(workflow, "provenance.execution.ci.workflow")?;
        }
        if let Some(authentication) = ci.get("authentication") {
            ensure!(
                matches!(authentication.as_str(), Some("download" | "attestation")),
                "Unsupported provenance.execution.ci.authentication"
            );
        }
        text(&ci["repository"], "provenance.execution.ci.repository")?;
        ensure!(
            ci["run"].as_u64().is_some_and(|run| run > 0),
            "provenance.execution.ci.run must be a positive integer"
        );
        normalized["ci"] = ci.clone();
    }
    Ok(normalized)
}
