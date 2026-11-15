//! Running a sweep: each projection's working-tree definition prepared once,
//! a bounded pool of workers extracting every revision the changes name into
//! the shared cache, and each change's cells reported as soon as both of its
//! revisions are done.

use super::{Cache, Cell, Change, Request};
use crate::{
    artifact,
    runtime::{Prepared, Runner, TrustRequired},
};
use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::{
    collections::{BTreeSet, HashMap},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

/// Runs a sweep, reporting each projection row's failure and each cell as it
/// finishes. Rows: `{projection, status: "ready"|"trust"|"failed", error?}`;
/// cells: `{projection, before, after, status: "changed"|"unchanged"|"failed", changes, steps, counts, error?, stderr?}`,
/// `stderr` being the end of a failed extractor's stderr.
pub fn run(runner: &Runner, request: Request<'_>, on_row: &(dyn Fn(Value) + Sync), on_cell: &(dyn Fn(Cell) + Sync)) -> Result<()> {
    let root = runner.repository_root()?;
    let prepared = prepare(runner, &request.projections, on_row);
    if prepared.is_empty() {
        return Ok(());
    }
    let commits = revisions(&request.changes);
    let trees: HashMap<String, String> = commits
        .iter()
        .map(|commit| Ok((commit.clone(), runner.tree(&root, commit)?)))
        .collect::<Result<_>>()?;
    let sweep = Sweep {
        runner,
        changes: &request.changes,
        cache: request.cache,
        prepared,
        commits,
        trees,
        failures: Mutex::new(HashMap::new()),
        done: Mutex::new(BTreeSet::new()),
        emitted: Mutex::new(BTreeSet::new()),
        next: AtomicUsize::new(0),
        on_cell,
    };
    std::thread::scope(|scope| -> Result<()> {
        let handles: Vec<_> = (0..request.concurrency.clamp(1, 8)).map(|_| scope.spawn(|| sweep.work())).collect();
        for handle in handles {
            handle.join().map_err(|_| anyhow::anyhow!("A sweep worker panicked"))??;
        }
        Ok(())
    })
    .context("The sweep failed")
}

/// Each projection's working-tree definition, prepared once, reporting each
/// projection's row.
fn prepare(runner: &Runner, projections: &[String], on_row: &(dyn Fn(Value) + Sync)) -> Vec<(String, Prepared)> {
    let mut prepared = Vec::new();
    for id in projections {
        match runner.prepare(id, "working-tree") {
            Ok(definition) => {
                on_row(
                    json!({"projection": id, "status": "ready", "requiresTrust": crate::collectors::requires_trust(&definition.definition)}),
                );
                prepared.push((id.clone(), definition));
            }
            Err(error) if error.chain().any(|cause| cause.is::<TrustRequired>()) => on_row(json!({
                "projection": id, "status": "trust",
                "error": "It runs repository code: start with --trust to sweep it",
            })),
            Err(error) => on_row(json!({"projection": id, "status": "failed", "error": format!("{error:#}")})),
        }
    }
    prepared
}

/// Revisions in the order their changes come, each once.
fn revisions(changes: &[Change]) -> Vec<String> {
    let mut commits: Vec<String> = Vec::new();
    for change in changes {
        for commit in [&change.after, &change.before] {
            if !commits.contains(commit) {
                commits.push(commit.clone());
            }
        }
    }
    commits
}

/// One running sweep's state, shared by its workers.
struct Sweep<'a> {
    runner: &'a Runner,
    changes: &'a [Change],
    cache: &'a Cache,
    prepared: Vec<(String, Prepared)>,
    /// The revisions to extract, in order.
    commits: Vec<String>,
    /// Each revision's Git tree.
    trees: HashMap<String, String>,
    /// Failures by (projection, commit), for this sweep only: `{error, stderr?}`.
    failures: Mutex<HashMap<(String, String), Value>>,
    /// Revisions every projection has finished.
    done: Mutex<BTreeSet<String>>,
    /// Changes whose cells were reported, by index.
    emitted: Mutex<BTreeSet<usize>>,
    /// The next revision a worker takes.
    next: AtomicUsize,
    on_cell: &'a (dyn Fn(Cell) + Sync),
}

