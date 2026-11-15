//! History sweeps: each projection across the repository's recent changes, so
//! people can see which projections show something on the changes this
//! repository actually makes before adopting any.
//!
//! The changes are the last merges into the current branch (each first-parent
//! merge compared with its first parent) when merges are how it takes changes,
//! or, in repositories that squash or rebase (even with a few old merges), the
//! last first-parent commits. Every
//! revision is extracted with the working tree's definition, so a sweep tests
//! the projection being tuned. Extractions are cached by the definition's
//! digest and the revision's Git tree, each revision is materialized once for
//! every projection, and at most [`DEFAULT_CONCURRENCY`] extractor processes
//! run at once.

use crate::runtime::Runner;
use anyhow::Result;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};

mod run;

pub use run::run;

/// Changes swept by default.
pub const DEFAULT_LAST: usize = 20;
/// Changes swept at most.
pub const MAX_LAST: usize = 100;
/// Extractor processes running at once, by default.
pub const DEFAULT_CONCURRENCY: usize = 2;
/// Cached extractions kept at most; the oldest are dropped first.
const MAX_CACHED: usize = 2000;

/// One change to sweep: a revision compared with the one before it.
#[derive(Clone, Debug)]
pub struct Change {
    pub before: String,
    pub after: String,
    pub title: String,
    /// The pull request number its message names (`#123`), if any.
    pub number: Option<u64>,
    /// `merge` (a merge commit) or `commit`.
    pub kind: &'static str,
    pub date: String,
}

impl Change {
    pub fn json(&self) -> Value {
        json!({"before": self.before, "after": self.after, "title": self.title,
            "number": self.number, "kind": self.kind, "date": self.date})
    }

    /// How a change reads: `#123`, else the short commit.
    pub fn label(&self) -> String {
        self.number
            .map_or_else(|| self.after[..self.after.len().min(8)].to_owned(), |number| format!("#{number}"))
    }
}

fn number(subject: &str) -> Option<u64> {
    let start = subject.find('#')? + 1;
    let digits: String = subject[start..].chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// A change's title: a merged pull request's own title (the merge commit body's first line), else the subject.
fn title(subject: &str, body: &str) -> String {
    let first = body.lines().map(str::trim).find(|line| !line.is_empty());
    match first {
        Some(line) if subject.starts_with("Merge pull request #") || subject.starts_with("Merge branch ") => line.to_owned(),
        _ => subject.to_owned(),
    }
}

/// The last `last` changes into `HEAD`. They are the first-parent merges when
/// merges are how this branch takes changes: at least half of its last `last`
/// first-parent commits. Otherwise (a repository that squashes or rebases,
/// perhaps with a few old merges) they are the last first-parent commits
/// themselves, merges included.
pub fn changes(runner: &Runner, root: &Path, last: usize) -> Result<Vec<Change>> {
    let last = last.clamp(1, MAX_LAST);
    let count = last.to_string();
    let log = |merges: bool| -> Result<Vec<Change>> {
        let mut args = vec![
            "log",
            "-z",
            "--first-parent",
            "--max-count",
            &count,
            "--format=%H%x09%P%x09%cI%x09%s%x09%b",
        ];
        if merges {
            args.push("--merges");
        }
        args.push("HEAD");
        Ok(runner
            .git_text(root, &args)?
            .split('\0')
            .filter_map(|record| {
                let mut parts = record.trim_start_matches('\n').splitn(5, '\t');
                let (commit, parents, date, subject) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
                let body = parts.next().unwrap_or_default();
                let mut parents = parents.split(' ').filter(|parent| !parent.is_empty());
                let parent = parents.next()?;
                let merge = parents.next().is_some();
                Some(Change {
                    before: parent.to_owned(),
                    after: commit.to_owned(),
                    title: title(subject, body),
                    number: number(subject),
                    kind: if merge { "merge" } else { "commit" },
                    date: date.to_owned(),
                })
            })
            .collect())
    };
    let recent = log(false)?;
    if merges_dominate(&recent) {
        return log(true);
    }
    Ok(recent)
}

/// Whether merges are at least half of a branch's recent first-parent commits.
fn merges_dominate(recent: &[Change]) -> bool {
    let merges = recent.iter().filter(|change| change.kind == "merge").count();
    merges > 0 && merges * 2 >= recent.len()
}

/// The projections a sweep tries by default: in a repository that defines its
/// own, those plus the candidates; otherwise just the candidates.
pub fn projections(runner: &Runner, candidates: &[Value]) -> Result<Vec<String>> {
    let root = runner.repository_root()?;
    let authored = crate::workspace::authored(&root);
    Ok(runner
        .discover("working-tree")?
        .into_iter()
        .filter(|definition| authored || candidates.iter().any(|candidate| candidate["id"] == definition["id"]))
        .filter_map(|definition| definition["id"].as_str().map(str::to_owned))
        .collect())
}

/// Extractions by definition digest and Git tree, shared by sweeps.
#[derive(Default)]
pub struct Cache {
    entries: Mutex<Entries>,
}

#[derive(Default)]
struct Entries {
    values: HashMap<String, Arc<Value>>,
    /// Keys, oldest first.
    order: std::collections::VecDeque<String>,
}

impl Cache {
    fn get(&self, key: &str) -> Option<Arc<Value>> {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .values
            .get(key)
            .cloned()
    }

    fn insert(&self, key: String, value: Arc<Value>) {
        self.insert_bounded(key, value, MAX_CACHED);
    }

    fn insert_bounded(&self, key: String, value: Arc<Value>, limit: usize) {
        let mut entries = self.entries.lock().unwrap_or_else(|error| error.into_inner());
        if entries.values.insert(key.clone(), value).is_none() {
            entries.order.push_back(key);
        }
        while entries.order.len() > limit {
            if let Some(oldest) = entries.order.pop_front() {
                entries.values.remove(&oldest);
            }
        }
    }
}

/// A sweep's request.
pub struct Request<'a> {
    /// Projections the working tree defines (trials included).
    pub projections: Vec<String>,
    pub changes: Vec<Change>,
    pub cache: &'a Cache,
    pub concurrency: usize,
}

