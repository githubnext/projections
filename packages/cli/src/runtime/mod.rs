//! The runner: finds projection definitions at revisions, extracts them
//! where it is cheapest and still trustworthy, and compares the results.

mod batch;
mod capture;
mod compare;
mod components;
mod container;
mod definitions;
mod diagnostics;
mod document;
mod entries;
mod environment;
mod extract;
mod identity;
mod own_files;
mod placement;
mod process;
mod revision;
mod upstream;

pub use batch::{DefinitionChoice, batch_document};
pub use compare::{Compared, DefinitionSource, Sides, parse_range, short};
pub use definitions::invalid_summary;
pub use diagnostics::{TrustRequired, code, diagnostic, diagnostic_code};
pub use extract::{definition_scope, determinism, effective_scope};
pub use process::{ProcessFailure, which, which_in};
pub use revision::read_regular;

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};

use crate::{artifact, collectors};

use revision::Revision;

/// The project's definition directories, relative to the repository's root.
fn definition_directories() -> [String; 2] {
    crate::project::directories()
}
/// The environment file's name in a definition directory, which is not a definition.
pub const ENVIRONMENT_FILE: &str = "environment.json";
const MAX_FILES: usize = 50_000;
const MAX_RULES_BYTES: usize = 64 * 1024 * 1024;
const MAX_RENDERER_BYTES: usize = 64 * 1024 * 1024;
/// A renderer bundle is a self-contained page and its manifest.
const RENDERER_FILES: [&str; 2] = ["index.html", "renderer.json"];
const MAX_BYTES: usize = 256 * 1024 * 1024;

/// Receives progress events, such as prepare steps starting and finishing.
pub type Listener = Arc<dyn Fn(&Value) + Send + Sync>;

#[derive(Clone)]
pub struct Runner {
    pub repo: PathBuf,
    pub trust: bool,
    pub cancel: Arc<AtomicBool>,
    pub outputs: Arc<Mutex<Vec<Value>>>,
    current: Arc<Mutex<Value>>,
    isolation: Option<(String, String)>,
    executable: Option<PathBuf>,
    variables: Option<Arc<BTreeMap<String, String>>>,
    /// Trial definitions held in an explore session: defined at every
    /// revision whose own definitions don't use the same ID, and never written.
    trials: Arc<Vec<Value>>,
    /// Whether a commit that is `HEAD` may be extracted in place when only
    /// untracked files differ (`--in-place`).
    in_place_allowed: bool,
    /// The persistent extraction cache, when enabled.
    cache: Option<Arc<crate::extraction_cache::ExtractionCache>>,
    /// The per-user cache base, when not the default (tests).
    cache_base: Option<PathBuf>,
    /// How many extractions the cache supplied.
    cache_hits: Arc<std::sync::atomic::AtomicUsize>,
    /// CI artifacts that may supply extractions of commits.
    artifacts: Arc<crate::ci_artifacts::Artifacts>,
    /// The workspace strategy chosen on the command line (`--workspace`).
    workspace: Option<crate::workspaces::Strategy>,
    /// Receives progress events (prepare steps) instead of stderr.
    listener: Option<Listener>,
    /// The environment's toolchain identity, computed once.
    toolchain: Arc<std::sync::OnceLock<String>>,
    /// Hand extractors no generation store snapshot, so every generated
    /// value is generated again (`--regenerate`).
    regenerate: bool,
}

/// How a runner chooses where extractions come from, set by command-line flags
/// and (for the Inspector) by the editor that starts `serve --stdio`.
#[derive(Clone, Debug, Default)]
pub struct ExecutionPolicy {
    /// Use the persistent extraction cache (commands do, unless `--no-cache`).
    pub cache: bool,
    /// Directories holding downloaded CI artifacts (`--artifact DIR`).
    pub artifacts: Vec<PathBuf>,
    /// Download the repository's own CI artifacts with `gh` (`--ci`).
    pub download: bool,
    /// The workflow files whose runs' artifacts are the repository's own CI
    /// output (`--ci-workflow`), ahead of the configuration's `ciWorkflows`.
    pub ci_workflows: Vec<String>,
    /// Extract a `HEAD` commit in place despite untracked files (`--in-place`).
    pub in_place: bool,
    /// The workspace strategy (`--workspace`), ahead of configuration.
    pub workspace: Option<crate::workspaces::Strategy>,
    /// Generate every generated value again (`--regenerate`).
    pub regenerate: bool,
}

