//! Leasing persistent workspaces: a locked slot per run, its checkout created
//! for the strategy (a worktree, a copy-on-write seeded clone, or a sparse
//! worktree) when missing or broken, then switched to the commit; and listing
//! and cleaning a repository's workspaces.

use super::{SLOTS, Strategy, clone_file, directory};
use crate::runtime::Runner;
use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

/// A workspace leased to one run: its checkout holds the commit, and it is
/// locked until dropped.
#[derive(Debug)]
pub struct Lease {
    pub strategy: Strategy,
    /// The checkout holding the commit.
    pub root: PathBuf,
    /// Where its prepare runs are recorded.
    pub records: crate::environment::Records,
    /// Notes for provenance, such as a fallback.
    pub notes: Vec<String>,
    _lock: fs::File,
}

/// Leases a persistent workspace of `strategy` (worktree, clone or sparse),
/// switched to `commit`. `scope` limits a sparse one.
pub fn lease(runner: &Runner, commit: &str, strategy: Strategy, scope: Option<&[String]>) -> Result<Lease> {
    let mut notes = Vec::new();
    let root = runner.repository_root()?;
    let mut strategy = strategy;
    if strategy == Strategy::Sparse && scope.is_none() {
        notes.push("The sparse workspace strategy needs a declared scope; this projection has none, so a full worktree was used.".into());
        strategy = Strategy::Worktree;
    }
    let base = directory(runner)?;
    crate::cache::private_directory(&base)?;
    let (home, lock) = slot(&base, &family(strategy, scope))?;
    let checkout = home.join("checkout");
    if !healthy(runner, &checkout) {
        create(runner, &root, &checkout, strategy, scope, commit, &mut notes)?;
    }
    // Only changed files are rewritten; ignored files (prepared dependencies,
    // build caches) stay, untracked ones are removed.
    runner.git(
        &checkout,
        &["checkout", "--quiet", "--detach", "--force", commit],
        None,
        1024 * 1024,
    )?;
    runner.git(&checkout, &["clean", "-ffdq"], None, 1024 * 1024)?;
    fs::write(
        home.join("state.json"),
        crate::json_text::pretty(&json!({"strategy": strategy.as_str(), "commit": commit,
            "at": crate::runtime::utc_now(), "scope": scope}))?,
    )?;
    Ok(Lease {
        strategy,
        root: projections_extractor_sdk::canonical(&checkout)?,
        records: crate::environment::Records::new(home.join("records")),
        notes,
        _lock: lock,
    })
}

/// The slots' name: the strategy, a sparse one per scope.
fn family(strategy: Strategy, scope: Option<&[String]>) -> String {
    match (strategy, scope) {
        (Strategy::Sparse, Some(scope)) => {
            use sha2::Digest;
            let digest = sha2::Sha256::digest(scope.join("\n").as_bytes());
            format!("sparse-{}", &format!("{digest:x}")[..12])
        }
        _ => strategy.as_str().to_owned(),
    }
}

/// The first free slot of `family`, locked, else the first once it frees.
fn slot(base: &Path, family: &str) -> Result<(PathBuf, fs::File)> {
    for slot in 0..SLOTS {
        let home = base.join(format!("{family}-{slot}"));
        crate::cache::private_directory(&home)?;
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(home.join("lock"))?;
        if lock.try_lock().is_ok() {
            return Ok((home, lock));
        }
    }
    let home = base.join(format!("{family}-0"));
    let lock = fs::OpenOptions::new().write(true).open(home.join("lock"))?;
    lock.lock()?;
    Ok((home, lock))
}

/// Whether `checkout` is a working linked worktree.
fn healthy(runner: &Runner, checkout: &Path) -> bool {
    checkout.join(".git").is_file()
        && runner
            .git_text(checkout, &["rev-parse", "--is-inside-work-tree"])
            .is_ok_and(|inside| inside == "true")
}

