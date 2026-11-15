//! `/api/renderer-builds`: custom renderer builds (see `crate::renderer_builds`).

use std::{sync::Arc, time::Duration};

use axum::{
    extract::Request,
    http::{Method, StatusCode},
    response::Response,
};
use serde_json::Value;
use tokio::time::timeout;

use super::{
    http::{HttpError, json_response, projection_parameter, query_value, request_body},
    state::{ServiceState, WORKING_TREE, blocking_runner},
};

const LONG_POLL: Duration = Duration::from_secs(20);

/// `GET /api/renderer-builds?since=N[&wait]`: every custom renderer build's
/// state and its output after `N` (with `wait`, once there is something new);
/// `POST /api/renderer-builds {projection, event}`: a view `opened`,
/// `saved`, `changed` or `closed` a projection (see `renderer_builds`).
pub(super) async fn renderer_builds(state: &Arc<ServiceState>, request: Request) -> Result<Response, HttpError> {
    let builds = state
        .renderer_builds
        .clone()
        .ok_or_else(|| HttpError::new(StatusCode::NOT_FOUND, "Not found"))?;
    if request.method() == Method::GET {
        let query = request.uri().query();
        let since = query_value(query, "since")?
            .map(|since| {
                since
                    .parse::<u64>()
                    .map_err(|_| HttpError::new(StatusCode::BAD_REQUEST, "since must be a number"))
            })
            .transpose()?
            .unwrap_or(0);
        if query_value(query, "wait")?.is_some() {
            let mut changes = builds.subscribe();
            let _ = timeout(LONG_POLL, changes.wait_for(|sequence| *sequence > since)).await;
        }
        return Ok(json_response(StatusCode::OK, builds.snapshot(since)));
    }
    if request.method() != Method::POST {
        return Err(HttpError::new(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed"));
    }
    let body = request_body(request).await?;
    let projection = projection_parameter(Some(&format!("projection={}", body["projection"].as_str().unwrap_or_default())))?;
    let event = body["event"].as_str().unwrap_or_default().to_owned();
    let id = projection.clone();
    let definition = blocking_runner(state, move |runner| {
        let (definitions, _) = runner.without_trials().discover_all(WORKING_TREE)?;
        Ok(definitions
            .into_iter()
            .find(|definition| definition["id"] == id.as_str())
            .unwrap_or(Value::Null))
    })
    .await?;
    builds
        .event(&projection, &definition, &event)
        .map_err(|message| HttpError::new(StatusCode::BAD_REQUEST, message))?;
    Ok(json_response(StatusCode::OK, builds.snapshot(u64::MAX)))
}
