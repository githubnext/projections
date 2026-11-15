//! A comparison's steps and their changes in words, with what generated
//! values say about them.

use std::{
    collections::{BTreeMap, HashMap},
    fmt::Write as _,
};

use serde_json::{Value, json};

use super::super::text;

/// The steps and changes a comparison summary described.
pub(super) struct Described {
    /// Every step, with the IDs of its changes.
    pub(super) steps: Vec<Value>,
    /// The changes described, at most the limit.
    pub(super) changes: Vec<Value>,
    pub(super) shown: usize,
}

/// Writes `document`'s steps and their changes, at most `limit` changes.
pub(super) fn describe_steps(out: &mut String, document: &Value, changes: &[&Value], steps: &[&Value], limit: usize) -> Described {
    let by_id: HashMap<&str, &Value> = changes.iter().map(|change| (text(&change["id"]), *change)).collect();
    let mut described = Vec::new();
    let mut shown = 0;
    let mut structured_steps = Vec::new();
    for (index, step) in steps.iter().enumerate() {
        let ids: Vec<&str> = step["changes"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
        structured_steps.push(json!({"index": index + 1, "kind": step["kind"], "summary": step["summary"], "changes": ids}));
        if shown >= limit {
            continue;
        }
        let mut title = format!("\nStep {} of {}", index + 1, steps.len());
        if let Some(kind) = step["kind"].as_str() {
            let _ = write!(title, " ({kind})");
        }
        if let Some(summary) = step["summary"].as_str() {
            let _ = write!(title, ": {summary}");
        }
        let _ = writeln!(out, "{title}");
        for id in ids {
            let Some(change) = by_id.get(id) else {
                continue;
            };
            if shown >= limit {
                break;
            }
            shown += 1;
            described.push(describe_change(out, document, id, change));
        }
    }
    Described {
        steps: structured_steps,
        changes: described,
        shown,
    }
}

/// Writes one change's line and returns it as structured JSON.
fn describe_change(out: &mut String, document: &Value, id: &str, change: &Value) -> Value {
    let (old, new) = (&document["before"], &document["after"]);
    let compatibility = &document["comparison"]["metadata"]["compatibility"];
    let line = crate::render::labels::describe(change, &old["extraction"], &new["extraction"]);
    let classified = &compatibility["changes"][id];
    let level = classified["level"].as_str();
    let entities: Vec<&Value> = ["after", "before"]
        .iter()
        .find_map(|side| {
            change[*side]
                .as_array()
                .filter(|ids| !ids.is_empty())
                .map(|ids| ids.iter().collect())
        })
        .unwrap_or_default();
    let generated_paths: Vec<&Value> = change["varied"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|varied| varied["generated"] == true)
        .collect();
    let regenerated = generated_paths.iter().map(|varied| regenerated_text(varied)).collect::<Vec<_>>();
    let _ = writeln!(
        out,
        "  {line}{}{}",
        level.map(|level| format!(" [{level}]")).unwrap_or_default(),
        if regenerated.is_empty() {
            String::new()
        } else {
            format!(" ({})", regenerated.join("; "))
        }
    );
    let mut item = json!({"id": id, "status": change["status"], "collection": change["collection"],
        "entities": entities, "description": line});
    if !generated_paths.is_empty() {
        item["varied"] = change["varied"].clone();
    }
    for key in ["correspondence", "summary"] {
        if !change[key].is_null() {
            item[key] = change[key].clone();
        }
    }
    if let Some(level) = level {
        item["level"] = json!(level);
        item["reason"] = classified["reason"].clone();
    }
    item
}

/// A generated value that varied, in words: `generated summary, <why>`.
fn regenerated_text(varied: &Value) -> String {
    let path = text(&varied["path"]);
    let name = path.strip_prefix("/data/").unwrap_or(path);
    let because: Vec<String> = varied["because"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    let why = if varied["within"] == true {
        "regenerated from the same inputs".to_owned()
    } else if because.is_empty() {
        text(&varied["reason"]).to_lowercase()
    } else {
        projections_engine::volatility::regenerated_because(&because).to_lowercase()
    };
    format!("generated {name}, {why}")
}

/// Generated values across a comparison's changes: how many changed (and
/// which basis parts moved), how many were only regenerated from the same
/// inputs, and a sentence saying so, so an agent never presents a generated
/// summary as an extracted fact. `sentence` is null without generated values.
pub(super) fn generated_summary(changes: &[&Value]) -> Value {
    let (mut changed, mut regenerated) = (0, 0);
    let mut because: BTreeMap<String, u64> = Default::default();
    for varied in changes
        .iter()
        .flat_map(|change| change["varied"].as_array().into_iter().flatten())
        .filter(|varied| varied["generated"] == true)
    {
        if varied["within"] == true {
            regenerated += 1;
            continue;
        }
        changed += 1;
        for part in varied["because"].as_array().into_iter().flatten() {
            *because.entry(text(part).to_owned()).or_default() += 1;
        }
    }
    if changed + regenerated == 0 {
        return json!({"sentence": null});
    }
    let parts = because
        .iter()
        .map(|(part, count)| format!("{part}: {count}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sentence = format!(
        "Generated values (written by the extractor's generator, such as a language model, not extracted facts): {} changed{}; {} regenerated from the same inputs (within tolerance).",
        changed,
        if parts.is_empty() { String::new() } else { format!(" ({parts})") },
        regenerated
    );
    json!({"sentence": sentence, "changed": changed, "regenerated": regenerated, "because": because})
}