/// Creates the slot's checkout afresh for `strategy`, noting a fallback.
fn create(
    runner: &Runner,
    root: &Path,
    checkout: &Path,
    strategy: Strategy,
    scope: Option<&[String]>,
    commit: &str,
    notes: &mut Vec<String>,
) -> Result<()> {
    if checkout.exists() {
        fs::remove_dir_all(checkout)?;
    }
    runner.git(root, &["worktree", "prune"], None, 1024 * 1024)?;
    let path = checkout.to_str().context("Non-UTF-8 workspace path")?;
    match strategy {
        Strategy::Clone => {
            let head = runner.resolve(root, "HEAD")?;
            runner.git(
                root,
                &["worktree", "add", "--no-checkout", "--detach", "--force", path, &head],
                None,
                1024 * 1024,
            )?;
            if let Err(error) = seed(runner, root, checkout) {
                notes.push(format!(
                    "The checkout couldn't be cloned copy-on-write ({error:#}), so a plain worktree was used."
                ));
                fs::remove_dir_all(checkout).ok();
                runner.git(root, &["worktree", "prune"], None, 1024 * 1024)?;
                worktree(runner, root, path, commit)?;
            }
        }
        Strategy::Sparse => {
            runner.git(
                root,
                &["worktree", "add", "--no-checkout", "--detach", "--force", path, commit],
                None,
                1024 * 1024,
            )?;
            let mut arguments = vec!["sparse-checkout", "set", "--no-cone"];
            let patterns: Vec<String> = scope.unwrap_or_default().iter().map(|path| format!("/{path}")).collect();
            arguments.extend(patterns.iter().map(String::as_str));
            runner.git(checkout, &arguments, None, 1024 * 1024)?;
        }
        _ => worktree(runner, root, path, commit)?,
    }
    Ok(())
}

/// Adds a plain linked worktree at `path`, checked out at `commit`.
fn worktree(runner: &Runner, root: &Path, path: &str, commit: &str) -> Result<()> {
    runner.git(root, &["worktree", "add", "--detach", "--force", path, commit], None, 1024 * 1024)?;
    Ok(())
}

/// Seeds a no-checkout worktree with a copy-on-write clone of the checkout's files.
fn seed(runner: &Runner, root: &Path, checkout: &Path) -> Result<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_name() == ".git" {
            continue;
        }
        clone_file(&entry.path(), &checkout.join(entry.file_name()))?;
    }
    // The clone's files are the checkout's; Git rehashes them once.
    runner.git(checkout, &["read-tree", "HEAD"], None, 1024 * 1024)?;
    runner.git(checkout, &["update-index", "-q", "--refresh"], None, 1024 * 1024).ok();
    Ok(())
}

/// This repository's workspaces: `[{"name", "strategy", "commit", "at", "path", "busy", "prepared"}]`.
pub fn list(runner: &Runner) -> Result<Vec<Value>> {
    let base = directory(runner)?;
    let mut workspaces = Vec::new();
    for entry in fs::read_dir(&base).into_iter().flatten().flatten() {
        let home = entry.path();
        if !home.join("lock").exists() {
            continue;
        }
        let state: Value = fs::read(home.join("state.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(Value::Null);
        let busy = fs::OpenOptions::new()
            .write(true)
            .open(home.join("lock"))
            .is_ok_and(|lock| lock.try_lock().is_err());
        let records = crate::environment::Records::new(home.join("records")).load();
        let prepared: Vec<Value> = records["steps"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(id, record)| json!({"id": id, "status": record["status"], "at": record["at"]}))
            .collect();
        workspaces.push(json!({"name": entry.file_name().to_string_lossy(),
            "strategy": state["strategy"], "commit": state["commit"], "at": state["at"],
            "scope": state["scope"], "path": home.join("checkout"), "busy": busy, "prepared": prepared}));
    }
    workspaces.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(workspaces)
}

/// Removes this repository's workspaces that no run is using, returning their
/// names; busy ones are kept.
pub fn clean(runner: &Runner) -> Result<Vec<String>> {
    let root = runner.repository_root()?;
    let base = directory(runner)?;
    let mut removed = Vec::new();
    for entry in fs::read_dir(&base).into_iter().flatten().flatten() {
        let home = entry.path();
        if !home.join("lock").exists() {
            continue;
        }
        let Ok(lock) = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(home.join("lock"))
        else {
            continue;
        };
        if lock.try_lock().is_err() {
            continue;
        }
        let checkout = home.join("checkout");
        if checkout.exists()
            && let Some(path) = checkout.to_str()
        {
            let _ = runner.git(&root, &["worktree", "remove", "--force", path], None, 1024 * 1024);
        }
        drop(lock);
        fs::remove_dir_all(&home).with_context(|| format!("Cannot remove the workspace {}", home.display()))?;
        removed.push(entry.file_name().to_string_lossy().into_owned());
    }
    runner.git(&root, &["worktree", "prune"], None, 1024 * 1024)?;
    removed.sort();
    Ok(removed)
}
