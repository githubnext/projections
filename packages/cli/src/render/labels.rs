//! How entities, relationships and changes read: by label, with the ID when
//! it differs.

use super::{items, text};
use serde_json::Value;
use std::collections::HashMap;
use std::fmt::Write;

pub(super) struct Labels(HashMap<String, String>);

impl Labels {
    pub fn new(extraction: &Value) -> Self {
        let mut labels = HashMap::new();
        for entity in items(extraction, "entities") {
            labels.insert(text(&entity["id"]).to_owned(), text(&entity["label"]).to_owned());
        }
        Self(labels)
    }

    pub fn entity(&self, id: &str) -> String {
        match self.0.get(id) {
            Some(label) if label != id => format!("{label} [{id}]"),
            _ => id.to_owned(),
        }
    }

    pub fn relationship(&self, relationship: &Value) -> String {
        let name = relationship["label"].as_str().unwrap_or_else(|| text(&relationship["kind"]));
        format!(
            "{} {name} {}",
            self.entity(text(&relationship["from"])),
            self.entity(text(&relationship["to"]))
        )
    }
}

/// A change in words: what happened to which entities or relationships, and its summary.
pub(crate) fn describe(change: &Value, before: &Value, after: &Value) -> String {
    let collection = text(&change["collection"]);
    let noun = if collection == "relationships" { "relationship" } else { "entity" };
    let name = |extraction: &Value, id: &str| -> String {
        let labels = Labels::new(extraction);
        if collection == "relationships" {
            items(extraction, "relationships")
                .iter()
                .find(|relationship| relationship["id"] == id)
                .map(|relationship| labels.relationship(relationship))
                .unwrap_or_else(|| id.to_owned())
        } else {
            labels.entity(id)
        }
    };
    let ids = |key: &str| -> Vec<String> {
        change[key]
            .as_array()
            .map(|values| values.iter().map(|id| text(id).to_owned()).collect())
            .unwrap_or_default()
    };
    let (old, new) = (ids("before"), ids("after"));
    let list = |extraction: &Value, values: &[String]| values.iter().map(|id| name(extraction, id)).collect::<Vec<_>>().join(", ");
    let modified = if change["status"] == "modified" { " and changed" } else { "" };
    let mut line = match (text(&change["status"]), text(&change["correspondence"])) {
        ("added", _) => format!("Added {noun} {}", list(after, &new)),
        ("removed", _) => format!("Removed {noun} {}", list(before, &old)),
        (_, "declared") => format!("Renamed{modified} {noun} {} to {}", list(before, &old), list(after, &new)),
        (_, "split") => format!("Split{modified} {noun} {} into {}", list(before, &old), list(after, &new)),
        (_, "merge") => format!("Merged{modified} {noun} {} into {}", list(before, &old), list(after, &new)),
        ("modified", _) => format!("Changed {noun} {}", list(after, &new)),
        _ => format!("Unchanged {noun} {}", list(after, &new)),
    };
    if let Some(summary) = change["summary"].as_str() {
        let _ = write!(line, ": {summary}");
    }
    line
}
