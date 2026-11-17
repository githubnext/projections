//! What an open page shows, for `current_view`: its mode, status, summary bar,
//! changes and selection, as the page reported them.

use serde_json::Value;

const MODE_NAMES: [(&str, &str); 4] = [
    ("side-by-side", "Side by side"),
    ("animated", "Animated"),
    ("swipe", "Swipe"),
    ("diff", "Diff"),
];

/// Says what the page shows, given its `view` and `summary` reports.
pub(super) fn describe(lines: &mut Vec<String>, view: &Value, summary: &Value) {
    if let Some(mode) = view["mode"].as_str() {
        lines.push(mode_line(view, mode));
    }
    status(lines, summary);
    for notice in summary["notices"].as_array().into_iter().flatten() {
        if let Some(notice) = notice.as_str() {
            lines.push(format!("Notice: {notice}"));
        }
    }
    if let Some(figures) = view["figures"].as_array().filter(|figures| !figures.is_empty()) {
        lines.push(format!(
            "Summary bar: {}.",
            figures.iter().map(figure_text).collect::<Vec<_>>().join(" · ")
        ));
    }
    if view["compared"] == true {
        lines.push(changes_line(view));
    }
    changed_items(lines, view);
    if let Some(count) = view["variation"]["regenerated"].as_u64().filter(|count| *count > 0) {
        lines.push(format!(
            "Regenerated: {count} {} regenerated from the same inputs (within tolerance, so not a change).",
            if count == 1 {
                "item's generated values were"
            } else {
                "items' generated values were"
            }
        ));
    }
    if let Some(generated) = view["generated"].as_array().filter(|generated| !generated.is_empty()) {
        lines.push(generated_line(generated));
    }
    lines.push(selection_line(view));
    if summary["status"] == "ok" {
        lines.push("Up to date: the viewer extracts again when the working tree changes.".to_owned());
    }
    lines.push("Definition: the working tree's, with any uncommitted edits.".to_owned());
}

fn mode_name(mode: &str) -> &str {
    MODE_NAMES.iter().find(|(id, _)| *id == mode).map_or(mode, |(_, name)| name)
}

fn mode_line(view: &Value, mode: &str) -> String {
    let offered: Vec<&str> = MODE_NAMES
        .iter()
        .filter(|(id, _)| view["modes"].as_array().is_some_and(|modes| modes.iter().any(|item| item == id)))
        .map(|(_, name)| *name)
        .collect();
    format!(
        "Mode: {}{}{}.",
        mode_name(mode),
        if offered.len() > 1 {
            format!(" (of {})", offered.join(", "))
        } else {
            String::new()
        },
        if view["changesOnly"] == true { ", changes only" } else { "" }
    )
}

/// What the agent does about trust; the page asks the person to ask the agent for it.
pub(super) const RESTART_WITH_TRUST: &str = "Review the projection's code (its extractor and renderer), then run `projections view --trust`: it replaces this viewer at the same URL, and the page reconnects. Ask the person first if the code isn't yours to judge.";

fn status(lines: &mut Vec<String>, summary: &Value) {
    match summary["status"].as_str() {
        Some("extracting") => lines.push("Status: extracting; what follows may be the pair shown before.".to_owned()),
        Some("trust") => lines.push(format!(
            "Status: needs trust: its extractor is repository code and the viewer runs without --trust. {RESTART_WITH_TRUST}"
        )),
        Some("failed") => {
            lines.push("Status: failed. The page says only that the extractor didn't run; why:".to_owned());
            for failure in summary["failures"].as_array().into_iter().flatten() {
                lines.push(format!(
                    "- {}: {}",
                    failure["ref"].as_str().unwrap_or_default(),
                    failure["message"].as_str().unwrap_or_default()
                ));
            }
            if let Some(error) = summary["error"].as_str() {
                lines.push(format!("- {error}"));
            }
        }
        _ => {}
    }
}

