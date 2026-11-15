//! Custom renderer builds in the CLI service: a saved renderer source reaches
//! the views that show its projection without a separate `npm run watch`. The
//! service runs the renderer package's `watch` script (once, rebuilding on
//! every save), else its `build` (once per save), reads its output for the
//! build's state (building, built or failed, with the error), and keeps the
//! output for the surfaces that show it: VS Code's task terminal and Problems
//! (`rendererBuilds` notifications over stdio), the viewer's status line and
//! the agent (`GET /api/renderer-builds`). A build is repository code: nothing
//! runs without trust (`--trust`). A view says when it shows a projection
//! (`opened`), when its renderer's sources were saved (`saved`) or may have
//! changed (`changed`), and when it no longer shows it (`closed`), which stops
//! a watcher. The model follows `packages/integrations/vscode/src/renderer-build-model.ts`.

mod output;
mod run;
mod sources;

use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::SystemTime,
};

use serde_json::{Value, json};
use tokio::sync::watch;

pub use output::read_build_line;
use run::kill;
use sources::fingerprint;
pub use sources::{build_script, renderer_package, renderer_sources};

/// The output lines kept per build.
const MAX_LINES: usize = 2000;
const MAX_LINE: usize = 4000;

/// A build's state: `untrusted` (nothing runs), then building, built or failed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Phase {
    Untrusted,
    #[default]
    Building,
    Built,
    Failed,
}

