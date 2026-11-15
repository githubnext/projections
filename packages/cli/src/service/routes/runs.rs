//! A running preparation's or job's routes: its state, and cancelling it.

use std::sync::{Arc, atomic::Ordering};

use axum::{
    http::{Method, StatusCode},
    response::Response,
};

use crate::service::{
    http::{HttpError, json_response},
    state::ServiceState,
};

/// `/api/prepare/{id}` (`GET`) and `/api/prepare/{id}/cancel` (`POST`), with
/// `rest` the path after `/api/prepare/`; `None` for another method.
pub(super) fn preparation(state: &ServiceState, method: &Method, rest: &str) -> Result<Option<Response>, HttpError> {
    let (id, cancel) = match rest.strip_suffix("/cancel") {
        Some(id) => (id, true),
        None => (rest, false),
    };
    let run = state
        .prepares
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|run| run.id == id)
        .cloned()
        .ok_or_else(|| HttpError::new(StatusCode::NOT_FOUND, "Unknown or expired preparation"))?;
    if cancel && method == Method::POST {
        run.cancel.store(true, Ordering::SeqCst);
        return Ok(Some(json_response(StatusCode::OK, run.value())));
    }
    if !cancel && method == Method::GET {
        return Ok(Some(json_response(StatusCode::OK, run.value())));
    }
    Ok(None)
}

/// `/api/jobs/{id}` (`GET`) and `/api/jobs/{id}/cancel` (`POST`), with
/// `rest` the path after `/api/jobs/`; `None` for another method or an ID
/// that isn't one.
pub(super) async fn job(state: &Arc<ServiceState>, method: &Method, rest: &str) -> Result<Option<Response>, HttpError> {
    let (id, cancel) = match rest.strip_suffix("/cancel") {
        Some(id) => (id, true),
        None => (rest, false),
    };
    if id.is_empty() || !id.bytes().all(|byte| b"abcdef0123456789-".contains(&byte)) {
        return Ok(None);
    }
    let job = state
        .jobs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|job| job.id == id)
        .cloned()
        .ok_or_else(|| HttpError::new(StatusCode::NOT_FOUND, "Unknown or expired Inspector job"))?;
    if method == Method::GET && !cancel {
        return Ok(Some(json_response(StatusCode::OK, job.value())));
    }
    if method == Method::POST && cancel {
        job.runner.cancel.store(true, Ordering::SeqCst);
        job.wait().await;
        return Ok(Some(json_response(StatusCode::OK, job.value())));
    }
    Ok(None)
}
