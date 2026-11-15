//! Repository routes that read scenarios or write definitions and adopted projections.

pub(super) mod onboarding;
pub(super) mod scenarios;

use std::sync::Arc;

use anyhow::Result;
use axum::{extract::Request, http::StatusCode, response::Response};
use serde_json::json;

use super::{
    http::{HttpError, json_response, projection_parameter, query_reference, query_value, request_body},
    state::{ServiceState, WORKING_TREE, blocking_runner},
};

pub(super) async fn run_comparator_tests(state: &Arc<ServiceState>, request: Request) -> Result<Response, HttpError> {
    if state.document.is_some() {
        return Err(HttpError::new(
            StatusCode::FORBIDDEN,
            "Offline review has no repository, so no comparator tests",
        ));
    }
    let body = request_body(request).await?;
    let input =
        crate::comparator_tests::RunRequest::parse(&body).map_err(|error| HttpError::new(StatusCode::BAD_REQUEST, format!("{error:#}")))?;
    // Rules run sandboxed, so running is always allowed; writing snapshots
    // changes repository files, so it needs the same grant as saving a definition.
    if input.update && !state.trust {
        return Err(HttpError::new(
            StatusCode::FORBIDDEN,
            "Updating snapshots writes repository files: start with --trust",
        ));
    }
    let results = blocking_runner(state, move |runner| crate::comparator_tests::run(&runner, &input)).await?;
    Ok(json_response(StatusCode::OK, results))
}

pub(super) async fn save_definition(state: &Arc<ServiceState>, request: Request) -> Result<Response, HttpError> {
    if state.document.is_some() {
        return Err(HttpError::new(
            StatusCode::FORBIDDEN,
            "Offline review never writes repository files",
        ));
    }
    let body = request_body(request).await?;
    let id = body["projectionId"]
        .as_str()
        .ok_or_else(|| HttpError::new(StatusCode::BAD_REQUEST, "projectionId is required"))?
        .to_owned();
    let dry_run = body["dryRun"].as_bool().unwrap_or(false);
    // Previewing is always allowed; writing changes repository code, so it
    // needs the same grant as running it.
    if !dry_run && !state.trust {
        return Err(HttpError::new(
            StatusCode::FORBIDDEN,
            "Saving to a definition writes repository files: it needs --trust (in VS Code, a trusted workspace)",
        ));
    }
    let expected = body["digest"].as_str().map(str::to_owned);
    if !dry_run && expected.is_none() {
        return Err(HttpError::new(
            StatusCode::BAD_REQUEST,
            "digest is required to save: preview with dryRun first",
        ));
    }
    let parts = body["parts"].clone();
    let runner = state.runner();
    let result = tokio::task::spawn_blocking(move || {
        let root = runner.repository_root()?;
        crate::definition_file::save(&root, &id, &parts, expected.as_deref(), dry_run)
    })
    .await
    .map_err(|_| HttpError::new(StatusCode::INTERNAL_SERVER_ERROR, "Saving failed"))?;
    match result {
        Ok(value) => Ok(json_response(StatusCode::OK, value)),
        Err(error) if crate::definition_file::is_conflict(&error) => Err(HttpError::new(StatusCode::CONFLICT, format!("{error:#}"))),
        Err(error) => Err(HttpError::new(StatusCode::BAD_REQUEST, format!("{error:#}"))),
    }
}

/// `GET /api/definitions`: the definitions at a revision with their policies,
/// comparator files and invalid definition files.
pub(super) async fn definitions(state: &Arc<ServiceState>, query: Option<&str>) -> Result<Response, HttpError> {
    let reference = query_reference(query)?;
    // A candidate the Explore view opened, listed beside the repository's own projections.
    let include = query_value(query, "include")?
        .map(|id| projection_parameter(Some(&format!("projection={id}"))))
        .transpose()?;
    let session = state.explore.is_some();
    let (definitions, policies, rules, invalid, commit) = if state.document.is_some() {
        (Vec::new(), Vec::new(), Vec::new(), Vec::new(), None)
    } else {
        let reference = reference.clone();
        blocking_runner(state, move |runner| {
            // Invalid definition files are listed with their diagnostics; the others still load.
            let (definitions, invalid) = if session || runner.trials().is_empty() {
                runner.discover_all(&reference)?
            } else {
                let (mut definitions, invalid) = runner.without_trials().discover_all(&reference)?;
                let trial = include
                    .as_deref()
                    .and_then(|id| runner.trials().iter().find(|trial| trial["id"] == id));
                if let Some(trial) = trial.filter(|trial| !definitions.iter().any(|definition| definition["id"] == trial["id"])) {
                    definitions.push(trial.clone());
                }
                (definitions, invalid)
            };
            let policies = definitions
                .iter()
                .map(|definition| {
                    let mut policy = runner.policy(definition, &reference)?;
                    policy["id"] = definition["id"].clone();
                    // The working tree's custom renderer, from its
                    // development server when one runs.
                    let package = (reference == "working-tree")
                        .then(|| crate::dev_server::package(&runner.repo, definition))
                        .flatten();
                    if let Some((url, _)) = package.as_deref().and_then(crate::dev_server::find) {
                        policy["rendererDevServer"] = json!(url);
                    }
                    // Its renderer package's sample scenarios, which GET /api/scenarios presents.
                    if let Some(file) = package.map(|package| package.join("scenarios.json")).filter(|file| file.is_file()) {
                        policy["scenarios"] = json!(file.strip_prefix(&runner.repo).unwrap_or(&file).to_string_lossy());
                    }
                    Ok(policy)
                })
                .collect::<anyhow::Result<Vec<_>>>()?;
            // Comparator files are only offered for trying; listing them never fails the definitions.
            let rules = runner.rules_files(&reference).unwrap_or_default();
            // The commit a symbolic revision (HEAD, a branch) names now, which custom renderer URLs take.
            let commit = (reference != WORKING_TREE)
                .then(|| runner.resolve(&runner.repository_root()?, &reference))
                .transpose()?;
            Ok((definitions, policies, rules, invalid, commit))
        })
        .await?
    };
    let mut response = json!({
        "definitions": definitions, "policies": policies, "rules": rules, "invalid": invalid, "ref": reference,
        "executionAuthorized": state.document.is_none() && state.trust,
    });
    if let Some(commit) = commit {
        response["commit"] = json!(commit);
    }
    // A working tree without projections of its own shows how to make one.
    if state.document.is_none() && reference == "working-tree" && !crate::workspace::authored(&state.repo) {
        response["setup"] = json!({
            "command": "projections init <id>",
            "prompt": crate::scaffold::agent_prompt(None),
        });
    }
    Ok(json_response(StatusCode::OK, response))
}
