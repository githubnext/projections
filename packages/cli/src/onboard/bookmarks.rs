//! The bookmarks adopting adds: the changes a sweep showed a projection's
//! most-changed cells on, merged into the repository's bookmarks file.

use super::{Change, current};
use crate::{artifact, json_text, sweep};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::path::Path;

pub(super) use crate::project::BOOKMARKS;
/// Bookmarks a file holds at most.
const MAX_BOOKMARKS: usize = 100;

/// A change worth bookmarking for a projection.
#[derive(Clone, Debug)]
pub struct Highlight {
    pub projection: String,
    pub change: sweep::Change,
    pub changes: u64,
}

/// A projection's most-changed swept changes, most first, at most `count`.
pub fn highlights(projection: &str, changes: &[sweep::Change], cells: &[Value], count: usize) -> Vec<Highlight> {
    let mut found: Vec<Highlight> = cells
        .iter()
        .filter(|cell| cell["projection"] == projection && cell["status"] == "changed")
        .filter_map(|cell| {
            let change = changes
                .iter()
                .find(|change| cell["after"] == change.after.as_str() && cell["before"] == change.before.as_str())?;
            Some(Highlight {
                projection: projection.to_owned(),
                change: change.clone(),
                changes: cell["changes"].as_u64().unwrap_or(0),
            })
        })
        .collect();
    // Stable: equal counts keep the newest first.
    found.sort_by_key(|highlight| std::cmp::Reverse(highlight.changes));
    found.truncate(count);
    found
}

pub(super) fn bookmark_id(highlight: &Highlight) -> String {
    let label = highlight
        .change
        .number
        .map_or_else(|| highlight.change.after.chars().take(8).collect(), |number| format!("pr-{number}"));
    let mut id = format!("{}-{label}", highlight.projection);
    id.truncate(100);
    id
}

/// The bookmarks file's text, laid out like its current text when there is one.
fn bookmarks_text(file: &Value, before: Option<&str>) -> Result<String> {
    json_text::render(
        file,
        before,
        &["format", "version", "bookmarks", "id", "title", "projectionId", "before", "after"],
    )
}

/// The bookmarks file with `highlights` merged in (none that duplicate a
/// bookmark, and at most the file's limit), and the bookmarks added.
pub(super) fn bookmark_change(root: &Path, highlights: &[Highlight]) -> Result<(Option<Change>, Vec<Value>)> {
    let mut bookmarked = Vec::new();
    let bookmarks = crate::project::path(BOOKMARKS);
    let before = current(root, &bookmarks)?;
    let mut file = match &before {
        Some(text) => artifact::parse(text).with_context(|| format!("{BOOKMARKS} is not valid JSON"))?,
        None => json!({"format": "projections.bookmarks", "version": 0, "bookmarks": []}),
    };
    ensure!(
        file["format"] == "projections.bookmarks" && file["version"] == 0,
        "{BOOKMARKS} is not a version 0 bookmarks file"
    );
    let list = file["bookmarks"]
        .as_array_mut()
        .with_context(|| format!("{BOOKMARKS} has no bookmarks array"))?;
    for highlight in highlights {
        let id = bookmark_id(highlight);
        let duplicate = list.iter().any(|bookmark| {
            bookmark["id"] == id.as_str()
                || (bookmark["projectionId"] == highlight.projection.as_str()
                    && bookmark["before"] == highlight.change.before.as_str()
                    && bookmark["after"] == highlight.change.after.as_str())
        });
        if duplicate || list.len() >= MAX_BOOKMARKS {
            continue;
        }
        let title = match highlight.change.number {
            Some(number) => format!("#{number} {}", highlight.change.title),
            None => highlight.change.title.clone(),
        };
        list.push(
            json!({"id": id, "title": title.chars().take(200).collect::<String>(), "projectionId": highlight.projection,
            "before": highlight.change.before, "after": highlight.change.after}),
        );
        bookmarked.push(json!({"id": id, "projection": highlight.projection, "change": highlight.change.json()}));
    }
    let change = if bookmarked.is_empty() {
        None
    } else {
        let after = bookmarks_text(&file, before.as_deref())?;
        Some(Change {
            path: bookmarks,
            before,
            after,
        })
    };
    Ok((change, bookmarked))
}
