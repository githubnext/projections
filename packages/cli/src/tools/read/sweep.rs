//! `sweep`: projections run over recent changes, summarized per projection.

use std::fmt::Write as _;

use serde_json::{Value, json};

use super::super::{Answer, Failure, OnDrop, Outcome, POLL, get, plural, post, text};
use crate::service::Service;

/// A swept change in words: `#12 Add posts`, else its short commit and title.
fn change_label(change: &Value) -> String {
    let title = text(&change["title"]);
    match change["number"].as_u64() {
        Some(number) if title.contains(&format!("#{number}")) => title.to_owned(),
        Some(number) => format!("#{number} {title}"),
        None => format!("{} {}", &text(&change["after"])[..text(&change["after"]).len().min(8)], title),
    }
}

/// Counts by status in words: `3 added, 1 removed`.
fn counts_text(counts: &Value) -> String {
    counts
        .as_object()
        .into_iter()
        .flatten()
        .map(|(status, count)| format!("{count} {status}"))
        .collect::<Vec<_>>()
        .join(", ")
}

pub(in crate::tools) async fn sweep(service: &Service, input: &Value) -> Answer {
    let started = if input["latest"] == true {
        None
    } else {
        let mut body = json!({});
        for key in ["projections", "last"] {
            if !input[key].is_null() {
                body[key] = input[key].clone();
            }
        }
        let created = post(service, "/api/sweep", &body).await?;
        Some(text(&created["id"]).to_owned())
    };
    let mut cancel = OnDrop(started.clone().map(|id| move || service.cancel_sweep(&id)));
    let sweep = loop {
        let body = get(service, "/api/sweep").await?;
        let sweep = body["sweep"].clone();
        if sweep.is_null() {
            return Err(Failure::from("No sweep has run yet: call sweep without latest"));
        }
        if started.as_deref().is_some_and(|id| sweep["id"] != id) {
            cancel.disarm();
            return Err(Failure::from(
                "Another sweep (from the Explore view or another call) replaced this one; call sweep with latest to summarize it",
            ));
        }
        if sweep["status"] != "running" || started.is_none() {
            break sweep;
        }
        tokio::time::sleep(POLL).await;
    };
    cancel.disarm();
    match text(&sweep["status"]) {
        "failed" => {
            return Err(Failure(format!("The sweep failed: {}", text(&sweep["error"]))));
        }
        "cancelled" => return Err(Failure::from("The sweep was cancelled")),
        _ => {}
    }
    Ok(summarize_sweep(&sweep))
}

/// A sweep per projection: changed in N of M, the median size, and the changes it showed most on.
pub(in crate::tools) fn summarize_sweep(sweep: &Value) -> Outcome {
    let changes: Vec<&Value> = sweep["changes"].as_array().into_iter().flatten().collect();
    let rows: Vec<&Value> = sweep["projections"].as_array().into_iter().flatten().collect();
    let cells: Vec<&Value> = sweep["cells"].as_array().into_iter().flatten().collect();
    let total = changes.len();
    let mut out = String::new();
    let _ = writeln!(
        out,
        "Swept {} with {}{}:",
        plural(total, "recent change", "recent changes"),
        plural(rows.len(), "projection", "projections"),
        if sweep["status"] == "running" {
            " (still running: partial)"
        } else {
            ""
        }
    );
    let mut projections = Vec::new();
    for row in &rows {
        let id = text(&row["projection"]);
        if row["status"] != "ready" {
            let _ = writeln!(out, "- {id}: skipped. {}", text(&row["error"]));
            projections.push(json!({"projection": id, "status": row["status"], "error": row["error"]}));
            continue;
        }
        let (line, projection) = summarize_projection(id, &changes, &cells);
        let _ = writeln!(out, "{line}");
        projections.push(projection);
    }
    let busiest = busiest(&changes, &cells);
    if !busiest.is_empty() {
        let names: Vec<String> = busiest
            .iter()
            .map(|(count, change)| format!("{} ({count} projections)", change_label(change)))
            .collect();
        let _ = writeln!(out, "Changes where several projections changed: {}.", names.join(", "));
    }
    let busiest: Vec<Value> = busiest
        .iter()
        .map(|(count, change)| json!({"before": change["before"], "after": change["after"], "label": change_label(change), "projections": count}))
        .collect();
    Outcome::new(
        out,
        json!({"id": sweep["id"], "status": sweep["status"], "changes": total, "projections": projections, "busiest": busiest}),
    )
}

