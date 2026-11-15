//! Running an environment's prepare steps: the records of past runs, the
//! hashes of the key files that decide whether a step is due, and the runs
//! themselves.

use super::Environment;
use crate::runtime::Runner;
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

/// How much of a step's output its log keeps.
const LOG_LIMIT: u64 = 4 * 1024 * 1024;
/// Variables every prepare step receives (when set), besides those it names:
/// package managers keep their global stores and configuration under the home
/// and cache directories, and reach registries through proxies.
const PREPARE_VARIABLES: [&str; 16] = [
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
];

/// Where a directory's prepare runs are recorded: `prepare.json` and `logs/`.
#[derive(Clone, Debug)]
pub struct Records {
    pub directory: PathBuf,
}

impl Records {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    fn file(&self) -> PathBuf {
        self.directory.join("prepare.json")
    }

    /// The recorded runs: `{"steps": {ID: {"key", "status", "at", "durationMs", "log", "error"?}}}`.
    pub fn load(&self) -> Value {
        fs::read(self.file())
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .filter(|value| value["steps"].is_object())
            .unwrap_or_else(|| json!({"steps": {}}))
    }

    fn record(&self, id: &str, record: Value) -> Result<()> {
        let mut records = self.load();
        records["steps"][id] = record;
        crate::cache::private_directory(&self.directory)?;
        let staged = self.directory.join(".prepare.json.staging");
        fs::write(&staged, crate::json_text::pretty(&records)?)?;
        fs::rename(&staged, self.file())?;
        Ok(())
    }

    /// The log a step's latest run wrote.
    pub fn log(&self, id: &str) -> PathBuf {
        self.directory.join("logs").join(format!("{id}.log"))
    }
}

/// What to prepare and how.
#[derive(Clone, Debug, Default)]
pub struct Options {
    /// Run every selected step even when its key is unchanged.
    pub force: bool,
    /// Only these steps (every step when empty).
    pub steps: Vec<String>,
}

/// The files of a checkout at `root` as Git lists them, with their blob IDs:
/// tracked and untracked, not ignored.
pub fn blobs(runner: &Runner, root: &Path, files: &[&String]) -> Result<Vec<(String, String)>> {
    if files.is_empty() {
        return Ok(Vec::new());
    }
    let input = files.iter().map(|file| file.as_str()).collect::<Vec<_>>().join("\n") + "\n";
    let output = runner.git(root, &["hash-object", "--stdin-paths"], Some(input.as_bytes()), 1024 * 1024)?;
    let ids: Vec<&str> = std::str::from_utf8(&output)?.lines().collect();
    ensure!(ids.len() == files.len(), "Incomplete Git blob IDs");
    Ok(files.iter().zip(ids).map(|(file, id)| ((*file).clone(), id.to_owned())).collect())
}

