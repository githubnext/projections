//! What the service holds while it runs, and runners for its requests.

use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, Ordering},
    },
};

use anyhow::{Context as _, Result};
use axum::{Router, http::StatusCode};
use rand::RngCore;
use serde_json::Value;
use tokio::sync::watch;

use super::{
    InspectorOptions,
    assets::{CUSTOM_RENDERERS, files::validate_assets},
    http::HttpError,
    jobs::Job,
    prepare::PrepareRun,
    routes::route,
    sweeps::SweepRun,
    watchers::{watch_fixtures, watch_workspace},
};
use crate::{
    fixtures::{self, Fixtures},
    runtime::Runner,
};

pub(super) struct FixturesState {
    pub(super) sources: Vec<PathBuf>,
    pub(super) renderers: Vec<PathBuf>,
    /// Whether bundles the scenarios name besides `renderers` are served.
    pub(super) trust: bool,
    /// URL prefix of fixture renderer bundles.
    pub(super) base: String,
    /// The check probe script injected into renderer documents.
    pub(super) probe: String,
    pub(super) current: watch::Sender<Arc<Snapshot>>,
}

pub(super) struct Snapshot {
    pub(super) generation: u64,
    pub(super) fixtures: Fixtures,
}

/// Working-tree changes in repository mode: the generation, and the change
/// kinds of recent generations (see `workspace::Change`).
pub(super) struct WorkspaceChanges {
    pub(super) generation: u64,
    pub(super) log: VecDeque<(u64, Vec<crate::workspace::Change>)>,
    /// The working tree's Git tree hash at the latest generation, when known.
    pub(super) tree: Option<String>,
}

/// The `definitionRevision`, `before` or `after` that names the working tree.
pub(super) const WORKING_TREE: &str = "working-tree";

pub(super) struct ServiceState {
    pub(super) repo: PathBuf,
    pub(super) trust: bool,
    pub(super) executable: Option<PathBuf>,
    pub(super) document: Option<Value>,
    pub(super) custom_renderers: bool,
    pub(super) assets: PathBuf,
    /// A random per-service path segment of custom renderer URLs, so a bundle
    /// URL from one service never resolves in another.
    pub(super) capability: String,
    pub(super) closing: AtomicBool,
    pub(super) jobs: Mutex<VecDeque<Arc<Job>>>,
    /// Held by the running job: jobs from every client (a panel, each
    /// projection tab) queue for it and run one at a time.
    pub(super) collecting: tokio::sync::Mutex<()>,
    pub(super) reads: Mutex<Vec<Weak<AtomicBool>>>,
    pub(super) fixtures: Option<FixturesState>,
    /// Repository mode only.
    pub(super) workspace: Option<watch::Sender<WorkspaceChanges>>,
    /// An explore session's candidates.
    pub(super) explore: Option<Vec<Value>>,
    /// Candidates available outside an explore session (`InspectorOptions::candidates`).
    pub(super) candidates: Vec<Value>,
    pub(super) execution: crate::runtime::ExecutionPolicy,
    /// The latest history sweep, and the extractions every sweep shares.
    pub(super) sweep: Mutex<Option<SweepRun>>,
    /// Prepare runs (`POST /api/prepare`), newest last; four finished ones are kept.
    pub(super) prepares: Mutex<VecDeque<Arc<PrepareRun>>>,
    pub(super) sweep_cache: Arc<crate::sweep::Cache>,
    /// Diff thumbnails, and the lock that renders them one at a time.
    pub(super) thumbnails: Mutex<VecDeque<(String, Arc<Vec<u8>>)>>,
    pub(super) rendering: Arc<tokio::sync::Mutex<()>>,
    /// Set at shutdown, so a thumbnail's browser stops rather than delaying it.
    pub(super) rendering_cancel: Arc<AtomicBool>,
    /// Custom renderer builds, in repository mode (`GET` and `POST /api/renderer-builds`).
    pub(super) renderer_builds: Option<Arc<crate::renderer_builds::RendererBuilds>>,
}

impl ServiceState {
    pub(super) fn runner(&self) -> Runner {
        let mut runner = Runner::new(self.repo.clone(), self.trust).with_policy(&self.execution);
        let candidates = self.explore.as_ref().unwrap_or(&self.candidates);
        if !candidates.is_empty() {
            // Validated when the session started.
            runner = runner.clone().with_trials(crate::explore::trials(candidates)).unwrap_or(runner);
        }
        match &self.executable {
            Some(executable) => runner.with_executable(executable.clone()),
            None => runner,
        }
    }
}

struct CancelOnDrop(Arc<AtomicBool>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

pub(super) async fn blocking_runner<T: Send + 'static>(
    state: &ServiceState,
    action: impl FnOnce(Runner) -> Result<T> + Send + 'static,
) -> Result<T, HttpError> {
    let runner = state.runner();
    let _cancel = CancelOnDrop(runner.cancel.clone());
    {
        let mut reads = state.reads.lock().unwrap_or_else(|error| error.into_inner());
        reads.retain(|read| read.strong_count() != 0);
        reads.push(Arc::downgrade(&runner.cancel));
    }
    tokio::task::spawn_blocking(move || action(runner))
        .await
        .map_err(|error| HttpError::new(StatusCode::BAD_REQUEST, error.to_string()))?
        .map_err(|error| HttpError::new(StatusCode::BAD_REQUEST, error.to_string()))
}