/// A finished cell: one projection on one change.
pub struct Cell {
    pub value: Value,
    /// The comparison, when the projection changed.
    pub comparison: Option<Arc<Value>>,
}

/// A sweep's results as text: per projection, the changes it showed something on.
pub fn text(changes: &[Change], rows: &[Value], cells: &[Value]) -> String {
    let mut text = format!(
        "Swept {} recent change{}:\n",
        changes.len(),
        if changes.len() == 1 { "" } else { "s" }
    );
    for row in rows {
        let id = row["projection"].as_str().unwrap_or_default();
        if row["status"] != "ready" {
            text.push_str(&format!("  {id}: skipped. {}\n", row["error"].as_str().unwrap_or_default()));
            continue;
        }
        let mine: Vec<&Value> = cells.iter().filter(|cell| cell["projection"] == id).collect();
        let changed: Vec<String> = changes
            .iter()
            .filter_map(|change| {
                let cell = mine.iter().find(|cell| cell["after"] == change.after.as_str())?;
                (cell["status"] == "changed").then(|| {
                    format!(
                        "{} ({} change{}, {} step{})",
                        change.label(),
                        cell["changes"],
                        if cell["changes"] == 1 { "" } else { "s" },
                        cell["steps"],
                        if cell["steps"] == 1 { "" } else { "s" }
                    )
                })
            })
            .collect();
        let failed = mine.iter().filter(|cell| cell["status"] == "failed").count();
        text.push_str(&format!(
            "  {id}: changed in {} of {}{}{}\n",
            changed.len(),
            changes.len(),
            if changed.is_empty() {
                String::new()
            } else {
                format!(": {}", changed.join(", "))
            },
            if failed > 0 {
                format!("; failed on {failed}")
            } else {
                String::new()
            },
        ));
        if let Some(error) = mine
            .iter()
            .find(|cell| cell["status"] == "failed")
            .and_then(|cell| cell["error"].as_str())
        {
            text.push_str(&format!("    first failure: {error}\n"));
            let stderr = mine
                .iter()
                .find(|cell| cell["status"] == "failed")
                .and_then(|cell| cell["stderr"].as_str());
            for line in stderr.into_iter().flat_map(|stderr| last_lines(stderr, 5)) {
                text.push_str(&format!("      {line}\n"));
            }
        }
    }
    text
}

/// The last `count` lines of `text`.
fn last_lines(text: &str, count: usize) -> impl Iterator<Item = &str> {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(count);
    lines.into_iter().skip(start)
}

#[cfg(test)]
mod tests;
