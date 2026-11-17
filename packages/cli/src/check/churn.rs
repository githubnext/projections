//! Data that changes for reasons unrelated to the item holding it: counts and
//! lists of things elsewhere ("files importing this module") and positions in
//! source (line numbers). The default comparator marks an item modified when
//! its data changes, so such fields make it modified on changes that didn't
//! touch it: adding any importing file, or moving code above it. Found from
//! field names and values alone, in custom extractors' output; a field the
//! definition reads (`sizeBy: /data/lines`) or declares volatile is deliberate.

use super::step;
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// Field names, without separators and lowercased, that count or list things elsewhere.
const TALLIES: [&str; 14] = [
    "files",
    "lines",
    "loc",
    "sloc",
    "importers",
    "importedby",
    "dependents",
    "usedby",
    "callers",
    "calledby",
    "references",
    "referencedby",
    "usages",
    "occurrences",
];
/// Field names that are positions in source.
const POSITIONS: [&str; 9] = [
    "line",
    "lineno",
    "linenumber",
    "startline",
    "endline",
    "column",
    "col",
    "offset",
    "position",
];
/// Fields named per item that a warning lists at most.
const EXAMPLES: usize = 2;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Churn {
    Count,
    List,
    Position,
}

/// The lowercase words of a field name: `fileCount`, `file_count` and `file-count` are `file`, `count`.
fn words(key: &str) -> Vec<String> {
    let mut words = vec![String::new()];
    let mut previous_lower = false;
    for character in key.chars() {
        if !character.is_alphanumeric() {
            words.push(String::new());
            previous_lower = false;
            continue;
        }
        if character.is_uppercase() && previous_lower {
            words.push(String::new());
        }
        previous_lower = character.is_lowercase() || character.is_ascii_digit();
        words.last_mut().expect("words start nonempty").extend(character.to_lowercase());
    }
    words.retain(|word| !word.is_empty());
    words
}

/// Why a data field churns, if its name and value say it does.
fn churn(key: &str, value: &Value, quantities: bool) -> Option<Churn> {
    let words = words(key);
    let joined = words.concat();
    let counted = value.as_u64().is_some();
    if value.is_number() && POSITIONS.contains(&joined.as_str()) {
        return Some(Churn::Position);
    }
    let tally = TALLIES.contains(&joined.as_str());
    if counted && quantities {
        let named = words.last().is_some_and(|word| word == "count")
            || words.first().is_some_and(|word| word == "num")
            || words.starts_with(&["number".to_owned(), "of".to_owned()]);
        if named || tally {
            return Some(Churn::Count);
        }
    }
    let strings = value
        .as_array()
        .is_some_and(|items| !items.is_empty() && items.iter().all(Value::is_string));
    (tally && strings && !matches!(joined.as_str(), "lines" | "loc" | "sloc")).then_some(Churn::List)
}

/// A warning naming each churn-prone data field of a custom extractor's
/// extraction, by collection, kind and field; `None` when there is none.
pub(super) fn churn_step(definition: &Value, document: &Value) -> Option<Value> {
    if !definition["extractor"].is_object() {
        return None;
    }
    let extraction = &document["extraction"];
    // Metrics and treemaps hold quantities by design.
    let quantities = !matches!(extraction["schema"].as_str(), Some("metrics/v0" | "treemap/v0"));
    let read = definition.to_string();
    let deliberate = |key: &str| {
        let pointer = format!("/data/{key}");
        read.contains(&format!("\"{pointer}\""))
            || extraction["volatile"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|volatile| volatile["path"] == pointer.as_str())
    };
    // (churn, field, collection, kind) -> the IDs of the items holding it.
    let mut found: BTreeMap<(Churn, String, &str, String), Vec<String>> = BTreeMap::new();
    for (collection, noun) in [("entities", "entity"), ("relationships", "relationship")] {
        for item in extraction[collection].as_array().into_iter().flatten() {
            for (key, value) in item["data"].as_object().into_iter().flatten() {
                if key == "value" || deliberate(key) {
                    continue;
                }
                if let Some(churn) = churn(key, value, quantities) {
                    let kind = item["kind"].as_str().unwrap_or_default().to_owned();
                    let id = item["id"].as_str().unwrap_or_default().to_owned();
                    found.entry((churn, key.clone(), noun, kind)).or_default().push(id);
                }
            }
        }
    }
    if found.is_empty() {
        return None;
    }
    let details: Vec<String> = found.iter().map(|(key, ids)| detail(key, ids)).collect();
    let mut value = step(
        "data",
        "Data that changes for unrelated reasons",
        "warn",
        format!(
            "{} data {} change{} when something other than the item holding {} changes, so the item shows as modified on changes that didn't touch it. Keep in data only facts about the item itself",
            details.len(),
            if details.len() == 1 { "field" } else { "fields" },
            if details.len() == 1 { "s" } else { "" },
            if details.len() == 1 { "it" } else { "them" },
        ),
    );
    value["details"] = json!(details);
    Some(value)
}

fn detail((churn, key, noun, kind): &(Churn, String, &str, String), ids: &[String]) -> String {
    let examples: Vec<String> = ids.iter().take(EXAMPLES).map(|id| format!("`{id}`")).collect();
    let more = if ids.len() > EXAMPLES { ", …" } else { "" };
    let holders = format!(
        "`data.{key}` on {} `{kind}` {}{} ({}{more})",
        ids.len(),
        noun,
        if ids.len() == 1 { "" } else { "s" },
        examples.join(", ")
    );
    let them = if ids.len() == 1 { "it" } else { "them" };
    match churn {
        Churn::Count => format!(
            "{holders} counts things elsewhere: adding or removing any of them marks {them} modified. Drop it, or draw what it counts as relationships"
        ),
        Churn::List => format!(
            "{holders} lists things elsewhere: adding one marks {them} modified. Draw them as relationships, or name the files in evidence (`{{\"kind\": \"file\", \"source\": \"<path>\"}}`), which the default comparator ignores"
        ),
        Churn::Position => format!(
            "{holders} is a position in source: moving code above it marks {them} modified. Put it in evidence (`{{\"location\": {{\"line\": N}}}}`), which the default comparator ignores"
        ),
    }
}

#[cfg(test)]
mod tests;