/// A ready projection's line and structured summary: how many of the swept
/// changes it changed on, their median size and the ones it changed most on.
fn summarize_projection(id: &str, changes: &[&Value], cells: &[&Value]) -> (String, Value) {
    let total = changes.len();
    let mine: Vec<&&Value> = cells.iter().filter(|cell| cell["projection"] == id).collect();
    let mut changed: Vec<&&Value> = mine.iter().copied().filter(|cell| cell["status"] == "changed").collect();
    let failed: Vec<&&Value> = mine.iter().copied().filter(|cell| cell["status"] == "failed").collect();
    let mut sizes: Vec<u64> = changed.iter().filter_map(|cell| cell["changes"].as_u64()).collect();
    sizes.sort_unstable();
    let median = (!sizes.is_empty()).then(|| sizes[sizes.len() / 2]);
    changed.sort_by_key(|cell| std::cmp::Reverse(cell["changes"].as_u64().unwrap_or(0)));
    let top: Vec<Value> = changed
        .iter()
        .take(3)
        .map(|cell| {
            json!({"before": cell["before"], "after": cell["after"], "label": label_of(changes, &cell["after"]),
                "changes": cell["changes"], "steps": cell["steps"], "counts": cell["counts"]})
        })
        .collect();
    let mut line = format!("- {id}: changed in {} of {total}", changed.len());
    if let Some(median) = median {
        let _ = write!(line, " (median {})", plural(median as usize, "change", "changes"));
    }
    if !top.is_empty() {
        let most: Vec<String> = top
            .iter()
            .map(|item| format!("{} ({}: {})", text(&item["label"]), item["changes"], counts_text(&item["counts"])))
            .collect();
        let _ = write!(line, "; most on {}", most.join(", "));
    }
    if total >= 3 && changed.len() == total {
        line.push_str("; changes on every change, so likely noise");
    } else if changed.is_empty() && failed.is_empty() && total > 0 {
        line.push_str("; showed nothing on these changes");
    }
    if !failed.is_empty() {
        let _ = write!(line, "; failed on {} (first: {}", failed.len(), text(&failed[0]["error"]));
        if let Some(last) = failed[0]["stderr"].as_str().and_then(|stderr| stderr.lines().next_back()) {
            let _ = write!(line, "; stderr ends: {last}");
        }
        line.push(')');
    }
    let mut projection = json!({"projection": id, "status": "ready", "changed": changed.len(), "of": total,
        "failed": failed.len(), "median": median, "top": top});
    if let Some(stderr) = failed.first().map(|cell| &cell["stderr"]).filter(|stderr| stderr.is_string()) {
        projection["firstFailure"] = json!({"error": failed[0]["error"], "stderr": stderr});
    }
    (line, projection)
}

/// A swept change's label by its after revision, else its short commit.
fn label_of(changes: &[&Value], after: &Value) -> String {
    changes
        .iter()
        .find(|change| change["after"] == *after)
        .map(|change| change_label(change))
        .unwrap_or_else(|| text(after).chars().take(8).collect())
}

/// The changes where several projections changed: the best ones to look at.
fn busiest<'a>(changes: &[&'a Value], cells: &[&Value]) -> Vec<(usize, &'a Value)> {
    let mut busiest: Vec<(usize, &Value)> = changes
        .iter()
        .map(|change| {
            let count = cells
                .iter()
                .filter(|cell| cell["after"] == change["after"] && cell["status"] == "changed")
                .count();
            (count, *change)
        })
        .filter(|(count, _)| *count > 1)
        .collect();
    busiest.sort_by_key(|(count, _)| std::cmp::Reverse(*count));
    busiest.truncate(3);
    busiest
}