impl Phase {
    pub fn name(self) -> &'static str {
        match self {
            Phase::Untrusted => "untrusted",
            Phase::Building => "building",
            Phase::Built => "built",
            Phase::Failed => "failed",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BuildState {
    pub phase: Phase,
    /// Why it failed: the build's first error line, or why it couldn't start.
    pub error: Option<String>,
    /// The script it runs: `watch` or `build`.
    pub script: Option<String>,
    /// The renderer package, repository-relative.
    pub package: Option<String>,
    /// The error names its file and position (esbuild's `file:line:column: ERROR:`).
    pub located: bool,
}

impl BuildState {
    fn json(&self) -> Value {
        json!({"phase": self.phase.name(), "error": self.error, "script": self.script,
            "package": self.package, "located": self.located})
    }
}

struct Build {
    state: BuildState,
    /// Output lines, by their sequence number.
    lines: VecDeque<(u64, String)>,
    /// Each start of its script counts a run; a view's terminal shows one run.
    run: u64,
    pid: Option<u32>,
    /// The `build` script runs once per save: a save while it runs runs it again after.
    again: bool,
    /// The last run's exit code, once it ended.
    exit: Option<i32>,
    /// The sources as they were when it last built, for `changed`.
    sources: (Option<SystemTime>, usize),
}

impl Build {
    fn new(sources: (Option<SystemTime>, usize)) -> Self {
        Self {
            state: BuildState::default(),
            lines: VecDeque::new(),
            run: 0,
            pid: None,
            again: false,
            exit: None,
            sources,
        }
    }
}

/// The renderer builds of one repository's service.
pub struct RendererBuilds {
    root: PathBuf,
    trust: bool,
    builds: Mutex<HashMap<String, Build>>,
    /// The latest output line's sequence number; bumped on every change.
    sequence: watch::Sender<u64>,
}

impl RendererBuilds {
    pub fn new(root: PathBuf, trust: bool) -> Arc<Self> {
        Arc::new(Self {
            root,
            trust,
            builds: Mutex::new(HashMap::new()),
            sequence: watch::Sender::new(0),
        })
    }

    fn bump(&self) -> u64 {
        let mut next = 0;
        self.sequence.send_modify(|sequence| {
            *sequence += 1;
            next = *sequence;
        });
        next
    }

    /// A subscription that changes with every build change.
    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.sequence.subscribe()
    }

    /// A view's event for a projection: `opened`, `saved`, `changed` or `closed`.
    pub fn event(self: &Arc<Self>, projection: &str, definition: &Value, event: &str) -> Result<(), String> {
        let Some(package) = renderer_package(definition) else {
            if event == "closed" {
                self.stop(projection);
            }
            return Ok(());
        };
        let sources = renderer_sources(definition);
        let running = {
            let builds = self.builds.lock().unwrap_or_else(|e| e.into_inner());
            builds
                .get(projection)
                .map(|build| (build.pid.is_some(), build.state.script.clone(), build.sources))
        };
        match event {
            "closed" => self.stop(projection),
            "opened" => {
                if running.is_some_and(|(alive, ..)| alive) {
                    return Ok(());
                }
                // Built while no view showed it: only when its sources are newer than its bundle.
                let bundle = std::fs::metadata(self.root.join(&package).join("dist/index.html"))
                    .and_then(|metadata| metadata.modified())
                    .ok();
                let (newest, _) = fingerprint(&self.root, &sources);
                if newest > bundle {
                    self.start(projection, definition, &package);
                } else {
                    self.remember(projection, &sources);
                }
            }
            "saved" | "changed" => {
                if event == "changed" {
                    let now = fingerprint(&self.root, &sources);
                    match running {
                        Some((_, _, before)) if before == now => return Ok(()),
                        None => {
                            self.remember(projection, &sources);
                            return Ok(());
                        }
                        _ => {}
                    }
                }
                match running {
                    // A watcher rebuilds on its own; a build runs again once it ends.
                    Some((true, script, _)) => {
                        let mut builds = self.builds.lock().unwrap_or_else(|e| e.into_inner());
                        if let Some(build) = builds.get_mut(projection) {
                            build.sources = fingerprint(&self.root, &sources);
                            if script.as_deref() == Some("build") {
                                build.again = true;
                            }
                        }
                    }
                    _ => self.start(projection, definition, &package),
                }
            }
            other => {
                return Err(format!(
                    "Unknown renderer build event {other}: use opened, saved, changed or closed"
                ));
            }
        }
        Ok(())
    }

    /// Records the sources as they are, for a later `changed`, without building.
    fn remember(&self, projection: &str, sources: &[String]) {
        let print = fingerprint(&self.root, sources);
        let mut builds = self.builds.lock().unwrap_or_else(|e| e.into_inner());
        builds
            .entry(projection.to_owned())
            .and_modify(|build| build.sources = print)
            .or_insert_with(|| Build::new(print));
    }

    fn set(&self, projection: &str, state: BuildState) {
        {
            let mut builds = self.builds.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(build) = builds.get_mut(projection) {
                build.state = state;
            }
        }
        self.bump();
    }

    /// Stops a projection's build and forgets it.
    pub fn stop(&self, projection: &str) {
        let pid = {
            let mut builds = self.builds.lock().unwrap_or_else(|e| e.into_inner());
            builds.remove(projection).and_then(|build| build.pid)
        };
        if let Some(pid) = pid {
            kill(pid);
        }
        self.bump();
    }

    /// Stops every build, as the service closes.
    pub fn stop_all(&self) {
        let pids: Vec<u32> = {
            let mut builds = self.builds.lock().unwrap_or_else(|e| e.into_inner());
            builds.drain().filter_map(|(_, build)| build.pid).collect()
        };
        for pid in pids {
            kill(pid);
        }
        self.bump();
    }

    /// Every build's state and run, and its output lines after `since`:
    /// `{sequence, builds: [{projection, phase, error, script, package, located, run, running, exit, lines}]}`.
    pub fn snapshot(&self, since: u64) -> Value {
        let sequence = *self.sequence.borrow();
        let builds = self.builds.lock().unwrap_or_else(|e| e.into_inner());
        let mut list: Vec<Value> = builds
            .iter()
            .filter(|(_, build)| build.run > 0)
            .map(|(projection, build)| {
                let mut value = build.state.json();
                value["projection"] = json!(projection);
                value["run"] = json!(build.run);
                value["running"] = json!(build.pid.is_some());
                value["exit"] = json!(build.exit);
                value["lines"] = json!(
                    build
                        .lines
                        .iter()
                        .filter(|(at, _)| *at > since)
                        .map(|(_, line)| line.as_str())
                        .collect::<Vec<_>>()
                );
                value
            })
            .collect();
        list.sort_by(|a, b| a["projection"].as_str().cmp(&b["projection"].as_str()));
        json!({"sequence": sequence, "builds": list})
    }

    /// One projection's build state, if it has built.
    pub fn state(&self, projection: &str) -> Option<BuildState> {
        let builds = self.builds.lock().unwrap_or_else(|e| e.into_inner());
        builds
            .get(projection)
            .filter(|build| build.run > 0)
            .map(|build| build.state.clone())
    }
}

impl Drop for RendererBuilds {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[cfg(test)]
mod tests;
