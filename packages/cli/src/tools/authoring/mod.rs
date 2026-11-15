//! Tools that author projections: describing and setting a definition's
//! parts, and updating comparator test snapshots.

pub(super) mod describe;
pub(super) mod snapshots;

use std::fmt::Write as _;

use axum::http::Method;
use serde_json::{Map, Value, json};

use super::{Answer, Failure, Host, Outcome, TRUST_HINT, api, confirm_hint, post, projection_of, refusal, text, token};
use crate::service::Service;

/// A line diff of two small texts, unchanged runs shortened to their edges.
pub fn line_diff(before: &str, after: &str) -> String {
    let (old, new): (Vec<&str>, Vec<&str>) = (before.lines().collect(), after.lines().collect());
    if old.len().saturating_mul(new.len()) > 4_000_000 {
        return format!("(too large to diff: {} lines before, {} after)\n", old.len(), new.len());
    }
    // The longest common subsequence's lengths, from the end.
    let mut lengths = vec![vec![0u32; new.len() + 1]; old.len() + 1];
    for i in (0..old.len()).rev() {
        for j in (0..new.len()).rev() {
            lengths[i][j] = if old[i] == new[j] {
                lengths[i + 1][j + 1] + 1
            } else {
                lengths[i + 1][j].max(lengths[i][j + 1])
            };
        }
    }
    let mut lines: Vec<(char, &str)> = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < old.len() || j < new.len() {
        if i < old.len() && j < new.len() && old[i] == new[j] {
            lines.push((' ', old[i]));
            (i, j) = (i + 1, j + 1);
        } else if i < old.len() && (j == new.len() || lengths[i + 1][j] >= lengths[i][j + 1]) {
            lines.push(('-', old[i]));
            i += 1;
        } else {
            lines.push(('+', new[j]));
            j += 1;
        }
    }
    const CONTEXT: usize = 2;
    let near = |index: usize| {
        lines[index.saturating_sub(CONTEXT)..(index + CONTEXT + 1).min(lines.len())]
            .iter()
            .any(|(mark, _)| *mark != ' ')
    };
    let mut out = String::new();
    let mut skipped = false;
    for (index, (mark, line)) in lines.iter().enumerate() {
        if *mark == ' ' && !near(index) {
            if !skipped {
                out.push_str("  …\n");
                skipped = true;
            }
            continue;
        }
        skipped = false;
        let _ = writeln!(out, "{mark} {line}");
    }
    out
}

pub(super) async fn set_part(service: &Service, host: Host, input: &Value) -> Answer {
    let projection = projection_of(input)?;
    let object = input.as_object().cloned().unwrap_or_default();
    let parts: Map<String, Value> = crate::definition_file::PARTS
        .iter()
        .filter_map(|name| object.get(*name).map(|value| ((*name).to_owned(), value.clone())))
        .collect();
    if parts.is_empty() {
        return Err(Failure::from(
            "Name a part to set: extractor, comparator or renderer (null removes an optional one)",
        ));
    }
    let mut body = json!({"projectionId": projection, "parts": parts, "dryRun": true});
    let preview = post(service, "/api/definition", &body).await?;
    let path = text(&preview["path"]).to_owned();
    let diff = line_diff(text(&preview["before"]), text(&preview["after"]));
    let confirm = token("set_part", &[text(&preview["digest"]), &path, text(&preview["after"])]);
    let names: Vec<&String> = parts.keys().collect();
    let names = names.iter().map(|name| name.as_str()).collect::<Vec<_>>().join(", ");
    let mut structured = json!({"projection": projection, "path": path, "parts": parts.keys().collect::<Vec<_>>(),
        "changed": preview["changed"], "written": false, "diff": diff});
    if preview["changed"] != true {
        return Ok(Outcome::new(
            format!("{path} already has that {names}; nothing to change.\n"),
            structured,
        ));
    }
    let previewed = format!("Setting the {names} of {projection} changes {path}:\n```diff\n{diff}```\n");
    match input["confirm"].as_str() {
        None => {
            structured["confirm"] = json!(confirm);
            let mut text = previewed;
            if !service.trusted() {
                let _ = writeln!(text, "Writing it needs trust. {TRUST_HINT}.");
            }
            text.push_str(&confirm_hint(host, "set_part", &confirm));
            Ok(Outcome::new(text, structured))
        }
        Some(given) if given != confirm => {
            structured["confirm"] = json!(confirm);
            let mut outcome = Outcome::new(
                format!(
                    "Not written: the definition or the change differs from the preview that was confirmed. Now: {previewed}{}",
                    confirm_hint(host, "set_part", &confirm)
                ),
                structured,
            );
            outcome.error = true;
            Ok(outcome)
        }
        Some(_) => {
            body["dryRun"] = json!(false);
            body["digest"] = preview["digest"].clone();
            match api(service, Method::POST, "/api/definition", Some(&body)).await? {
                (200..=299, _) => {}
                (409, _) => {
                    return Err(Failure(format!(
                        "Not written: {path} changed since the preview. Call set_part again without confirm to preview the new difference."
                    )));
                }
                (status, body) => return Err(refusal(status, &body)),
            }
            structured["written"] = json!(true);
            Ok(Outcome::new(
                format!("Saved the {names} of {projection} to {path}. Check it: check with projections [\"{projection}\"].\n"),
                structured,
            ))
        }
    }
}
