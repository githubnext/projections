//! The Inspector service: the in-memory router behind `serve --stdio` (the
//! editor extension), `mcp` and headless pages. It binds nothing; callers send it
//! requests for its `/api/` routes and assets.

mod assets;
mod builds;
mod http;
mod jobs;
mod prepare;
mod repository;
mod routes;
mod state;
mod sweeps;
mod watchers;

pub use assets::{INSPECTOR_CSP, RENDERER_CSP};

use std::{
    path::{Path, PathBuf},
    sync::{Arc, Weak, atomic::Ordering},
};

use anyhow::{Context as _, Result};
use axum::{
    Router,
    body::Body,
    extract::Request,
    http::{Method, header},
    response::Response,
};
use serde_json::Value;
use tokio::sync::watch;

use crate::runtime::Runner;

use assets::files::{content_type, static_bytes};
use state::{ServiceState, WorkspaceChanges, build, shutdown};
use watchers::changes_since;

pub struct InspectorOptions {
    pub repo: PathBuf,
    pub trust: bool,
    pub document: Option<Value>,
    /// With a document, also serve its definition's custom renderer bundle from
    /// `repo`, under the same trust policy as live inspection (`--png` on `projections show` and `compare`).
    pub custom_renderers: bool,
    pub assets: PathBuf,
    /// Fixtures mode: scenario documents and renderer bundles instead of a repository.
    pub fixtures: Option<FixturesOptions>,
    /// The Projections executable that runs built-in extractors; default the current one.
    pub executable: Option<PathBuf>,
    /// An explore session (a repository with no projections yet): the
    /// explore candidates, whose trial definitions every revision defines
    /// until adopted.
    pub explore: Option<Vec<Value>>,
    /// Explore candidates outside an explore session: their trial definitions
    /// are available to jobs, sweeps and the Explore view, but
    /// `GET /api/definitions` lists one only when asked to (`include`), so the
    /// Inspector presents the repository's own projections.
    pub candidates: Vec<Value>,
    /// Where extractions come from: the cache, CI artifacts, `--in-place`.
    pub execution: crate::runtime::ExecutionPolicy,
}

pub struct FixturesOptions {
    /// Scenario documents, or directories holding `scenarios.json`.
    pub sources: Vec<PathBuf>,
    /// Renderer bundle directories, or package directories naming one.
    pub renderers: Vec<PathBuf>,
    /// Serve bundles the scenarios name besides `renderers` (repository code).
    pub trust: bool,
}

/// The Inspector's API without a listener: its router, called in memory. The
/// stdio backend (`projections serve --stdio`) and headless pages (`headless`)
/// answer through it.
pub struct Service {
    router: Router,
    state: Arc<ServiceState>,
}

impl Service {
    pub async fn new(options: InspectorOptions) -> Result<Self> {
        let (router, state) = build(options).await?;
        Ok(Self { router, state })
    }

    /// The repository it serves.
    pub fn repository(&self) -> &Path {
        &self.state.repo
    }

    /// Whether it may run repository code (`--trust`).
    pub fn trusted(&self) -> bool {
        self.state.trust
    }

    /// Whether it is an explore session.
    pub fn explore(&self) -> bool {
        self.state.explore.is_some()
    }

    /// What it presents: `repository`, a saved `document`, or renderer `fixtures`.
    pub fn mode(&self) -> &'static str {
        if self.state.fixtures.is_some() {
            "fixtures"
        } else if self.state.document.is_some() {
            "document"
        } else {
            "repository"
        }
    }

    /// Answers one request for a server-relative `path` (with its query) as
    /// HTTP would; a JSON `body` is sent as `application/json`.
    pub async fn call(&self, method: Method, path: &str, body: Option<Vec<u8>>) -> Result<Response> {
        let mut request = Request::builder().method(method).uri(path);
        if body.is_some() {
            request = request.header(header::CONTENT_TYPE, "application/json");
        }
        let request = request
            .body(body.map(Body::from).unwrap_or_else(Body::empty))
            .context("Invalid request")?;
        Ok(self.handle(request).await)
    }

    /// Answers a request as it is, headers included.
    pub async fn handle(&self, request: Request) -> Response {
        use tower::ServiceExt as _;
        match self.router.clone().oneshot(request).await {
            Ok(response) => response,
            Err(infallible) => match infallible {},
        }
    }

    /// A runner for its repository with its grants (and explore candidates),
    /// for headless work beside its routes, such as the agent tools' checks.
    pub fn runner(&self) -> Runner {
        self.state.runner()
    }

    /// Cancels a job, as `POST /api/jobs/:id/cancel` does, without waiting for it.
    pub fn cancel_job(&self, id: &str) {
        let jobs = self.state.jobs.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(job) = jobs.iter().find(|job| job.id == id) {
            job.runner.cancel.store(true, Ordering::SeqCst);
        }
    }

    /// Cancels the latest sweep if it is `id` and still running.
    pub fn cancel_sweep(&self, id: &str) {
        let sweep = self.state.sweep.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(sweep) = sweep.as_ref().filter(|sweep| sweep.id == id) {
            sweep.cancel.store(true, Ordering::SeqCst);
        }
    }

    /// Cancels an environment preparation, as `POST /api/prepare/:id/cancel` does.
    pub fn cancel_prepare(&self, id: &str) {
        let prepares = self.state.prepares.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(run) = prepares.iter().find(|run| run.id == id) {
            run.cancel.store(true, Ordering::SeqCst);
        }
    }

    /// A file of the Inspector's assets (`mount.js`, `engine/engine.wasm`), with its content type.
    pub fn asset(&self, path: &str) -> Option<(Vec<u8>, &'static str)> {
        if !crate::headless::asset_path(path) {
            return None;
        }
        let bytes = static_bytes(&self.state.assets, path).ok()?;
        Some((bytes, content_type(path)))
    }

    /// Custom renderer builds, in repository mode.
    pub fn renderer_builds(&self) -> Option<Arc<crate::renderer_builds::RendererBuilds>> {
        self.state.renderer_builds.clone()
    }

    /// Working-tree changes as they happen, or `None` outside repository mode.
    pub fn changes(&self) -> Option<Changes> {
        let workspace = self.state.workspace.as_ref()?;
        let receiver = workspace.subscribe();
        let since = receiver.borrow().generation;
        Some(Changes {
            state: Arc::downgrade(&self.state),
            receiver,
            since,
        })
    }

    /// Stops jobs, sweeps, thumbnails and long polls, and waits for jobs to finish.
    pub async fn close(&self) {
        shutdown(self.state.clone()).await;
    }
}

/// A subscription to working-tree changes ([`Service::changes`]).
pub struct Changes {
    state: Weak<ServiceState>,
    receiver: watch::Receiver<WorkspaceChanges>,
    since: u64,
}

impl Changes {
    /// Waits for the next generation and returns what `GET /api/changes`
    /// returns for the previous one: `{"generation", "changes", "complete"}`;
    /// `None` once the service is closing.
    pub async fn next(&mut self) -> Option<Value> {
        loop {
            self.receiver.changed().await.ok()?;
            if self.state.upgrade().is_none_or(|state| state.closing.load(Ordering::SeqCst)) {
                return None;
            }
            let value = changes_since(&self.receiver.borrow_and_update(), self.since);
            let generation = value["generation"].as_u64().unwrap_or(self.since);
            if generation != self.since {
                self.since = generation;
                return Some(value);
            }
        }
    }
}