fn figure_text(figure: &Value) -> String {
    let count = figure["count"].as_u64().unwrap_or(0);
    let noun = &figure["noun"][if count == 1 { "singular" } else { "plural" }];
    let deltas: Vec<String> = [("added", "+"), ("removed", "−"), ("modified", "~")]
        .iter()
        .filter_map(|(key, sign)| {
            figure[*key]
                .as_u64()
                .filter(|value| *value > 0)
                .map(|value| format!("{sign}{value}"))
        })
        .collect();
    format!(
        "{count} {}{}",
        noun.as_str().unwrap_or_default(),
        if deltas.is_empty() {
            String::new()
        } else {
            format!(" ({})", deltas.join(" "))
        }
    )
}

fn changes_line(view: &Value) -> String {
    let counts: Vec<String> = view["changes"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(status, count)| *status != "unchanged" && count.as_u64().unwrap_or(0) > 0)
        .map(|(status, count)| format!("{count} {status}"))
        .collect();
    format!(
        "Changes: {} of {} items.",
        if counts.is_empty() { "none".to_owned() } else { counts.join(", ") },
        view["rows"].as_u64().unwrap_or(0)
    )
}

fn changed_items(lines: &mut Vec<String>, view: &Value) {
    let changed: Vec<&Value> = view["items"]
        .as_array()
        .into_iter()
        .flatten()
        // Identity changes (a rename, split or merge) are `unchanged` but carry context.
        .filter(|item| item["status"].as_str().is_some_and(|status| status != "unchanged") || item["context"].is_object())
        .collect();
    if changed.is_empty() {
        return;
    }
    lines.push("Changed items (status, kind, label [ID]), each with its context: the items the Changes scope shows to read it:".to_owned());
    for item in changed {
        lines.push(format!(
            "- {} {} {} [{}]",
            item["status"].as_str().unwrap_or_default(),
            item["kind"].as_str().unwrap_or_default(),
            item["label"].as_str().unwrap_or_default(),
            item["id"].as_str().unwrap_or_default()
        ));
        if item["context"].is_object() {
            lines.push(format!("  {}", context_text(&item["context"])));
        }
    }
}

/// `context: module tools [m], … and 2 more (added by rule callers)`: a
/// change's context, as the page listed it.
fn context_text(context: &Value) -> String {
    let field = |item: &Value, name: &str| item[name].as_str().unwrap_or_default().to_owned();
    let items: Vec<String> = context["items"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|item| format!("{} {} [{}]", field(item, "kind"), field(item, "label"), field(item, "id")))
        .collect();
    let total = context["total"].as_u64().unwrap_or(items.len() as u64);
    let more = total.saturating_sub(items.len() as u64);
    let rules: Vec<String> = context["rules"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|rule| format!("`{rule}`"))
        .collect();
    format!(
        "context: {}{}{}{}",
        items.join(", "),
        if more > 0 { format!(" and {more} more") } else { String::new() },
        match rules.len() {
            0 => String::new(),
            1 => format!(" (added by rule {})", rules[0]),
            _ => format!(" (added by rules {})", rules.join(", ")),
        },
        if context["derived"] == true {
            " (derived: the comparison was saved without context)"
        } else {
            ""
        }
    )
}

fn generated_line(generated: &[Value]) -> String {
    format!(
        "The selection's generated values (written by the extractor's generator, such as a language model; not extracted facts): {}.",
        generated
            .iter()
            .map(|field| format!(
                "{} ({})",
                field["name"].as_str().unwrap_or_default(),
                if field["form"] == "plain" {
                    "unchanged".to_owned()
                } else {
                    field["words"]
                        .as_str()
                        .or(field["form"].as_str())
                        .unwrap_or_default()
                        .to_lowercase()
                }
            ))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn selection_line(view: &Value) -> String {
    let Some(selection) = view["selection"].as_object() else {
        return "Selected: nothing.".to_owned();
    };
    let field = |name: &str| selection.get(name).and_then(Value::as_str);
    format!(
        "Selected: {} {} [{}]{}.",
        field("kind").unwrap_or_default(),
        field("label").unwrap_or_default(),
        field("id").unwrap_or_default(),
        field("status").map(|status| format!(", {status}")).unwrap_or_default()
    )
}

#[cfg(test)]
mod tests;