impl Sweep<'_> {
    fn key(&self, prepared: &Prepared, commit: &str) -> String {
        format!("{}|{}", prepared.digest, self.trees[commit])
    }

    fn cancelled(&self) -> bool {
        self.runner.cancel.load(Ordering::SeqCst)
    }

    /// Takes revisions until none are left (or the sweep is cancelled),
    /// extracting each and reporting the changes it completes.
    fn work(&self) -> Result<()> {
        loop {
            if self.cancelled() {
                return Ok(());
            }
            let index = self.next.fetch_add(1, Ordering::SeqCst);
            let Some(commit) = self.commits.get(index) else {
                return Ok(());
            };
            if !self.extract(commit) {
                return Ok(());
            }
            self.emit(commit);
        }
    }

    /// Extracts `commit` for every projection the cache lacks it for,
    /// recording failures. False when the sweep was cancelled meanwhile.
    fn extract(&self, commit: &str) -> bool {
        let missing: Vec<&(String, Prepared)> = self
            .prepared
            .iter()
            .filter(|(_, definition)| self.cache.get(&self.key(definition, commit)).is_none())
            .collect();
        if missing.is_empty() {
            return true;
        }
        // A fresh runner per revision: its own revision state, and its recorded output freed after.
        let local = self.runner.detached();
        let captured = match local.captured(commit) {
            Ok(captured) => captured,
            Err(error) => {
                for (id, _) in missing {
                    self.fail(id, commit, json!({"error": format!("{error:#}")}));
                }
                return true;
            }
        };
        for (id, definition) in missing {
            if self.cancelled() {
                return false;
            }
            match local.detached().extract_captured(&captured, definition) {
                Ok(document) => self.cache.insert(self.key(definition, commit), Arc::new(document)),
                Err(error) => self.fail(id, commit, failure(&error)),
            }
        }
        true
    }

    fn fail(&self, id: &str, commit: &str, error: Value) {
        self.failures.lock().unwrap().insert((id.to_owned(), commit.to_owned()), error);
    }

    fn extraction(&self, id: &str, prepared: &Prepared, commit: &str) -> Result<Arc<Value>, Value> {
        if let Some(error) = self.failures.lock().unwrap().get(&(id.to_owned(), commit.to_owned())) {
            return Err(error.clone());
        }
        self.cache
            .get(&self.key(prepared, commit))
            .ok_or_else(|| json!({"error": "Not extracted"}))
    }

    /// Marks `commit` done and reports the cells of every change it
    /// completes, each change once.
    fn emit(&self, commit: &str) {
        let finished = {
            let mut done = self.done.lock().unwrap();
            done.insert(commit.to_owned());
            done.clone()
        };
        for (index, change) in self.changes.iter().enumerate() {
            if !(finished.contains(&change.before) && finished.contains(&change.after)) {
                continue;
            }
            if !self.emitted.lock().unwrap().insert(index) {
                continue;
            }
            for (id, definition) in &self.prepared {
                (self.on_cell)(self.cell(id, definition, change));
            }
        }
    }

    /// One projection on one change: its comparison, or why it failed.
    fn cell(&self, id: &str, definition: &Prepared, change: &Change) -> Cell {
        let base = json!({"projection": id, "before": change.before, "after": change.after});
        let (before, after) = match (
            self.extraction(id, definition, &change.before),
            self.extraction(id, definition, &change.after),
        ) {
            (Ok(before), Ok(after)) => (before, after),
            (Err(error), _) | (_, Err(error)) => return failed(base, error),
        };
        match artifact::compare_extractions_with(&before, &after, definition.rules.as_deref()) {
            Ok(comparison) => compared(base, comparison),
            Err(error) => failed(base, json!({"error": format!("{error:#}")})),
        }
    }
}

fn compared(mut value: Value, comparison: Value) -> Cell {
    let changes = comparison["comparison"]["changes"].as_array().map_or(0, Vec::len);
    let steps = comparison["comparison"]["steps"].as_array().map_or(0, Vec::len);
    value["status"] = json!(if changes > 0 { "changed" } else { "unchanged" });
    value["changes"] = json!(changes);
    value["steps"] = json!(steps);
    value["counts"] = counts(&comparison);
    Cell {
        value,
        comparison: (changes > 0).then(|| Arc::new(comparison)),
    }
}

/// A failed cell: `error`, and `stderr` when the extractor wrote some.
fn failed(mut value: Value, failure: Value) -> Cell {
    value["status"] = json!("failed");
    value["error"] = failure["error"].clone();
    if failure["stderr"].is_string() {
        value["stderr"] = failure["stderr"].clone();
    }
    Cell { value, comparison: None }
}

/// Bytes of an extractor's stderr a failed cell keeps: the end, where the error usually is.
pub(super) const STDERR_TAIL: usize = 2048;

/// Why an extraction failed: `{error, stderr?}`, with the tail of the
/// extractor's stderr.
fn failure(error: &anyhow::Error) -> Value {
    let report = crate::diagnostics::report(error);
    let mut failure = json!({"error": report["message"]});
    if let Some(stderr) = report["stderr"].as_str().map(str::trim_end).filter(|stderr| !stderr.is_empty()) {
        failure["stderr"] = json!(tail(stderr, STDERR_TAIL));
    }
    failure
}

/// The last `limit` bytes of `text` at most, from a character boundary,
/// marked with `…` when cut.
pub(super) fn tail(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.to_owned();
    }
    let mut start = text.len() - limit;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    format!("…{}", &text[start..])
}

fn counts(comparison: &Value) -> Value {
    let mut counts = serde_json::Map::new();
    for change in comparison["comparison"]["changes"].as_array().into_iter().flatten() {
        let status = change["status"].as_str().unwrap_or("modified").to_owned();
        let entry = counts.entry(status).or_insert(json!(0));
        *entry = json!(entry.as_u64().unwrap_or(0) + 1);
    }
    Value::Object(counts)
}
