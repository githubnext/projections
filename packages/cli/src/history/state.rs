//! Where the checkout stands, and the pair candidates that follow from it.

use super::WORKING_TREE;
use crate::runtime::Runner;
use serde_json::{Value, json};
use std::path::Path;

/// Where the checkout stands: its `HEAD`, whether the working tree has
/// changes, its branch, and the default branch it diverged from.
pub(super) struct State {
    pub head: Option<String>,
    pub dirty: bool,
    pub branch: Option<String>,
    pub default_branch: Option<String>,
    pub merge_base: Option<String>,
}

impl State {
    pub fn read(runner: &Runner, root: &Path) -> Self {
        let head = runner.resolve(root, "HEAD").ok();
        let dirty = runner
            .git(
                root,
                &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                None,
                16 * 1024 * 1024,
            )
            .map(|status| !status.is_empty())
            .unwrap_or(false);
        let branch = runner
            .git_text(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
            .ok()
            .map(|name| name.trim().to_owned());
        let default_branch = super::default_branch(runner, root);
        let merge_base = match (&branch, &default_branch, &head) {
            (Some(branch), Some(default), Some(_)) if branch != default => runner
                .git_text(root, &["merge-base", "HEAD", default])
                .ok()
                .map(|commit| commit.trim().to_owned()),
            _ => None,
        };
        Self {
            head,
            dirty,
            branch,
            default_branch,
            merge_base,
        }
    }

    /// Candidates, in the order the default is chosen from.
    pub fn candidates(&self, runner: &Runner, root: &Path, bookmarks: &[Value], projection: Option<&str>) -> Vec<Value> {
        let mut candidates: Vec<Value> = Vec::new();
        for bookmark in bookmarks {
            if projection.is_some_and(|id| bookmark["projectionId"] != id) {
                continue;
            }
            candidates.push(json!({
                "before": bookmark["before"], "after": bookmark["after"],
                "label": bookmark["title"], "source": "bookmark", "bookmark": bookmark["id"],
            }));
        }
        if let (Some(base), Some(branch), Some(default)) = (&self.merge_base, &self.branch, &self.default_branch) {
            candidates.push(json!({
                "before": base, "after": WORKING_TREE,
                "label": format!("{branch} since {default}"), "source": "merge-base",
            }));
        }
        if self.head.is_some() {
            self.head_candidates(runner, root, &mut candidates);
        }
        candidates
    }

    /// The candidates around `HEAD`: since the nearest tag, its parent, and
    /// uncommitted changes.
    fn head_candidates(&self, runner: &Runner, root: &Path, candidates: &mut Vec<Value>) {
        let dirty = self.dirty;
        let tag_at = |reference: &str| {
            runner
                .git_text(root, &["describe", "--tags", "--abbrev=0", "--end-of-options", reference])
                .ok()
                .map(|tag| tag.trim().to_owned())
        };
        // The nearest tag before HEAD; when HEAD is tagged, that tag is the after side.
        let at_head = runner
            .git_text(root, &["describe", "--tags", "--exact-match", "--end-of-options", "HEAD"])
            .ok()
            .map(|tag| tag.trim().to_owned());
        if let Some(previous) = tag_at("HEAD^") {
            let after = at_head.clone().unwrap_or_else(|| "HEAD".to_owned());
            if previous != after {
                candidates.push(json!({
                    "before": previous, "after": after,
                    "label": format!("{previous} → {after}"), "source": "tag",
                }));
            }
        }
        if runner.resolve(root, "HEAD~1").is_ok() {
            candidates.push(json!({"before": "HEAD~1", "after": "HEAD", "label": "HEAD~1 → HEAD", "source": "parent"}));
        }
        if dirty {
            candidates.push(json!({
                "before": "HEAD", "after": WORKING_TREE,
                "label": "Your uncommitted changes", "source": "working-tree",
            }));
        }
    }
}