/// A definition prepared to extract revisions with ([`Runner::prepare`]).
pub struct Prepared {
    program: Revision,
    pub definition: Value,
    /// The definition's digest: its canonical form and every declared source.
    pub digest: String,
    /// The comparator file of the definition's custom comparator, if any.
    pub rules: Option<Vec<u8>>,
}

/// A materialized revision ([`Runner::captured`]).
pub struct Captured(Revision);

#[derive(Debug)]
pub struct ProcessOutput {
    pub stdout: String,
    pub stderr: String,
}

impl Runner {
    pub fn new(repo: PathBuf, trust: bool) -> Self {
        Self {
            repo,
            trust,
            cancel: Arc::new(AtomicBool::new(false)),
            outputs: Arc::new(Mutex::new(Vec::new())),
            current: Arc::new(Mutex::new(Value::Null)),
            isolation: None,
            executable: None,
            variables: None,
            trials: Arc::new(Vec::new()),
            in_place_allowed: false,
            cache: None,
            cache_base: None,
            cache_hits: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            artifacts: Arc::new(crate::ci_artifacts::Artifacts::default()),
            workspace: None,
            listener: None,
            toolchain: Arc::new(std::sync::OnceLock::new()),
            regenerate: false,
        }
    }

    /// Hands extractors no snapshot of the generation store (`--regenerate`):
    /// every generated value is generated again. Results are still recorded,
    /// but a stored value keeps its place.
    pub fn with_regenerate(mut self, regenerate: bool) -> Self {
        self.regenerate = regenerate;
        self
    }

    /// Uses the workspace strategy `strategy` for toolchain extractions of
    /// commits that aren't checked out, ahead of the configured or automatic one.
    pub fn with_workspace(mut self, strategy: Option<crate::workspaces::Strategy>) -> Self {
        self.workspace = strategy;
        self
    }

    /// Sends progress events (prepare steps) to `listener` instead of stderr.
    pub fn with_listener(mut self, listener: Listener) -> Self {
        self.listener = Some(listener);
        self
    }

    /// Applies an execution policy: the cache when enabled (a cache that
    /// can't be opened is reported and skipped), CI artifacts and `--in-place`.
    pub fn with_policy(self, policy: &ExecutionPolicy) -> Self {
        // The user configuration can turn on CI artifacts for every run.
        let download = policy.download
            || self.repository_root().is_ok_and(|root| {
                crate::workspaces::config().is_ok_and(|config| crate::workspaces::setting(&config, &root, "ci") == Some(json!(true)))
            });
        let mut workflows = policy.ci_workflows.clone();
        if workflows.is_empty()
            && let Ok(root) = self.repository_root()
            && let Ok(config) = crate::workspaces::config()
        {
            workflows = match crate::workspaces::setting(&config, &root, "ciWorkflows") {
                Some(Value::String(workflow)) => vec![workflow],
                Some(Value::Array(workflows)) => workflows
                    .iter()
                    .filter_map(|workflow| workflow.as_str().map(str::to_owned))
                    .collect(),
                _ => Vec::new(),
            };
        }
        let mut runner = self
            .with_regenerate(policy.regenerate)
            .with_in_place(policy.in_place)
            .with_workspace(policy.workspace)
            .with_ci_artifacts(policy.artifacts.clone(), download, workflows);
        if policy.cache {
            runner = match runner.clone().with_cache() {
                Ok(cached) => cached,
                Err(error) => {
                    eprintln!("projections: note: extractions are not cached: {error:#}");
                    runner
                }
            };
        }
        runner
    }

    /// Uses the persistent extraction cache ([`crate::extraction_cache`]) for
    /// this repository. Commands enable it; `--no-cache` doesn't.
    pub fn with_cache(mut self) -> Result<Self> {
        let directory = self.common_directory()?;
        self.cache = Some(Arc::new(crate::extraction_cache::ExtractionCache::open(&directory)?));
        Ok(self)
    }

