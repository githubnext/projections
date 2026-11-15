//! The `GET` routes that read the repository, the saved document or the
//! service's state.

use std::sync::Arc;

use axum::{http::StatusCode, response::Response};
use serde_json::{Value, json};

use crate::runtime::Runner;
use crate::service::{
    assets,
    http::{HttpError, json_response, projection_parameter, query_reference, query_value},
    repository::{self, scenarios},
    state::{ServiceState, blocking_runner},
    sweeps::{SweepRun, sweep_thumbnail},
    watchers::workspace_changes,
};

/// Answers a `GET` of `path`, or `None` for a route it doesn't read.
pub(super) async fn route(state: &Arc<ServiceState>, path: &str, query: Option<&str>) -> Result<Option<Response>, HttpError> {
    let response = match path {
        "/api/changes" => changes(state, query).await?,
        "/api/document" => json_response(StatusCode::OK, json!({"document": state.document})),
        "/api/definitions" => repository::definitions(state, query).await?,
        "/api/environment" => {
            if state.document.is_some() {
                return Err(HttpError::new(StatusCode::FORBIDDEN, "A saved document has no environment"));
            }
            report(state, |runner| runner.environment_report()).await?
        }
        "/api/identity" => {
            if state.document.is_some() {
                return Err(HttpError::new(StatusCode::FORBIDDEN, "A saved document has no working tree"));
            }
            let id = query_value(query, "projection")?.ok_or_else(|| HttpError::new(StatusCode::BAD_REQUEST, "projection is required"))?;
            report(state, move |runner| runner.working_identity(&id)).await?
        }
        "/api/revisions" => revisions(state, query).await?,
        "/api/explore" => explore(state).await?,
        "/api/sweep" => {
            let sweep = state.sweep.lock().unwrap_or_else(|error| error.into_inner());
            json_response(StatusCode::OK, json!({"sweep": sweep.as_ref().map(SweepRun::value)}))
        }
        "/api/sweep/thumbnail" => sweep_thumbnail(state, query).await?,
        "/api/pairs" => {
            if state.document.is_some() {
                return Err(HttpError::new(StatusCode::FORBIDDEN, "Offline review has no repository history"));
            }
            let projection = query_value(query, "projection")?;
            let pairs = blocking_runner(state, move |runner| crate::history::pairs(&runner, projection.as_deref())).await?;
            json_response(StatusCode::OK, pairs)
        }
        "/api/scenarios" => {
            if state.document.is_some() {
                return Err(HttpError::new(
                    StatusCode::FORBIDDEN,
                    "Offline review has no repository, so no renderer scenarios",
                ));
            }
            let id = projection_parameter(query)?;
            let scenarios = blocking_runner(state, move |runner| scenarios::read(&runner, &id)).await?;
            json_response(StatusCode::OK, scenarios)
        }
        "/api/comparator" => comparator(state, query).await?,
        "/api/comparator-tests" => {
            if state.document.is_some() {
                return Err(HttpError::new(
                    StatusCode::FORBIDDEN,
                    "Offline review has no repository, so no comparator tests",
                ));
            }
            let files = blocking_runner(state, |runner| crate::comparator_tests::list(&runner)).await?;
            json_response(StatusCode::OK, files)
        }
        "/api/renderers" => assets::renderers(state).await?,
        _ => return Ok(None),
    };
    Ok(Some(response))
}

/// `/api/changes`: waits for the working tree to change after generation `since`.
async fn changes(state: &ServiceState, query: Option<&str>) -> Result<Response, HttpError> {
    let workspace = state
        .workspace
        .as_ref()
        .ok_or_else(|| HttpError::new(StatusCode::NOT_FOUND, "Not found"))?;
    let since = query_value(query, "since")?
        .and_then(|since| since.parse::<u64>().ok())
        .ok_or_else(|| HttpError::new(StatusCode::BAD_REQUEST, "since must be a working-tree generation"))?;
    Ok(json_response(StatusCode::OK, workspace_changes(state, workspace, since).await))
}

/// Runs `action` with the service's runner on a blocking thread and answers
/// its report.
async fn report(
    state: &ServiceState,
    action: impl FnOnce(Runner) -> anyhow::Result<Value> + Send + 'static,
) -> Result<Response, HttpError> {
    let runner = state.runner();
    let report = tokio::task::spawn_blocking(move || action(runner))
        .await
        .map_err(|error| HttpError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
        .map_err(|error| HttpError::new(StatusCode::BAD_REQUEST, format!("{error:#}")))?;
    Ok(json_response(StatusCode::OK, report))
}

/// `/api/revisions`: the latest `limit` (1-100, default 20) revisions.
async fn revisions(state: &ServiceState, query: Option<&str>) -> Result<Response, HttpError> {
    let limit = match query_value(query, "limit")? {
        Some(value) => value
            .parse::<usize>()
            .ok()
            .filter(|limit| (1..=100).contains(limit))
            .ok_or_else(|| HttpError::new(StatusCode::BAD_REQUEST, "limit must be 1-100"))?,
        None => 20,
    };
    let revisions = if state.document.is_some() {
        json!([])
    } else {
        blocking_runner(state, move |runner| runner.revisions(limit)).await?
    };
    Ok(json_response(StatusCode::OK, json!({"revisions": revisions})))
}

/// `/api/explore`: what explore proposes now, so adopting one shows at once.
async fn explore(state: &ServiceState) -> Result<Response, HttpError> {
    let candidates = if state.document.is_some() {
        Vec::new()
    } else {
        blocking_runner(state, move |runner| {
            let root = runner.repository_root()?;
            crate::explore::candidates(&runner, &root)
        })
        .await?
    };
    Ok(json_response(
        StatusCode::OK,
        json!({"session": state.explore.is_some(), "candidates": candidates}),
    ))
}

/// `/api/comparator`: a projection's comparator, or a comparator file by
/// path (`rules`) to try it as another projection's comparator.
async fn comparator(state: &ServiceState, query: Option<&str>) -> Result<Response, HttpError> {
    if state.document.is_some() {
        return Err(HttpError::new(
            StatusCode::FORBIDDEN,
            "Offline review has no repository; its comparison names its comparator",
        ));
    }
    let reference = query_reference(query)?;
    if let Some(path) = query_value(query, "rules")? {
        if path.is_empty() || path.len() > 1024 {
            return Err(HttpError::new(StatusCode::BAD_REQUEST, "A valid rules query parameter is required"));
        }
        let comparator = blocking_runner(state, move |runner| runner.rules_comparator(&path, &reference)).await?;
        return Ok(json_response(StatusCode::OK, comparator));
    }
    let id = projection_parameter(query)?;
    let comparator = blocking_runner(state, move |runner| runner.comparator(&id, &reference)).await?;
    Ok(json_response(StatusCode::OK, comparator))
}