/// The files Git lists in the checkout at `root`.
pub fn files(runner: &Runner, root: &Path) -> Result<Vec<String>> {
    let listed = runner.git(
        root,
        &["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        None,
        64 * 1024 * 1024,
    )?;
    let mut files: Vec<String> = std::str::from_utf8(&listed)?
        .split('\0')
        .filter(|name| !name.is_empty() && !name.ends_with('/') && root.join(name).is_file())
        .map(str::to_owned)
        .collect();
    files.sort();
    files.dedup();
    Ok(files)
}

/// Finds the Git blob IDs of some of a revision's files: `(path, blob)`.
pub type BlobIds<'a> = dyn Fn(&[&String]) -> Result<Vec<(String, String)>> + 'a;

/// Each step's key hash, given a revision's files and how to find the blob
/// IDs of some of them.
pub fn keys(environment: &Environment, files: &[String], blob_ids: &BlobIds<'_>) -> Result<BTreeMap<String, String>> {
    environment
        .prepare
        .iter()
        .map(|step| {
            let matched = step.matches(files)?;
            Ok((step.id.clone(), step.key_hash(&blob_ids(&matched)?)))
        })
        .collect()
}

/// Each step's key hash in the checkout at `root`, as its files are now.
pub fn checkout_keys(runner: &Runner, root: &Path, environment: &Environment) -> Result<BTreeMap<String, String>> {
    let files = files(runner, root)?;
    keys(environment, &files, &|matched| blobs(runner, root, matched))
}

/// Each step's state, given its current key hashes: `current` (its last run
/// succeeded with the same key), `stale` (it ran with another key), `failed`
/// or `never`, with its key and last run.
pub fn status(environment: &Environment, keys: &BTreeMap<String, String>, records: &Records) -> Result<Vec<Value>> {
    let recorded = records.load();
    Ok(environment
        .prepare
        .iter()
        .map(|step| {
            let last = &recorded["steps"][&step.id];
            let key = &keys[&step.id];
            let state = if last.is_null() {
                "never"
            } else if last["status"] != "succeeded" {
                "failed"
            } else if last["key"] == key.as_str() {
                "current"
            } else {
                "stale"
            };
            let mut value = json!({"id": step.id, "run": step.run, "directory": step.directory,
                "key": key, "state": state});
            if !last.is_null() {
                value["last"] = last.clone();
            }
            value
        })
        .collect())
}

/// Runs the environment's prepare steps in the checkout at `root`, each only
/// when its key changed since its last successful run there (or with
/// `options.force`), recording each run in `records`. `progress` receives
/// `{"step", "event": "start"|"skip"|"succeeded"|"failed", ...}`. Returns each
/// step's outcome: `{"id", "key", "status": "current"|"succeeded", "durationMs"?, "log"?}`.
/// A failed step stops the rest and fails, naming the step and its log.
#[allow(clippy::too_many_arguments)]
pub fn prepare(
    runner: &Runner,
    root: &Path,
    environment: &Environment,
    keys: &BTreeMap<String, String>,
    records: &Records,
    options: &Options,
    progress: &(dyn Fn(Value) + Sync),
) -> Result<Vec<Value>> {
    if !runner.trust {
        bail!(PrepareTrustRequired(environment.path.clone()));
    }
    for id in &options.steps {
        ensure!(
            environment.prepare.iter().any(|step| &step.id == id),
            "{} declares no prepare step {id}",
            environment.path
        );
    }
    let recorded = records.load();
    let mut outcomes = Vec::new();
    for step in &environment.prepare {
        if !options.steps.is_empty() && !options.steps.contains(&step.id) {
            continue;
        }
        runner.check_cancelled()?;
        let key = &keys[&step.id];
        let last = &recorded["steps"][&step.id];
        if !options.force && last["status"] == "succeeded" && last["key"] == key.as_str() {
            progress(json!({"step": step.id, "event": "skip", "reason": "its key files are unchanged"}));
            outcomes.push(json!({"id": step.id, "key": key, "status": "current"}));
            continue;
        }
        let cwd = root.join(&step.directory);
        ensure!(
            cwd.is_dir(),
            "Prepare step {} names directory {}, which doesn't exist",
            step.id,
            step.directory
        );
        let mut names: Vec<String> = PREPARE_VARIABLES.iter().map(|name| (*name).to_owned()).collect();
        names.extend(step.environment.iter().cloned());
        let variables = runner.environment(&names)?;
        let log = records.log(&step.id);
        crate::cache::private_directory(&records.directory)?;
        crate::cache::private_directory(log.parent().context("log directory")?)?;
        progress(json!({"step": step.id, "event": "start", "run": step.run, "log": log}));
        let started = Instant::now();
        let at = crate::runtime::utc_now();
        let outcome = runner.run_logged(&step.run, &cwd, &variables, Duration::from_millis(step.timeout_ms), &log, LOG_LIMIT);
        let duration = started.elapsed().as_millis() as u64;
        let failure = match &outcome {
            Ok(status) if status.success() => None,
            Ok(status) => Some(format!("exited with {status}")),
            Err(error) => Some(format!("{error:#}")),
        };
        let mut record = json!({"key": key, "at": at, "durationMs": duration, "log": log,
            "status": if failure.is_none() { "succeeded" } else { "failed" }});
        if let Some(failure) = &failure {
            record["error"] = json!(failure);
        }
        records.record(&step.id, record)?;
        if let Some(failure) = failure {
            progress(json!({"step": step.id, "event": "failed", "error": failure, "log": log}));
            let tail = fs::read(&log)
                .map(|bytes| {
                    let text = String::from_utf8_lossy(&bytes).into_owned();
                    let lines: Vec<&str> = text.lines().collect();
                    lines[lines.len().saturating_sub(20)..].join("\n")
                })
                .unwrap_or_default();
            bail!(
                "Prepare step {} ({}) failed: {failure}. Its log is {}{}",
                step.id,
                step.run.join(" "),
                log.display(),
                if tail.is_empty() { String::new() } else { format!(":\n{tail}") }
            );
        }
        progress(json!({"step": step.id, "event": "succeeded", "durationMs": duration}));
        outcomes.push(json!({"id": step.id, "key": key, "status": "succeeded",
            "durationMs": duration, "log": log}));
    }
    Ok(outcomes)
}

/// Preparing runs repository code, which needs explicit trust.
#[derive(Debug)]
pub struct PrepareTrustRequired(pub String);

impl std::fmt::Display for PrepareTrustRequired {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "Preparing runs the prepare steps {} declares, which are repository code; review them and pass --trust",
            self.0
        )
    }
}

impl std::error::Error for PrepareTrustRequired {}
