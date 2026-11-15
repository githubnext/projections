//! Preparing the environment on request (`POST /api/prepare`).

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use anyhow::Result;
use axum::{extract::Request, http::StatusCode, response::Response};
use serde_json::{Value, json};
use uuid::Uuid;

use super::{
    http::{HttpError, json_response, request_body},
    state::ServiceState,
};

/// An environment preparation the Inspector started: its progress events and
/// outcome, and the cancellation flag its runner watches.
pub(super) struct PrepareRun {
    pub(super) id: String,
    pub(super) cancel: Arc<AtomicBool>,
    pub(super) state: Mutex<Value>,
}

impl PrepareRun {
    pub(super) fn value(&self) -> Value {
        let mut value = self.state.lock().unwrap_or_else(|e| e.into_inner()).clone();
        value["id"] = json!(self.id);
        // The latest step's log, as it is now: its last 64 KiB.
        if let Some(log) = value["events"]
            .as_array()
            .and_then(|events| events.iter().rev().find_map(|event| event["log"].as_str()))
            && let Ok(bytes) = std::fs::read(log)
        {
            let tail = &bytes[bytes.len().saturating_sub(64 * 1024)..];
            value["log"] = json!(String::from_utf8_lossy(tail));
        }
        value
    }
}

pub(super) async fn start(state: &Arc<ServiceState>, request: Request) -> Result<Response, HttpError> {
    if state.document.is_some() {
        return Err(HttpError::new(StatusCode::FORBIDDEN, "Offline review never runs repository code"));
    }
    if !state.trust {
        return Err(HttpError::new(
            StatusCode::FORBIDDEN,
            "Preparing runs the repository's prepare steps, which are repository code: trust the workspace (serve --stdio --trust)",
        ));
    }
    let body = request_body(request).await?;
    let object = body
        .as_object()
        .ok_or_else(|| HttpError::new(StatusCode::BAD_REQUEST, "The body must be an object"))?;
    if let Some(key) = object.keys().find(|key| !["revision", "steps", "force"].contains(&key.as_str())) {
        return Err(HttpError::new(StatusCode::BAD_REQUEST, format!("Unknown field {key}")));
    }
    let revision = match body.get("revision") {
        None | Some(Value::Null) => None,
        Some(Value::String(revision)) if !revision.is_empty() && revision.len() <= 1024 => Some(revision.clone()),
        _ => {
            return Err(HttpError::new(StatusCode::BAD_REQUEST, "revision must be a revision"));
        }
    };
    let steps: Vec<String> = match body.get("steps") {
        None => Vec::new(),
        Some(Value::Array(steps)) if steps.len() <= 20 => steps
            .iter()
            .map(|step| step.as_str().map(str::to_owned))
            .collect::<Option<_>>()
            .ok_or_else(|| HttpError::new(StatusCode::BAD_REQUEST, "steps must be step IDs"))?,
        _ => {
            return Err(HttpError::new(StatusCode::BAD_REQUEST, "steps must be step IDs"));
        }
    };
    let force = match body.get("force") {
        None => false,
        Some(Value::Bool(force)) => *force,
        _ => {
            return Err(HttpError::new(StatusCode::BAD_REQUEST, "force must be a boolean"));
        }
    };
    let run = {
        let mut prepares = state.prepares.lock().unwrap_or_else(|e| e.into_inner());
        let running = |run: &Arc<PrepareRun>| run.state.lock().unwrap_or_else(|e| e.into_inner())["status"] == "running";
        if prepares.iter().any(running) {
            return Err(HttpError::new(
                StatusCode::CONFLICT,
                "An environment is already being prepared; wait for it or cancel it",
            ));
        }
        while prepares.len() >= 4 {
            prepares.pop_front();
        }
        let run = Arc::new(PrepareRun {
            id: Uuid::new_v4().to_string(),
            cancel: Arc::new(AtomicBool::new(false)),
            state: Mutex::new(json!({"status": "running", "revision": revision, "events": []})),
        });
        prepares.push_back(run.clone());
        run
    };
    let mut runner = state.runner();
    runner.cancel = run.cancel.clone();
    let listening = run.clone();
    let runner = runner.with_listener(Arc::new(move |event: &Value| {
        let mut state = listening.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(events) = state["events"].as_array_mut()
            && events.len() < 200
        {
            events.push(event.clone());
        }
    }));
    let finished = run.clone();
    tokio::task::spawn_blocking(move || {
        let outcome = runner.prepare_environment(revision.as_deref(), &crate::environment::Options { force, steps });
        let cancelled = finished.cancel.load(Ordering::SeqCst);
        let mut state = finished.state.lock().unwrap_or_else(|e| e.into_inner());
        match outcome {
            Ok(report) => {
                state["status"] = json!("succeeded");
                state["report"] = report;
            }
            Err(error) => {
                state["status"] = json!(if cancelled { "cancelled" } else { "failed" });
                state["error"] = json!(format!("{error:#}"));
            }
        }
    });
    Ok(json_response(StatusCode::ACCEPTED, run.value()))
}
