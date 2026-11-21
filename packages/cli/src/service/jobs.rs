//! Extraction and comparison jobs: queued, run one at a time, and cancelled.

use std::sync::{Arc, Mutex, atomic::Ordering};

use anyhow::Result;
use axum::{extract::Request, http::StatusCode, response::Response};
use serde_json::{Value, json};
use tokio::sync::Notify;
use uuid::Uuid;

use super::{
    http::{HttpError, diagnostic, error_diagnostics, json_response, request_body, utf16_len},
    state::{ServiceState, WORKING_TREE},
};
use crate::runtime::{DefinitionSource, Runner};

/// The most jobs running or waiting at once.
pub(super) const MAX_QUEUED_JOBS: usize = 16;
pub(super) struct Job {
    pub(super) id: String,
    pub(super) runner: Runner,
    pub(super) state: Mutex<JobState>,
    pub(super) finished: Notify,
}

/// What a job collected: its document (`extraction` or `comparison`) and its notices.
pub(super) struct Collected {
    pub(super) kind: &'static str,
    pub(super) document: Value,
    pub(super) notices: Vec<String>,
}

/// Where a job is. Waiting for its turn and running are both `running` on the wire: clients poll while it is.
pub(super) enum JobState {
    Queued,
    Running,
    Completed(Collected),
    Failed {
        diagnostics: Vec<Value>,
    },
    /// Cancelled before it ran, or while it ran, with what it collected regardless.
    Cancelled(Option<Collected>),
}

impl JobState {
    pub(super) fn name(&self) -> &'static str {
        match self {
            Self::Queued | Self::Running => "running",
            Self::Completed(_) => "completed",
            Self::Failed { .. } => "failed",
            Self::Cancelled(_) => "cancelled",
        }
    }

    pub(super) fn finished(&self) -> bool {
        !matches!(self, Self::Queued | Self::Running)
    }
}

impl Job {
    pub(super) fn value(&self) -> Value {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let (diagnostics, collected): (&[Value], Option<&Collected>) = match &*state {
            JobState::Queued | JobState::Running | JobState::Cancelled(None) => (&[], None),
            JobState::Completed(collected) | JobState::Cancelled(Some(collected)) => (&[], Some(collected)),
            JobState::Failed { diagnostics } => (diagnostics, None),
        };
        let notices: &[String] = collected.map_or(&[], |collected| &collected.notices);
        let mut value = json!({
            "id": self.id,
            "status": state.name(),
            "outputs": *self.runner.outputs.lock().unwrap_or_else(|e| e.into_inner()),
            "diagnostics": diagnostics,
            "notices": notices,
        });
        if let Some(collected) = collected {
            value[collected.kind] = collected.document.clone();
        }
        value
    }

    pub(super) fn running(&self) -> bool {
        !self.state.lock().unwrap_or_else(|e| e.into_inner()).finished()
    }

    fn set(&self, state: JobState) {
        *self.state.lock().unwrap_or_else(|e| e.into_inner()) = state;
    }

    pub(super) async fn wait(&self) {
        loop {
            let notified = self.finished.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if !self.running() {
                return;
            }
            notified.await;
        }
    }
}

pub(super) struct RunRequest {
    pub(super) id: String,
    pub(super) before: String,
    pub(super) after: Option<String>,
    pub(super) definition: DefinitionSource,
    pub(super) definition_revision: Option<String>,
}

pub(super) fn run_request(value: Value) -> Result<RunRequest, HttpError> {
    let invalid = || {
        HttpError::new(
            StatusCode::BAD_REQUEST,
            "Run request requires projectionId, before, and optional after, definition (base|head, comparisons) or definitionRevision (the revision whose definition applies to every side); trust cannot be supplied by HTTP",
        )
    };
    let fields = value.as_object().ok_or_else(invalid)?;
    if fields
        .keys()
        .any(|key| !["projectionId", "before", "after", "definition", "definitionRevision"].contains(&key.as_str()))
    {
        return Err(invalid());
    }
    let id = fields.get("projectionId").and_then(Value::as_str).ok_or_else(invalid)?;
    if id.is_empty()
        || id.len() > 100
        || !id.as_bytes()[0].is_ascii_alphanumeric()
        || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
    {
        return Err(invalid());
    }
    let revision = |value: Option<&Value>| -> Result<String, HttpError> {
        let text = value.and_then(Value::as_str).ok_or_else(invalid)?;
        if text.is_empty() || utf16_len(text) > 1024 {
            return Err(invalid());
        }
        Ok(text.to_owned())
    };
    let after = fields.get("after").map(|value| revision(Some(value))).transpose()?;
    let definition = match fields.get("definition") {
        None => DefinitionSource::Base,
        Some(value) if after.is_some() && value == "base" => DefinitionSource::Base,
        Some(value) if after.is_some() && value == "head" => DefinitionSource::Head,
        Some(_) => return Err(invalid()),
    };
    let definition_revision = match fields.get("definitionRevision") {
        Some(_) if fields.contains_key("definition") => return Err(invalid()),
        value => value.map(|value| revision(Some(value))).transpose()?,
    };
    Ok(RunRequest {
        id: id.to_owned(),
        before: revision(fields.get("before"))?,
        after,
        definition,
        definition_revision,
    })
}

