//! The `/api/` route table.

mod fixtures;
mod reads;
mod runs;

use std::{
    sync::{Arc, atomic::Ordering},
    time::Duration,
};

use anyhow::Result;
use axum::{
    extract::{Request, State},
    http::{Method, StatusCode},
    response::{IntoResponse, Response},
};
use tokio::time::timeout;

use super::{
    assets, builds,
    http::{HttpError, json_response, request_body},
    jobs, prepare, repository,
    state::ServiceState,
    sweeps::start_sweep,
};

pub(super) async fn route(State(state): State<Arc<ServiceState>>, request: Request) -> Response {
    match timeout(Duration::from_secs(30), dispatch(&state, request)).await {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => error.into_response(),
        Err(_) => HttpError::new(StatusCode::REQUEST_TIMEOUT, "Inspector request timed out").into_response(),
    }
}

async fn dispatch(state: &Arc<ServiceState>, request: Request) -> Result<Response, HttpError> {
    if state.closing.load(Ordering::SeqCst) {
        return Err(HttpError::new(StatusCode::SERVICE_UNAVAILABLE, "Inspector is closing"));
    }
    let path = request.uri().path().to_owned();
    if !path.starts_with("/api/") {
        if request.method() != Method::GET {
            return Err(HttpError::new(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed"));
        }
        return assets::serve(state, &path).await;
    }
    if let Some(fixtures) = &state.fixtures
        && let Some(response) = fixtures::route(state, fixtures, request.method(), &path, request.uri().query()).await?
    {
        return Ok(response);
    }
    if path == "/api/renderer-builds" {
        return builds::renderer_builds(state, request).await;
    }
    if request.method() == Method::GET
        && let Some(response) = reads::route(state, &path, request.uri().query()).await?
    {
        return Ok(response);
    }
    if request.method() == Method::POST {
        match path.as_str() {
            "/api/definition" => return repository::save_definition(state, request).await,
            "/api/comparator-tests/run" => {
                return repository::run_comparator_tests(state, request).await;
            }
            "/api/adopt" => return onboard(state, request).await,
            "/api/sweep" => return sweep(state, request).await,
            "/api/prepare" => return prepare::start(state, request).await,
            "/api/jobs" => return jobs::start(state, request).await,
            _ => {}
        }
    }
    if let Some(rest) = path.strip_prefix("/api/prepare/")
        && let Some(response) = runs::preparation(state, request.method(), rest)?
    {
        return Ok(response);
    }
    if let Some(rest) = path.strip_prefix("/api/jobs/")
        && let Some(response) = runs::job(state, request.method(), rest).await?
    {
        return Ok(response);
    }
    Err(HttpError::new(StatusCode::NOT_FOUND, "Unknown Inspector API route"))
}

/// `POST /api/adopt`: writes the repository's first projections.
async fn onboard(state: &Arc<ServiceState>, request: Request) -> Result<Response, HttpError> {
    if state.document.is_some() {
        return Err(HttpError::new(
            StatusCode::FORBIDDEN,
            "Offline review never writes repository files",
        ));
    }
    let body = request_body(request).await?;
    repository::onboarding::write(state, &body)
        .await
        .map(|value| json_response(StatusCode::OK, value))
}

/// `POST /api/sweep`: starts a sweep over recent changes.
async fn sweep(state: &Arc<ServiceState>, request: Request) -> Result<Response, HttpError> {
    if state.document.is_some() {
        return Err(HttpError::new(StatusCode::FORBIDDEN, "Offline review never executes extractors"));
    }
    let body = request_body(request).await?;
    start_sweep(state, &body).map(|value| json_response(StatusCode::ACCEPTED, value))
}
