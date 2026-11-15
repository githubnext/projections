//! Which candidates are worth offering, and the pair to open on: candidates
//! are compared by their sides' Git trees and ancestry.

use super::WORKING_TREE;
use crate::runtime::Runner;
use serde_json::{Value, json};
use std::path::Path;

/// A side's tree, to tell whether two sides hold the same files: the working
/// tree only when it is clean (then it is `HEAD`'s).
fn tree(runner: &Runner, root: &Path, reference: &str, dirty: bool) -> Option<String> {
    let reference = if reference == WORKING_TREE {
        if dirty {
            return None;
        }
        "HEAD"
    } else {
        reference
    };
    runner
        .git_text(
            root,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                "--end-of-options",
                &format!("{reference}^{{tree}}"),
            ],
        )
        .ok()
        .map(|tree| tree.trim().to_owned())
}

/// Whether a pair runs backwards: After is an ancestor of Before (it is older in Before's history), or Before is the
/// working tree and After a commit. Sides on diverged branches are neither.
fn backwards(runner: &Runner, root: &Path, before: &str, after: &str) -> bool {
    if before.is_empty() || before == after || after == WORKING_TREE {
        return false;
    }
    if before == WORKING_TREE {
        return true;
    }
    let (Ok(before), Ok(after)) = (runner.resolve(root, before), runner.resolve(root, after)) else {
        return false;
    };
    before != after
        && runner
            .git_text(root, &["merge-base", "--is-ancestor", "--end-of-options", &after, &before])
            .is_ok()
}

/// The candidates worth offering, each marked `identical`, `backwards` or
/// with an `error`, without duplicates.
pub(super) fn suggestions(runner: &Runner, root: &Path, dirty: bool, candidates: Vec<Value>) -> Vec<Value> {
    let mut suggestions = Vec::new();
    for mut candidate in candidates {
        let before = candidate["before"].as_str().unwrap_or_default().to_owned();
        let after = candidate["after"].as_str().unwrap_or_default().to_owned();
        let trees = (tree(runner, root, &before, dirty), tree(runner, root, &after, dirty));
        let resolves = |reference: &str| reference == WORKING_TREE || runner.resolve(root, reference).is_ok();
        if !resolves(&before) || !resolves(&after) {
            candidate["error"] = json!(format!(
                "{} doesn't name a revision here",
                if resolves(&before) { &after } else { &before }
            ));
        }
        let identical = matches!(&trees, (Some(a), Some(b)) if a == b);
        candidate["identical"] = json!(identical);
        if backwards(runner, root, &before, &after) {
            candidate["backwards"] = json!(true);
        }
        // Bookmarks are always listed; other identical candidates aren't worth offering.
        if identical && candidate["source"] != "bookmark" {
            continue;
        }
        if !suggestions
            .iter()
            .any(|item: &Value| item["before"] == candidate["before"] && item["after"] == candidate["after"])
        {
            suggestions.push(candidate);
        }
    }
    suggestions
}

/// The pair to open on: the first suggestion that differs, resolves and runs
/// forwards. The default never runs backwards (After older than Before), even
/// when a bookmark does.
pub(super) fn default_pair(suggestions: &[Value], head: bool) -> Value {
    suggestions
        .iter()
        .find(|item| item["identical"] == false && item.get("error").is_none() && item.get("backwards").is_none())
        .cloned()
        .unwrap_or_else(|| {
            if head {
                json!({"after": "HEAD", "label": "HEAD", "source": "head"})
            } else {
                json!({"after": WORKING_TREE, "label": "Working tree", "source": "working-tree"})
            }
        })
}