    /// Uses the persistent extraction cache under another cache base, for tests.
    pub fn with_cache_in(mut self, base: &Path) -> Result<Self> {
        let directory = self.common_directory()?;
        self.cache_base = Some(base.to_path_buf());
        self.cache = Some(Arc::new(crate::extraction_cache::ExtractionCache::open_in(base, &directory)?));
        Ok(self)
    }

    /// Keeps workspaces and downloads under another cache base, for tests.
    pub fn with_cache_base(mut self, base: &Path) -> Self {
        self.cache_base = Some(base.to_path_buf());
        self
    }

    /// The per-user cache base this runner uses.
    pub fn cache_base(&self) -> Result<PathBuf> {
        match &self.cache_base {
            Some(base) => Ok(base.clone()),
            None => crate::cache::base(),
        }
    }

    /// This runner without the persistent cache or CI artifacts: every
    /// extraction runs, as a rerun that measures determinism must.
    pub fn uncached(&self) -> Runner {
        let mut runner = self.clone();
        runner.cache = None;
        runner.artifacts = Arc::new(crate::ci_artifacts::Artifacts::default());
        runner
    }

    /// The persistent extraction cache this runner uses, if any.
    pub fn extraction_cache(&self) -> Option<&crate::extraction_cache::ExtractionCache> {
        self.cache.as_deref()
    }

    /// How many extractions the persistent cache has supplied.
    pub fn cache_hits(&self) -> usize {
        self.cache_hits.load(Ordering::SeqCst)
    }

    /// Reuses verified extractions from CI artifacts in `directories` and, when
    /// `download`, from the repository's own CI runs (`gh`).
    pub fn with_artifacts(self, directories: Vec<PathBuf>, download: bool) -> Self {
        self.with_ci_artifacts(directories, download, Vec::new())
    }

    /// As [`Self::with_artifacts`], accepting only runs of the workflow files
    /// `workflows` names (paths or file names); empty accepts the workflows
    /// that use the Projections Action on the default branch.
    pub fn with_ci_artifacts(mut self, directories: Vec<PathBuf>, download: bool, workflows: Vec<String>) -> Self {
        self.artifacts = Arc::new(crate::ci_artifacts::Artifacts::new(directories, download, workflows));
        self
    }

    /// Lets a commit that is the checkout's `HEAD` be extracted in place when
    /// its tracked files are unmodified, even with untracked files present
    /// (such as CI's build output): `--in-place`.
    pub fn with_in_place(mut self, allowed: bool) -> Self {
        self.in_place_allowed = allowed;
        self
    }

    /// Adds trial definitions (each validated) that every revision defines
    /// unless its own definitions use the same ID: explore's candidates.
    pub fn with_trials(mut self, trials: Vec<Value>) -> Result<Self> {
        let trials = trials.iter().map(artifact::validate_definition).collect::<Result<Vec<_>>>()?;
        self.trials = Arc::new(trials);
        Ok(self)
    }

    /// This runner without trial definitions: only what the repository defines.
    pub fn without_trials(&self) -> Self {
        let mut runner = self.clone();
        runner.trials = Arc::new(Vec::new());
        runner
    }

    /// The trial definitions this runner adds.
    pub fn trials(&self) -> &[Value] {
        &self.trials
    }

    /// A runner like this one (repository, trust, cancellation, executable,
    /// trials) with its own revision state and no recorded output, for running
    /// extractions in parallel without sharing either.
    pub fn detached(&self) -> Runner {
        Runner {
            current: Arc::new(Mutex::new(Value::Null)),
            outputs: Arc::new(Mutex::new(Vec::new())),
            ..self.clone()
        }
    }

    /// Reads extractor environment variables other than `PATH` and `SystemRoot`
    /// from `variables` instead of this process, for embedders and tests that
    /// supply an extractor's environment explicitly. Absent names are unset.
    pub fn with_variables(mut self, variables: BTreeMap<String, String>) -> Self {
        self.variables = Some(Arc::new(variables));
        self
    }

    /// Runs built-in extractors with this Projections executable instead of the
    /// current one, for embedders and tests that link the runner.
    pub fn with_executable(mut self, executable: impl Into<PathBuf>) -> Self {
        self.executable = Some(executable.into());
        self
    }

