//! `projections check`: verifies a projection end to end, the way an agent
//! must before claiming it works. For each selected projection: its definition
//! is valid, the working tree extracts, `HEAD` compares with it (applying the
//! working tree's definition to both), its custom comparator passes the tests
//! beside its comparator file, a custom renderer's bundle is built and
//! current, and the renderer passes the checks every renderer is held to, in
//! the real host frame of a headless browser.

mod projection;
mod render;
mod renderer;
mod reproducibility;
mod scenarios;
mod stage;
mod text;

pub use text::text;

use crate::{browser, diagnostics, runtime::Runner};
use anyhow::{Context, Result, ensure};
use projection::Checker;
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool},
    time::Duration,
};

pub struct Options {
    /// The projections to check; empty for every one the working tree defines.
    pub ids: Vec<String>,
    /// Run the renderer checks in a headless browser.
    pub render: bool,
    /// The browser executable, when not found automatically.
    pub browser: Option<PathBuf>,
    /// Write a PNG of the (single) projection's working tree here.
    pub png: Option<PathBuf>,
    /// Check this extractor output (what the extractor writes to stdout) for
    /// the single projection, instead of extracting the working tree.
    pub from: Option<PathBuf>,
    pub timeout: Duration,
    pub cancel: Arc<AtomicBool>,
    /// Write or rewrite comparator tests' snapshots.
    pub update: bool,
    /// Measure comparator tests' rule coverage.
    pub coverage: bool,
    /// Compare a local extraction of this commit with CI's artifact for it.
    pub parity: Option<String>,
    /// Fail, rather than warn, when a rerun of the working tree differs.
    pub strict_determinism: bool,
}

/// One check's outcome: `pass`, `fail`, `warn` or `skip`.
fn step(id: &str, title: &str, status: &str, message: impl Into<String>) -> Value {
    json!({"id": id, "title": title, "status": status, "message": message.into()})
}

fn failed(id: &str, title: &str, error: &anyhow::Error) -> Value {
    let report = diagnostics::report(error);
    let mut value = step(id, title, "fail", report["message"].as_str().unwrap_or_default());
    value["error"] = report;
    value
}

/// The check report for `options`, as a `projections.check` document.
pub async fn check(runner: &Runner, options: Options) -> Result<Value> {
    let root = runner.repository_root()?;
    // An invalid definition file fails its own projection's check; the others are checked.
    let (definitions, invalid) = runner
        .discover_all("working-tree")
        .context("The working tree's projection definitions can't be read")?;
    let authored = crate::workspace::authored(&root);
    ensure!(
        authored,
        "This repository defines no projections yet. Create one with projections init <id>"
    );
    let mut broken: Vec<&Value> = invalid
        .iter()
        .filter(|failure| options.ids.is_empty() || options.ids.iter().any(|id| failure["id"] == id.as_str()))
        .collect();
    broken.dedup_by(|a, b| a["path"] == b["path"]);
    let selected = select(definitions, &invalid, &options.ids)?;
    ensure!(
        options.png.is_none() || selected.len() + broken.len() == 1,
        "--png writes one projection's image: select it with -p"
    );
    ensure!(
        options.from.is_none() || selected.len() + broken.len() == 1,
        "--from checks one projection's extraction: select it with -p"
    );
    let checker = Checker {
        runner,
        has_head: runner.resolve(&root, "HEAD").is_ok(),
        executable: options.render.then(|| browser::find(options.browser.as_deref())),
        root,
        options: &options,
    };
    let mut projections: Vec<Value> = broken.iter().map(|failure| invalid_entry(failure)).collect();
    for definition in &selected {
        projections.push(checker.projection(definition).await?);
    }
    let ok = projections.iter().all(|projection| projection["ok"] == true);
    Ok(json!({"format": "projections.check", "version": 0, "ok": ok, "projections": projections}))
}

/// The definitions `ids` selects (all when empty), leaving out invalid ones.
fn select(definitions: Vec<Value>, invalid: &[Value], ids: &[String]) -> Result<Vec<Value>> {
    if ids.is_empty() {
        return Ok(definitions);
    }
    ids.iter()
        .filter(|id| !invalid.iter().any(|failure| failure["id"] == id.as_str()))
        .map(|id| {
            definitions
                .iter()
                .find(|definition| definition["id"] == id.as_str())
                .cloned()
                .with_context(|| {
                    format!(
                        "The working tree defines no projection {id}; it defines {}",
                        definitions
                            .iter()
                            .filter_map(|definition| definition["id"].as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                })
        })
        .collect()
}

/// An invalid definition file's report entry: its definition step fails.
fn invalid_entry(failure: &Value) -> Value {
    let id = failure["id"].as_str().unwrap_or_default();
    let definition = step("definition", "Definition", "fail", crate::runtime::invalid_summary(failure));
    json!({
        "id": id, "title": id, "path": failure["path"], "ok": false, "steps": [definition],
        "diagnostics": failure["diagnostics"],
    })
}

#[cfg(test)]
mod tests;
