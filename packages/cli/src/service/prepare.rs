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

/// Where an environment preparation is.
pub(super) enum PrepareStatus {
    Running,
    Succeeded(Value),
    Failed(String),
    Cancelled(String),
}

/// A preparation's status and its progress events (200 at most).
pub(super) struct Progress {
    pub(super) status: PrepareStatus,
    pub(super) events: Vec<Value>,
}

/// An environment preparation the Inspector started: its progress events and
/// outcome, and the cancellation flag its runner watches.
pub(super) struct PrepareRun {
    pub(super) id: String,
    pub(super) cancel: Arc<AtomicBool>,
    pub(super) revision: Option<String>,
    pub(super) progress: Mutex<Progress>,
}

impl PrepareRun {
    pub(super) fn running(&self) -> bool {
        matches!(
            self.progress.lock().unwrap_or_else(|e| e.into_inner()).status,
            PrepareStatus::Running
        )
    }

    pub(super) fn value(&self) -> Value {
        let progress = self.progress.lock().unwrap_or_else(|e| e.into_inner());
        let mut value = json!({"id": self.id, "revision": self.revision, "events": progress.events});
        match &progress.status {
            PrepareStatus::Running => value["status"] = json!("running"),
            PrepareStatus::Succeeded(report) => {
                value["status"] = json!("succeeded");
                value["report"] = report.clone();
            }
            PrepareStatus::Failed(error) => {
                value["status"] = json!("failed");
                value["error"] = json!(error);
            }
            PrepareStatus::Cancelled(error) => {
                value["status"] = json!("cancelled");
                value["error"] = json!(error);
            }
        }
        drop(progress);
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
        if prepares.iter().any(|run| run.running()) {
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
            revision: revision.clone(),
            progress: Mutex::new(Progress {
                status: PrepareStatus::Running,
                events: Vec::new(),
            }),
        });
        prepares.push_back(run.clone());
        run
    };
    let mut runner = state.runner();
    runner.cancel = run.cancel.clone();
    let listening = run.clone();
    let runner = runner.with_listener(Arc::new(move |event: &Value| {
        let mut progress = listening.progress.lock().unwrap_or_else(|e| e.into_inner());
        if progress.events.len() < 200 {
            progress.events.push(event.clone());
        }
    }));
    let finished = run.clone();
    tokio::task::spawn_blocking(move || {
        let outcome = runner.prepare_environment(revision.as_deref(), &crate::environment::Options { force, steps });
        let cancelled = finished.cancel.load(Ordering::SeqCst);
        finished.progress.lock().unwrap_or_else(|e| e.into_inner()).status = match outcome {
            Ok(report) => PrepareStatus::Succeeded(report),
            Err(error) if cancelled => PrepareStatus::Cancelled(format!("{error:#}")),
            Err(error) => PrepareStatus::Failed(format!("{error:#}")),
        };
    });
    Ok(json_response(StatusCode::ACCEPTED, run.value()))
}