    /// The executable whose extractor entrypoint runs the built-in extractors.
    pub fn executable(&self) -> Result<PathBuf> {
        match &self.executable {
            Some(executable) => Ok(executable.clone()),
            None => std::env::current_exe().context("Cannot locate the Projections executable"),
        }
    }

    /// A runner for the Git checkout enclosing `path` (a working tree's top level,
    /// found the way `git rev-parse --show-toplevel` does), so commands work from
    /// any subdirectory. A bare repository or a path Git doesn't recognize is used
    /// as given, and `repository_root` reports what is wrong with it.
    pub fn at_checkout(path: PathBuf, trust: bool) -> Self {
        let probe = Self::new(path.clone(), false);
        let root = projections_extractor_sdk::canonical(&path)
            .ok()
            .and_then(|start| {
                let bare = probe.git_text(&start, &["rev-parse", "--is-bare-repository"]).ok()?;
                (bare == "false")
                    .then(|| probe.git_text(&start, &["rev-parse", "--show-toplevel"]).ok())
                    .flatten()
            })
            .map_or(path, PathBuf::from);
        Self::new(root, trust)
    }

    pub fn set_container(&mut self, engine: &str, image: &str) -> Result<()> {
        ensure!(
            ["docker", "podman"].contains(&engine)
                && regex::Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$")?.is_match(image),
            "Container requires docker/podman and immutable image@sha256"
        );
        self.isolation = Some((engine.into(), image.into()));
        Ok(())
    }

    fn require_trust(&self, definition: &Value) -> Result<()> {
        if !self.trust && collectors::requires_trust(definition) {
            return Err(TrustRequired.into());
        }
        Ok(())
    }

    pub fn check_cancelled(&self) -> Result<()> {
        ensure!(!self.cancel.load(Ordering::SeqCst), "Operation was cancelled");
        Ok(())
    }

    pub fn environment(&self, names: &[String]) -> Result<BTreeMap<String, String>> {
        let mut environment = BTreeMap::from([
            ("LANG".into(), "C.UTF-8".into()),
            ("LC_ALL".into(), "C.UTF-8".into()),
            ("TZ".into(), "UTC".into()),
        ]);
        for name in ["PATH", "SystemRoot"].into_iter().chain(names.iter().map(String::as_str)) {
            ensure!(
                !name.is_empty()
                    && name
                        .bytes()
                        .enumerate()
                        .all(|(i, byte)| byte == b'_' || byte.is_ascii_alphabetic() || (i > 0 && byte.is_ascii_digit())),
                "Invalid environment name"
            );
            let value = match &self.variables {
                Some(variables) if !["PATH", "SystemRoot"].contains(&name) => variables.get(name).cloned(),
                _ => std::env::var(name).ok(),
            };
            if let Some(value) = value {
                environment.insert(name.into(), value);
            }
        }
        Ok(environment)
    }

    pub fn record_output(&self, reference: &str, stdout: &str, stderr: &str) {
        self.outputs
            .lock()
            .expect("output lock")
            .push(json!({"ref":reference,"stdout":stdout,"stderr":stderr}));
    }

    pub fn extractor_request(&self, definition: &Value, root: &Path) -> Value {
        let revision = self.current.lock().expect("revision lock").clone();
        let mut request = json!({"protocolVersion":0,"projection":{"id":definition["id"],"definition":definition},
            "repository":{"mode":"materialized","root":root,"revision":revision,"project":crate::project::prefix()},
            "capabilities":{"trusted":self.trust,"network":definition["execution"]["network"]==true}});
        // Extractors may resolve the project's installed dependencies in the user's
        // working checkout; materialized revisions omit ignored files.
        if let Ok(checkout) = projections_extractor_sdk::canonical(&self.repo) {
            request["repository"]["checkout"] = json!(checkout);
        }
        request
    }
}

/// The current time in UTC, to the second: `2026-01-31T12:00:00Z`.
pub fn utc_now() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs()) as i64;
    let (days, time) = (seconds.div_euclid(86_400), seconds.rem_euclid(86_400));
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        time / 3600,
        time % 3600 / 60,
        time % 60
    )
}