pub(super) async fn start(state: &Arc<ServiceState>, request: Request) -> Result<Response, HttpError> {
    if state.document.is_some() {
        return Err(HttpError::new(StatusCode::FORBIDDEN, "Offline review never executes extractors"));
    }
    let input = run_request(request_body(request).await?)?;
    let job = {
        let mut jobs = state.jobs.lock().unwrap_or_else(|e| e.into_inner());
        if state.closing.load(Ordering::SeqCst) {
            return Err(HttpError::new(StatusCode::SERVICE_UNAVAILABLE, "Inspector is closing"));
        }
        // Jobs queue and run one at a time; a client that piles up more
        // than this many is refused.
        if jobs.iter().filter(|job| job.running()).count() >= MAX_QUEUED_JOBS {
            return Err(HttpError::new(
                StatusCode::CONFLICT,
                "Too many Inspector collections are waiting; cancel some first",
            ));
        }
        // Four finished results are kept; running and queued jobs always are.
        while jobs.iter().filter(|job| !job.running()).count() >= 4 {
            let Some(index) = jobs.iter().position(|job| !job.running()) else {
                break;
            };
            jobs.remove(index);
        }
        let job = Arc::new(Job {
            id: Uuid::new_v4().to_string(),
            runner: state.runner(),
            state: Mutex::new(JobState::Queued),
            finished: Notify::new(),
        });
        jobs.push_back(job.clone());
        job
    };
    let created = job.value();
    let root = state.repo.clone();
    let queue = state.clone();
    tokio::spawn(async move {
        let _turn = queue.collecting.lock().await;
        // Cancelled (or the service closed) while it waited: it never runs.
        if job.runner.cancel.load(Ordering::SeqCst) {
            job.set(JobState::Cancelled(None));
            job.finished.notify_waiters();
            return;
        }
        job.set(JobState::Running);
        let runner = job.runner.clone();
        let kind = if input.after.is_some() { "comparison" } else { "extraction" };
        let collected = tokio::task::spawn_blocking(move || {
            let run = || match (&input.after, &input.definition_revision) {
                (Some(after), Some(definition)) => runner
                    .compare_using(&input.id, &input.before, after, definition)
                    .map(|compared| (compared.document, compared.notices)),
                (Some(after), None) => runner
                    .compare_with(&input.id, &input.before, after, input.definition)
                    .map(|compared| (compared.document, compared.notices)),
                (None, _) => runner
                    .show(&input.id, &input.before, input.definition_revision.as_deref())
                    .map(|document| (document, Vec::new())),
            };
            let live = [
                Some(input.before.as_str()),
                input.after.as_deref(),
                input.definition_revision.as_deref(),
            ]
            .contains(&Some(WORKING_TREE));
            if !live {
                return run();
            }
            // A working-tree run reads the projection's program once it has
            // settled. Failing while it was being written (a half-written
            // definition that doesn't parse), it is transient: read again once
            // the files are quiet.
            let read = crate::workspace::settled_inputs(&root, &input.id);
            match run() {
                Err(error) if !runner.cancel.load(Ordering::SeqCst) => {
                    if crate::workspace::settled_inputs(&root, &input.id) == read {
                        return Err(error);
                    }
                    run().map(|(document, mut notices)| {
                        notices.push(format!(
                            "The projection's files changed while they were read ({error:#}); extracted again once they settled."
                        ));
                        (document, notices)
                    })
                }
                result => result,
            }
        })
        .await;
        let cancelled = job.runner.cancel.load(Ordering::SeqCst);
        job.set(match collected {
            Ok(Ok((document, notices))) => {
                let collected = Collected { kind, document, notices };
                if cancelled {
                    JobState::Cancelled(Some(collected))
                } else {
                    JobState::Completed(collected)
                }
            }
            _ if cancelled => JobState::Cancelled(None),
            Ok(Err(error)) => JobState::Failed {
                diagnostics: error_diagnostics(&error),
            },
            Err(error) => JobState::Failed {
                diagnostics: vec![diagnostic(error.to_string())],
            },
        });
        job.finished.notify_waiters();
    });
    Ok(json_response(StatusCode::ACCEPTED, created))
}