pub(super) async fn shutdown(state: Arc<ServiceState>) {
    let jobs = {
        let jobs = state.jobs.lock().unwrap_or_else(|e| e.into_inner());
        state.closing.store(true, Ordering::SeqCst);
        state.rendering_cancel.store(true, Ordering::SeqCst);
        if let Some(sweep) = state.sweep.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            sweep.cancel.store(true, Ordering::SeqCst);
        }
        for job in jobs.iter() {
            job.runner.cancel.store(true, Ordering::SeqCst);
        }
        for run in state.prepares.lock().unwrap_or_else(|e| e.into_inner()).iter() {
            run.cancel.store(true, Ordering::SeqCst);
        }
        jobs.iter().cloned().collect::<Vec<_>>()
    };
    for read in state.reads.lock().unwrap_or_else(|error| error.into_inner()).iter() {
        if let Some(cancel) = read.upgrade() {
            cancel.store(true, Ordering::SeqCst);
        }
    }
    if let Some(fixtures) = &state.fixtures {
        // Wakes long polls so they finish before the server closes.
        fixtures.current.send_modify(|_| {});
    }
    if let Some(workspace) = &state.workspace {
        workspace.send_modify(|_| {});
    }
    if let Some(builds) = &state.renderer_builds {
        builds.stop_all();
    }
    for job in jobs {
        job.wait().await;
    }
}

/// Builds the Inspector's state and router. It binds nothing: the stdio
/// backend and headless pages call the router in memory (`Service`).
pub(super) async fn build(options: InspectorOptions) -> Result<(Router, Arc<ServiceState>)> {
    let fixtures_mode = options.fixtures.is_some();
    let (assets, probe) = tokio::task::spawn_blocking(move || validate_assets(&options.assets, fixtures_mode)).await??;
    let fixtures_trust = options.fixtures.as_ref().is_some_and(|fixtures| fixtures.trust);
    let fixture_paths = match options.fixtures {
        Some(fixtures) => Some(tokio::task::spawn_blocking(move || fixtures::resolve(&fixtures.sources, &fixtures.renderers)).await??),
        None => None,
    };
    let repo = if options.document.is_some() || fixture_paths.is_some() {
        if options.repo.is_absolute() {
            options.repo
        } else {
            std::env::current_dir()?.join(options.repo)
        }
    } else {
        // Without Windows' \\?\ prefix: clients compare it with the folders they have open.
        projections_extractor_sdk::canonical(&options.repo).context("Inspector repository is unavailable")?
    };
    let mut capability_bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut capability_bytes);
    let capability = capability_bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    let mut fingerprint = None;
    let fixtures = match fixture_paths {
        Some((sources, renderers)) => {
            let base = format!("/{CUSTOM_RENDERERS}{capability}/fixtures/");
            let (loaded, watched) = {
                let (sources, renderers, base) = (sources.clone(), renderers.clone(), base.clone());
                tokio::task::spawn_blocking(move || {
                    let loaded = fixtures::load(&sources, &renderers, &base, false, fixtures_trust);
                    let watched = fixtures::fingerprint(&loaded.watched);
                    (loaded, watched)
                })
                .await?
            };
            fingerprint = Some(watched);
            Some(FixturesState {
                sources,
                renderers,
                trust: fixtures_trust,
                base,
                probe: probe.context("Inspector check probe is unavailable")?,
                current: watch::Sender::new(Arc::new(Snapshot {
                    generation: 1,
                    fixtures: loaded,
                })),
            })
        }
        None => None,
    };
    // Repository mode watches the working tree for live previews.
    let (workspace, initial_workspace) = if fixtures.is_none() && options.document.is_none() {
        let root = repo.clone();
        let initial = tokio::task::spawn_blocking(move || crate::workspace::state(&Runner::new(root.clone(), false), &root)).await?;
        (
            Some(watch::Sender::new(WorkspaceChanges {
                generation: 1,
                log: VecDeque::new(),
                tree: None,
            })),
            Some(initial),
        )
    } else {
        (None, None)
    };
    // Repository mode builds custom renderers as views show them.
    let renderer_builds = workspace
        .is_some()
        .then(|| crate::renderer_builds::RendererBuilds::new(repo.clone(), options.trust));
    let state = Arc::new(ServiceState {
        repo,
        trust: options.trust,
        executable: options.executable,
        document: options.document,
        custom_renderers: options.custom_renderers,
        assets,
        capability,
        closing: AtomicBool::new(false),
        jobs: Mutex::new(VecDeque::new()),
        collecting: tokio::sync::Mutex::new(()),
        reads: Mutex::new(Vec::new()),
        fixtures,
        workspace,
        explore: options.explore,
        candidates: options.candidates,
        execution: options.execution,
        sweep: Mutex::new(None),
        prepares: Mutex::new(VecDeque::new()),
        sweep_cache: Arc::new(crate::sweep::Cache::default()),
        thumbnails: Mutex::new(VecDeque::new()),
        rendering: Arc::new(tokio::sync::Mutex::new(())),
        rendering_cancel: Arc::new(AtomicBool::new(false)),
        renderer_builds,
    });
    if let Some(fingerprint) = fingerprint {
        tokio::spawn(watch_fixtures(Arc::downgrade(&state), fingerprint));
    }
    if let Some(initial) = initial_workspace {
        tokio::spawn(watch_workspace(Arc::downgrade(&state), initial));
    }
    let router = Router::new().fallback(route).with_state(state.clone());
    Ok((router, state))
}
