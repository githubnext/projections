//! Fixtures mode's routes: scenarios stand in for a repository, so its
//! repository routes are refused and its fixtures are served.

use std::sync::Arc;

use axum::{
    http::{Method, StatusCode},
    response::Response,
};
use serde_json::json;

use crate::service::{
    http::{HttpError, json_response, query_value},
    state::{FixturesState, ServiceState},
    watchers::{fixtures_changes, fixtures_response},
};

/// The routes a repository answers, which fixtures mode refuses.
const REPOSITORY_ROUTES: [&str; 16] = [
    "/api/definitions",
    "/api/revisions",
    "/api/comparator",
    "/api/comparator-tests",
    "/api/comparator-tests/run",
    "/api/jobs",
    "/api/scenarios",
    "/api/pairs",
    "/api/explore",
    "/api/definition",
    "/api/sweep",
    "/api/sweep/thumbnail",
    "/api/adopt",
    "/api/identity",
    "/api/environment",
    "/api/prepare",
];

/// Answers `path` in fixtures mode, or `None` for a route it shares with
/// repository mode.
pub(super) async fn route(
    state: &Arc<ServiceState>,
    fixtures: &FixturesState,
    method: &Method,
    path: &str,
    query: Option<&str>,
) -> Result<Option<Response>, HttpError> {
    if REPOSITORY_ROUTES.contains(&path) || path.starts_with("/api/jobs/") || path.starts_with("/api/prepare/") {
        return Err(HttpError::new(
            StatusCode::FORBIDDEN,
            "Fixtures mode has no repository: scenarios supply their extractions and comparators",
        ));
    }
    if method != Method::GET {
        return Ok(None);
    }
    if path == "/api/fixtures" {
        let snapshot = fixtures.current.borrow().clone();
        return Ok(Some(json_response(StatusCode::OK, fixtures_response(&snapshot))));
    }
    if path == "/api/fixtures/changes" {
        let since = query_value(query, "since")?
            .and_then(|since| since.parse::<u64>().ok())
            .ok_or_else(|| HttpError::new(StatusCode::BAD_REQUEST, "since must be a fixtures generation"))?;
        let generation = fixtures_changes(state, fixtures, since).await;
        return Ok(Some(json_response(StatusCode::OK, json!({"generation": generation}))));
    }
    Ok(None)
}
