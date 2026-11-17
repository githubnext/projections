//! `compare`: a projection's comparison between two revisions, summarized
//! with its comparator's classification.

use std::fmt::Write as _;

use serde_json::{Map, Value, json};

use super::super::{Answer, Failure, Outcome, encode, get, plural, projection_of, text};
use super::run_job;
use super::steps::{describe_steps, generated_summary};
use crate::service::Service;

pub(in crate::tools) async fn compare(service: &Service, input: &Value) -> Answer {
    let projection = projection_of(input)?;
    let (before, after, label) = match (input["before"].as_str(), input["after"].as_str()) {
        (Some(before), after) => (before.to_owned(), after.unwrap_or("working-tree").to_owned(), None),
        (None, Some(_)) => {
            return Err(Failure::from(
                "Give before too: compare needs two revisions, or neither for the suggested pair",
            ));
        }
        (None, None) => suggested_pair(service, projection).await?,
    };
    let mut body = json!({"projectionId": projection, "before": before, "after": after});
    match (input["definition"].as_str(), input["definitionRevision"].as_str()) {
        (Some(_), Some(_)) => return Err(Failure::from("Give definition or definitionRevision, not both")),
        (Some(definition), None) => body["definition"] = json!(definition),
        (None, Some(revision)) => body["definitionRevision"] = json!(revision),
        // The suggested pair (a bookmark, say) is what the viewer would show,
        // and the viewer applies the working tree's definition: one saved
        // before its projection was written still compares.
        (None, None) if label.is_some() => body["definitionRevision"] = json!("working-tree"),
        (None, None) => {}
    }
    let job = run_job(service, &body).await?;
    let notices: Vec<String> = job["notices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|notice| notice.as_str().map(str::to_owned))
        .collect();
    let limit = input["maxChanges"].as_u64().unwrap_or(100) as usize;
    Ok(summarize_comparison(
        &job["comparison"],
        &notices,
        (&before, &after, label.as_deref()),
        limit,
    ))
}

/// The pair Projections suggests for `projection`: before, after and its label.
async fn suggested_pair(service: &Service, projection: &str) -> Result<(String, String, Option<String>), Failure> {
    let pairs = get(service, &format!("/api/pairs?projection={}", encode(projection))).await?;
    let default = &pairs["default"];
    let Some(before) = default["before"].as_str() else {
        return Err(Failure::from(
            "Projections suggests no pair with changes here (no bookmark, branch, tag, earlier commit or uncommitted change); give before and after",
        ));
    };
    Ok((
        before.to_owned(),
        text(&default["after"]).to_owned(),
        default["label"].as_str().map(str::to_owned),
    ))
}

/// A comparison as steps and changes, with its comparator's classification.
pub(in crate::tools) fn summarize_comparison(
    document: &Value,
    notices: &[String],
    (before, after, label): (&str, &str, Option<&str>),
    limit: usize,
) -> Outcome {
    let (old, new) = (&document["before"], &document["after"]);
    let comparison = &document["comparison"];
    let changes: Vec<&Value> = comparison["changes"].as_array().into_iter().flatten().collect();
    let steps: Vec<&Value> = comparison["steps"].as_array().into_iter().flatten().collect();
    let metadata = &comparison["metadata"];
    let compatibility = &metadata["compatibility"];
    let comparator = text(&document["comparator"]["id"]);
    let mut out = String::new();
    let _ = writeln!(out, "{}", crate::render::heading(old));
    let _ = writeln!(
        out,
        "Comparing {before} ({}) with {after} ({}){}. Comparator: {comparator}.",
        crate::render::revision(old),
        crate::render::revision(new),
        label.map(|label| format!(", the suggested pair \"{label}\"")).unwrap_or_default()
    );
    for notice in notices {
        let _ = writeln!(out, "Note: {notice}");
    }
    let counts = status_counts(&changes);
    if changes.is_empty() {
        let _ = writeln!(out, "No changes: the projection is the same on both sides.");
    } else {
        let _ = writeln!(
            out,
            "{} in {}: {}.",
            plural(changes.len(), "change", "changes"),
            plural(steps.len(), "step", "steps"),
            ordered_counts(&counts, &["added", "removed", "modified", "unchanged"]).replace("unchanged", "renamed without other changes")
        );
    }
    write_compatibility(&mut out, compatibility);
    let generated = generated_summary(&changes);
    if let Some(sentence) = generated["sentence"].as_str() {
        let _ = writeln!(out, "{sentence}");
    }
    let others = metadata_text(metadata);
    if !others.is_empty() {
        let _ = writeln!(out, "Comparator metadata: {}.", others.join("; "));
    }
    let described = describe_steps(&mut out, document, &changes, &steps, limit);
    let shown = described.shown;
    if shown < changes.len() {
        let _ = writeln!(
            out,
            "\n{} more not described; raise maxChanges for them.",
            plural(changes.len() - shown, "change", "changes")
        );
    }
    let mut structured = json!({
        "projection": old["projection"]["id"],
        "before": {"revision": before, "commit": old["provenance"]["revision"]["commit"]},
        "after": {"revision": after, "commit": new["provenance"]["revision"]["commit"]},
        "comparator": comparator,
        "counts": counts,
        "steps": described.steps,
        "changes": described.changes,
        "truncated": shown < changes.len(),
        "notices": notices,
    });
    if let Some(label) = label {
        structured["pair"] = json!(label);
    }
    if compatibility.is_object() {
        structured["compatibility"] = json!({"rules": compatibility["rules"], "counts": compatibility["counts"]});
    }
    if generated["sentence"].is_string() {
        structured["generated"] = json!({"changed": generated["changed"],
            "regenerated": generated["regenerated"], "because": generated["because"]});
    }
    Outcome::new(out, structured)
}

/// How many changes have each status (`modified` when it has none).
fn status_counts(changes: &[&Value]) -> Map<String, Value> {
    let mut counts: Map<String, Value> = Map::new();
    for change in changes {
        let status = change["status"].as_str().unwrap_or("modified").to_owned();
        let count = counts.get(&status).and_then(Value::as_u64).unwrap_or(0);
        counts.insert(status, json!(count + 1));
    }
    counts
}

/// Counts in words, the keys in `order` first: `2 added, 1 removed`.
fn ordered_counts(counts: &Map<String, Value>, order: &[&str]) -> String {
    let mut keys: Vec<&String> = counts.keys().collect();
    keys.sort_by_key(|key| order.iter().position(|first| first == key).unwrap_or(order.len()));
    keys.iter()
        .map(|key| format!("{} {key}", counts[key.as_str()]))
        .collect::<Vec<_>>()
        .join(", ")
}

/// The comparator's compatibility levels and notes, when it classified changes.
fn write_compatibility(out: &mut String, compatibility: &Value) {
    let Some(levels) = compatibility["counts"].as_object() else {
        return;
    };
    let _ = writeln!(
        out,
        "Compatibility{}: {}.",
        compatibility["rules"]
            .as_str()
            .map(|rules| format!(" ({rules})"))
            .unwrap_or_default(),
        ordered_counts(levels, &["breaking", "unknown", "additive", "compatible"])
    );
    for notice in compatibility["notices"].as_array().into_iter().flatten() {
        let _ = writeln!(out, "Compatibility note: {}", text(notice));
    }
}

/// The comparator's other metadata, each `key value` or its size when long.
fn metadata_text(metadata: &Value) -> Vec<String> {
    metadata
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(key, _)| key.as_str() != "compatibility")
        .map(|(key, value)| {
            let value = value.to_string();
            if value.len() > 300 {
                format!("{key} ({} bytes)", value.len())
            } else {
                format!("{key} {value}")
            }
        })
        .collect()
}
