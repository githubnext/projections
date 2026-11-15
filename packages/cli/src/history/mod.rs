//! The Before → After pairs a repository suggests for the Inspector: its
//! bookmarks, the merge base with its default branch, its tags and branches,
//! and the default pair it opens on. Everything comes from Git and the
//! working tree's `.projections-bookmarks.json`; nothing is extracted.
//!
//! A candidate whose two sides have the same Git tree (or a clean working
//! tree beside the commit it is based on) is marked `identical`: every
//! extractor sees the same files on both sides, so the comparison is empty.
//! Sides that differ only in files an extractor ignores aren't detected:
//! knowing that would mean running the extractor, which is repository code
//! (it needs trust and can take seconds), so the default is chosen without it.

mod state;
mod suggestions;

use crate::runtime::Runner;
use anyhow::Result;
use serde_json::{Value, json};
use state::State;
use std::path::Path;
use suggestions::{default_pair, suggestions};

const WORKING_TREE: &str = "working-tree";
const TAGS: &str = "20";
const BRANCHES: &str = "30";

/// One line per ref: name, object, peeled object (tags), ISO date.
fn refs(runner: &Runner, root: &Path, pattern: &str, sort: &str, count: &str, date: &str) -> Vec<Value> {
    let format = format!("%(refname:short)%09%(objectname)%09%(*objectname)%09%({date}:iso-strict)");
    let count = format!("--count={count}");
    let sort = format!("--sort={sort}");
    let format = format!("--format={format}");
    let Ok(text) = runner.git_text(root, &["for-each-ref", &sort, &count, &format, pattern]) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let (name, object, peeled, date) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
            let commit = if peeled.is_empty() { object } else { peeled };
            Some(json!({"name": name, "commit": commit, "date": date}))
        })
        .collect()
}

/// The repository's default branch: `origin/HEAD`'s, else `main` or `master`.
pub fn default_branch(runner: &Runner, root: &Path) -> Option<String> {
    if let Ok(remote) = runner.git_text(root, &["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]) {
        let remote = remote.trim();
        let local = remote.strip_prefix("origin/").unwrap_or(remote);
        if runner.resolve(root, local).is_ok() {
            return Some(local.to_owned());
        }
        if !remote.is_empty() && runner.resolve(root, remote).is_ok() {
            return Some(remote.to_owned());
        }
    }
    ["main", "master"]
        .into_iter()
        .find(|name| runner.resolve(root, &format!("refs/heads/{name}")).is_ok())
        .map(str::to_owned)
}

/// The repository's pair candidates for `projection` (bookmarks for other
/// projections are listed but never suggested), and the default pair.
pub fn pairs(runner: &Runner, projection: Option<&str>) -> Result<Value> {
    let root = runner.repository_root()?;
    let state = State::read(runner, &root);
    let (bookmarks, bookmarks_error) = match runner.bookmarks(WORKING_TREE) {
        Ok(document) => (document["bookmarks"].as_array().cloned().unwrap_or_default(), None),
        Err(error) => (Vec::new(), Some(format!("{error:#}"))),
    };
    let tags = refs(runner, &root, "refs/tags", "-creatordate", TAGS, "creatordate");
    let mut branches = refs(runner, &root, "refs/heads", "-committerdate", BRANCHES, "committerdate");
    for item in &mut branches {
        item["current"] = json!(state.branch.as_deref() == item["name"].as_str());
    }
    let candidates = state.candidates(runner, &root, &bookmarks, projection);
    let suggestions = suggestions(runner, &root, state.dirty, candidates);
    let default = default_pair(&suggestions, state.head.is_some());
    let State {
        head,
        dirty,
        branch,
        default_branch,
        merge_base,
    } = state;
    let mut response = json!({
        "head": {"commit": head, "branch": branch, "dirty": dirty},
        "defaultBranch": default_branch, "mergeBase": merge_base,
        "bookmarks": bookmarks, "tags": tags, "branches": branches,
        "suggestions": suggestions, "default": default,
    });
    if let Some(error) = bookmarks_error {
        response["bookmarksError"] = json!(error);
    }
    Ok(response)
}
