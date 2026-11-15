//! `POST /api/adopt`: adopting explore candidates.

use std::sync::Arc;

use anyhow::Result;
use axum::http::StatusCode;
use serde_json::Value;

use crate::{
    runtime::Runner,
    service::{http::HttpError, state::ServiceState},
};

/// `POST /api/adopt`: previews, and writes in an explore session or a runner
/// started with `--trust`.
pub(in crate::service) async fn write(state: &Arc<ServiceState>, body: &Value) -> Result<Value, HttpError> {
    let dry_run = body["dryRun"].as_bool().unwrap_or(false);
    if !dry_run && state.explore.is_none() && !state.trust {
        return Err(HttpError::new(
            StatusCode::FORBIDDEN,
            "Writing repository files needs an explore session (a repository with no projections yet) or --trust (in VS Code, a trusted workspace)",
        ));
    }
    let expected = body["digest"].as_str().map(str::to_owned);
    if !dry_run && expected.is_none() {
        return Err(invalid("digest is required to write: preview with dryRun first"));
    }
    let runner = state.runner();
    let task = adopt(state, runner, body, expected, dry_run)?;
    let result = task
        .await
        .map_err(|_| HttpError::new(StatusCode::INTERNAL_SERVER_ERROR, "Writing failed"))?;
    result.map_err(|error| {
        let status = if crate::onboard::is_conflict(&error) {
            StatusCode::CONFLICT
        } else {
            StatusCode::BAD_REQUEST
        };
        HttpError::new(status, format!("{error:#}"))
    })
}

fn invalid(message: &str) -> HttpError {
    HttpError::new(StatusCode::BAD_REQUEST, message)
}

/// Adopting the candidates `body` names, bookmarking the latest sweep's
/// most-changed cells.
fn adopt(
    state: &Arc<ServiceState>,
    runner: Runner,
    body: &Value,
    expected: Option<String>,
    dry_run: bool,
) -> Result<tokio::task::JoinHandle<Result<Value>>, HttpError> {
    let ids: Vec<String> = body["projections"]
        .as_array()
        .filter(|ids| !ids.is_empty() && ids.len() <= 50)
        .and_then(|ids| ids.iter().map(|id| id.as_str().map(str::to_owned)).collect())
        .ok_or_else(|| invalid("projections must name 1-50 candidates"))?;
    let count = match &body["bookmarks"] {
        Value::Null => 3,
        value => value
            .as_u64()
            .filter(|count| *count <= 20)
            .ok_or_else(|| invalid("bookmarks must be 0-20"))? as usize,
    };
    // Bookmarks come from the latest sweep's most-changed cells.
    let highlights: Vec<crate::onboard::bookmarks::Highlight> = {
        let sweep = state.sweep.lock().unwrap_or_else(|error| error.into_inner());
        match sweep.as_ref() {
            Some(sweep) if count > 0 => ids
                .iter()
                .flat_map(|id| crate::onboard::bookmarks::highlights(id, &sweep.swept, &sweep.cells, count))
                .collect(),
            _ => Vec::new(),
        }
    };
    Ok(tokio::task::spawn_blocking(move || {
        let root = runner.repository_root()?;
        let candidates = crate::explore::candidates(&runner, &root)?;
        crate::onboard::adopt(&root, &candidates, &ids, &highlights, expected.as_deref(), dry_run)
    }))
}
