//! Plain-text renderings of extractions and comparisons. They read in order
//! without color, layout or symbols, so they work in any terminal and with
//! screen readers.

pub mod labels;

use crate::runtime::short;
use labels::{Labels, describe};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fmt::Write;

fn items(extraction: &Value, collection: &str) -> Vec<Value> {
    extraction[collection].as_array().cloned().unwrap_or_default()
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

fn plural(count: usize, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

/// Describes a saved extraction's revision, such as "commit 1a2b3c4d5e6f".
pub fn revision(document: &Value) -> String {
    let revision = &document["provenance"]["revision"];
    let commit = short(text(&revision["commit"]));
    if revision["kind"] == "working-tree" {
        if revision["dirty"] == true {
            format!("the working tree (uncommitted changes on {commit})")
        } else {
            format!("the working tree (no changes from {commit})")
        }
    } else {
        format!("commit {commit}")
    }
}

pub(crate) fn heading(document: &Value) -> String {
    let projection = &document["projection"];
    let title = text(&projection["title"]);
    let id = text(&projection["id"]);
    if title == id {
        format!("Projection {id}")
    } else {
        format!("{title} (projection {id})")
    }
}

/// Entities grouped by kind, each followed by its outgoing relationships.
pub fn extraction(document: &Value) -> String {
    let extraction = &document["extraction"];
    let entities = items(extraction, "entities");
    let relationships = items(extraction, "relationships");
    let labels = Labels::new(extraction);
    let mut out = String::new();
    let _ = writeln!(out, "{}", heading(document));
    match document["provenance"]["limitations"][0]
        .as_str()
        .filter(|limitation| limitation.starts_with("Supplied as extractor output"))
    {
        Some(limitation) => {
            let _ = writeln!(out, "{limitation}");
        }
        None => {
            let _ = writeln!(out, "Showing {}.", revision(document));
        }
    }
    let _ = writeln!(
        out,
        "{}, {} ({}).",
        plural(entities.len(), "entity", "entities"),
        plural(relationships.len(), "relationship", "relationships"),
        text(&extraction["schema"])
    );
    if let Some(notice) = crate::artifact::missing_input_notice(document) {
        let _ = writeln!(out, "Note: {notice}");
    }
    let mut outgoing: HashMap<&str, Vec<&Value>> = HashMap::new();
    for relationship in &relationships {
        outgoing.entry(text(&relationship["from"])).or_default().push(relationship);
    }
    let mut kinds: BTreeMap<&str, Vec<&Value>> = BTreeMap::new();
    for entity in &entities {
        kinds.entry(text(&entity["kind"])).or_default().push(entity);
    }
    for (kind, members) in kinds {
        let _ = writeln!(out, "\n{kind} ({}):", members.len());
        for entity in members {
            let id = text(&entity["id"]);
            let _ = writeln!(out, "  {}", labels.entity(id));
            for relationship in outgoing.remove(id).unwrap_or_default() {
                let name = relationship["label"].as_str().unwrap_or_else(|| text(&relationship["kind"]));
                let _ = writeln!(out, "    {name} {}", labels.entity(text(&relationship["to"])));
            }
        }
    }
    let mut rest: Vec<&Value> = outgoing.into_values().flatten().collect();
    if !rest.is_empty() {
        rest.sort_by_key(|relationship| text(&relationship["id"]).to_owned());
        let _ = writeln!(out, "\nOther relationships ({}):", rest.len());
        for relationship in rest {
            let _ = writeln!(out, "  {}", labels.relationship(relationship));
        }
    }
    if entities.is_empty() && relationships.is_empty() {
        let _ = writeln!(out, "\nThe extraction is empty.");
    }
    out
}

/// Steps in presentation order, each with its changes and summaries.
pub fn comparison(document: &Value, notices: &[String]) -> String {
    let (before, after) = (&document["before"], &document["after"]);
    let comparison = &document["comparison"];
    let changes = comparison["changes"].as_array().cloned().unwrap_or_default();
    let steps = comparison["steps"].as_array().cloned().unwrap_or_default();
    let mut out = String::new();
    let _ = writeln!(out, "{}", heading(before));
    let _ = writeln!(out, "Comparing {} with {}.", revision(before), revision(after));
    let comparator = &document["comparator"];
    let _ = writeln!(
        out,
        "Comparator: {}. Definition: {}.",
        text(&comparator["id"]),
        text(&before["provenance"]["definitionDigest"])
    );
    for notice in notices {
        let _ = writeln!(out, "Note: {notice}");
    }
    if changes.is_empty() {
        let _ = writeln!(out, "\nNo changes.");
        return out;
    }
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for change in &changes {
        *counts.entry(text(&change["status"])).or_default() += 1;
    }
    let summary = ["added", "removed", "modified", "unchanged"]
        .iter()
        .filter_map(|status| {
            counts.get(status).map(|count| {
                if *status == "unchanged" {
                    format!("{count} renamed without other changes")
                } else {
                    format!("{count} {status}")
                }
            })
        })
        .collect::<Vec<_>>()
        .join(", ");
    let _ = writeln!(
        out,
        "{} in {}: {summary}.",
        plural(changes.len(), "change", "changes"),
        plural(steps.len(), "step", "steps")
    );
    let by_id: HashMap<&str, &Value> = changes.iter().map(|change| (text(&change["id"]), change)).collect();
    for (index, step) in steps.iter().enumerate() {
        let mut title = format!("\nStep {} of {}", index + 1, steps.len());
        if let Some(kind) = step["kind"].as_str() {
            let _ = write!(title, " ({kind})");
        }
        if let Some(summary) = step["summary"].as_str() {
            let _ = write!(title, ": {summary}");
        }
        let _ = writeln!(out, "{title}");
        for id in step["changes"].as_array().into_iter().flatten() {
            if let Some(change) = by_id.get(text(id)) {
                let _ = writeln!(out, "  {}", describe(change, &before["extraction"], &after["extraction"]));
            }
        }
    }
    out
}

/// Each result of a batch, separated by headings.
pub fn batch(document: &Value) -> String {
    let mut out = String::new();
    let results = document["results"].as_array().cloned().unwrap_or_default();
    for (index, result) in results.iter().enumerate() {
        if index > 0 {
            out.push('\n');
        }
        let _ = writeln!(out, "== {} ==", text(&result["id"]));
        let notices: Vec<String> = result["notices"]
            .as_array()
            .map(|values| values.iter().map(|value| text(value).to_owned()).collect())
            .unwrap_or_default();
        if result["status"] == "error" {
            for diagnostic in result["diagnostics"].as_array().into_iter().flatten() {
                let _ = writeln!(out, "Error: {}", text(&diagnostic["message"]));
            }
        } else if let Some(document) = result.get("comparison") {
            out.push_str(&comparison(document, &notices));
        } else if let Some(document) = result.get("extraction") {
            for notice in &notices {
                let _ = writeln!(out, "Note: {notice}");
            }
            out.push_str(&extraction(document));
        }
    }
    let failed = document["failed"].as_u64().unwrap_or_default();
    let _ = writeln!(
        out,
        "\n{} of {} succeeded.",
        results.len() as u64 - failed,
        plural(results.len(), "projection", "projections")
    );
    out
}
