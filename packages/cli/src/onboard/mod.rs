//! Adopting explored projections: the end of the explore loop. Adopting writes
//! a candidate's definition to the repository (never over an existing file)
//! and bookmarks the changes it showed the most on. Each write is previewed
//! first: a preview's `digest` names the files' current contents, and a write
//! with a digest only happens when they still match. Adding the projections to
//! CI is the person's and their agent's decision (docs/setup/ci.md), so
//! nothing here writes a workflow.

pub mod bookmarks;

use crate::{artifact, json_text, runtime::read_regular};
use anyhow::{Context, Result, bail, ensure};
use bookmarks::{Highlight, bookmark_change};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::Path;

/// A file a write would change: its path, current content (`null` when absent) and new content.
struct Change {
    path: String,
    before: Option<String>,
    after: String,
}

impl Change {
    fn json(&self) -> Value {
        json!({"path": self.path, "before": self.before, "after": self.after,
            "created": self.before.is_none(), "changed": self.before.as_deref() != Some(&self.after)})
    }
}

fn current(root: &Path, path: &str) -> Result<Option<String>> {
    let file = root.join(path);
    match std::fs::symlink_metadata(&file) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
        Ok(_) => Ok(Some(
            String::from_utf8(read_regular(&file, 1024 * 1024)?).with_context(|| format!("{path} is not UTF-8"))?,
        )),
    }
}

/// The digest of the files' current contents, which a write must still find.
fn digest(changes: &[Change]) -> String {
    let mut hash = Sha256::new();
    for change in changes {
        hash.update(change.path.as_bytes());
        hash.update([0]);
        match &change.before {
            Some(before) => {
                hash.update([1]);
                hash.update(before.as_bytes());
            }
            None => hash.update([0]),
        }
        hash.update([0]);
    }
    format!("sha256:{:x}", hash.finalize())
}

/// Previews, or unless `dry_run` writes, the changes; with `expected`, only
/// when the files still hold what that preview's digest named.
fn apply(root: &Path, changes: Vec<Change>, expected: Option<&str>, dry_run: bool) -> Result<Value> {
    let current_digest = digest(&changes);
    let mut result = json!({
        "files": changes.iter().map(Change::json).collect::<Vec<_>>(),
        "digest": current_digest, "written": false,
    });
    if dry_run {
        return Ok(result);
    }
    if let Some(expected) = expected {
        ensure!(
            expected == current_digest,
            "The files changed since the preview; review the new difference first"
        );
    }
    for change in changes.iter().filter(|change| change.before.as_deref() != Some(&change.after)) {
        let path = root.join(&change.path);
        let directory = path.parent().context("A written file has no directory")?;
        std::fs::create_dir_all(directory)?;
        let mut file = tempfile::NamedTempFile::new_in(directory)?;
        std::io::Write::write_all(&mut file, change.after.as_bytes())?;
        if change.before.is_none() {
            // Never replace a file created since the check above.
            file.persist_noclobber(&path)
                .map_err(|error| error.error)
                .with_context(|| format!("{} already exists", change.path))?;
        } else {
            crate::replace::replace(file, &path)?;
        }
    }
    result["written"] = json!(true);
    Ok(result)
}

/// The precondition failure a write reports, for a `409` response.
pub fn is_conflict(error: &anyhow::Error) -> bool {
    error.to_string().contains("changed since the preview")
}

fn definition_text(definition: &Value) -> Result<String> {
    json_text::render(definition, None, &json_text::DEFINITION_ORDER)
}

/// Where adopted definitions go: the project's directory it already uses, else `.github/projections`.
fn definitions_directory(root: &Path) -> String {
    let [github, dot] = crate::project::directories();
    if !root.join(&github).is_dir() && root.join(&dot).is_dir() {
        dot
    } else {
        github
    }
}

/// Adopts `ids`, each a candidate explore proposes: writes its definition to
/// `<definitions>/<id>.json` and merges `highlights` into the bookmarks file.
/// Returns `{files: [{path, before, after, created, changed}], digest, written, adopted, bookmarked}`.
pub fn adopt(
    root: &Path,
    candidates: &[Value],
    ids: &[String],
    highlights: &[Highlight],
    expected: Option<&str>,
    dry_run: bool,
) -> Result<Value> {
    ensure!(!ids.is_empty(), "Name the projections to adopt");
    let directory = &definitions_directory(root);
    let mut changes = Vec::new();
    for id in ids {
        changes.push(definition_change(root, directory, candidates, id)?);
    }
    let (bookmarks, bookmarked) = if highlights.is_empty() {
        (None, Vec::new())
    } else {
        bookmark_change(root, highlights)?
    };
    changes.extend(bookmarks);
    let mut result = apply(root, changes, expected, dry_run)?;
    result["adopted"] = json!(ids);
    result["bookmarked"] = json!(bookmarked);
    Ok(result)
}

/// The new definition file for the candidate `id`, from its template.
fn definition_change(root: &Path, directory: &str, candidates: &[Value], id: &str) -> Result<Change> {
    let Some(candidate) = candidates.iter().find(|candidate| candidate["id"] == id) else {
        let proposed: Vec<&str> = candidates.iter().filter_map(|candidate| candidate["id"].as_str()).collect();
        bail!(
            "{id} is not a projection explore proposes for this repository{}",
            if proposed.is_empty() {
                String::new()
            } else {
                format!(" (it proposes {})", proposed.join(", "))
            }
        );
    };
    if let Some(adopted) = candidate["adopted"].as_str() {
        bail!("{id} is already adopted: the repository defines it as {adopted}");
    }
    let definition = artifact::validate_definition(&candidate["definition"]).with_context(|| format!("{id}'s template is invalid"))?;
    let path = format!("{directory}/{id}.json");
    ensure!(
        format!("{id}.json") != crate::environment::FILE,
        "{} is the environment file, not a definition",
        crate::environment::FILE
    );
    ensure!(
        current(root, &path)?.is_none(),
        "{path} already exists; adopting never replaces a file"
    );
    Ok(Change {
        path,
        before: None,
        after: definition_text(&definition)?,
    })
}

/// Previews or results as text: each file, and its new content when it is new or `contents`.
pub fn text(result: &Value, contents: bool) -> String {
    let mut text = String::new();
    let written = result["written"] == true;
    for file in result["files"].as_array().into_iter().flatten() {
        let path = file["path"].as_str().unwrap_or_default();
        let verb = match (written, file["created"] == true, file["changed"] == true) {
            (_, _, false) => "Unchanged",
            (true, true, _) => "Created",
            (true, false, _) => "Updated",
            (false, true, _) => "Would create",
            (false, false, _) => "Would update",
        };
        text.push_str(&format!("{verb} {path}\n"));
        if contents && file["changed"] == true {
            for line in file["after"].as_str().unwrap_or_default().lines() {
                text.push_str(&format!("    {line}\n"));
            }
        }
    }
    for bookmark in result["bookmarked"].as_array().into_iter().flatten() {
        text.push_str(&format!(
            "  bookmarked {} for {}: {}\n",
            bookmark["id"].as_str().unwrap_or_default(),
            bookmark["projection"].as_str().unwrap_or_default(),
            bookmark["change"]["title"].as_str().unwrap_or_default()
        ));
    }
    text
}

#[cfg(test)]
mod tests;
