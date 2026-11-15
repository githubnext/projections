//! Rule coverage reports (`projections.rules-coverage`): what the rules
//! interpreter counts when it runs a comparator file for coverage, merged
//! across comparisons and summarized for authors.
//!
//! A report lists three kinds of entries, each with its rules-file `path`,
//! `line`, `column` and `count`: `functions` (by `name`), `expressions` (every
//! expression outside a function) and `branches` (each outcome of a
//! decision: `kind`, `condition`, and `outcome` but for `map`). An entry with
//! `excluded` has a `coverage-ignore:` comment's reason and isn't counted.
//! `docs/contracts/comparisons.md` ("Rule coverage") describes it.

use serde_json::{Value, json};
use std::collections::HashMap;

pub const FORMAT: &str = "projections.rules-coverage";
/// The kinds of entries, in report order.
pub const CATEGORIES: [&str; 3] = ["functions", "expressions", "branches"];

/// An entry's identity: everything but its count.
fn key(entry: &Value) -> String {
    let mut identity = entry.clone();
    if let Some(fields) = identity.as_object_mut() {
        fields.remove("count");
    }
    identity.to_string()
}

/// Adds `from`'s counts to `into`'s entries with the same identity, so
/// reports of one comparator file sum. `from`'s entries that `into` doesn't
/// have are left out: `into` is the file whose coverage is reported. An
/// empty `into` (`null`) becomes `from`.
pub fn merge(into: &mut Value, from: &Value) {
    if into.is_null() {
        *into = from.clone();
        return;
    }
    for category in CATEGORIES {
        let mut counts: HashMap<String, Vec<u64>> = HashMap::new();
        for entry in from[category].as_array().into_iter().flatten() {
            counts.entry(key(entry)).or_default().push(entry["count"].as_u64().unwrap_or(0));
        }
        let mut seen: HashMap<String, usize> = HashMap::new();
        for entry in into[category].as_array_mut().into_iter().flatten() {
            let identity = key(entry);
            let occurrence = seen.entry(identity.clone()).or_default();
            let added = counts.get(&identity).and_then(|found| found.get(*occurrence)).copied().unwrap_or(0);
            *occurrence += 1;
            entry["count"] = json!(entry["count"].as_u64().unwrap_or(0) + added);
        }
    }
}

/// Covered, total and excluded entries of each kind, and the percentage
/// covered: `{functions: {covered, total, excluded, percent}, …}`.
pub fn summary(coverage: &Value) -> Value {
    let mut summary = json!({});
    for category in CATEGORIES {
        let entries = coverage[category].as_array().map(Vec::as_slice).unwrap_or_default();
        let excluded = entries.iter().filter(|entry| entry.get("excluded").is_some()).count();
        let counted: Vec<&Value> = entries.iter().filter(|entry| entry.get("excluded").is_none()).collect();
        let covered = counted.iter().filter(|entry| entry["count"].as_u64().unwrap_or(0) > 0).count();
        summary[category] = json!({"covered": covered, "total": counted.len(), "excluded": excluded,
            "percent": percent(covered, counted.len())});
    }
    summary
}

/// `covered` of `total` as a percentage, rounded down to a tenth: 100 when
/// there is nothing to cover.
pub fn percent(covered: usize, total: usize) -> f64 {
    if total == 0 {
        return 100.0;
    }
    (covered as f64 * 1000.0 / total as f64).floor() / 10.0
}

/// What an uncovered entry didn't do, in words.
pub fn describe(category: &str, entry: &Value) -> String {
    let condition = entry["condition"].as_str().unwrap_or_default();
    let never = if entry["outcome"] == true { "true" } else { "false" };
    match (category, entry["kind"].as_str().unwrap_or_default()) {
        ("functions", _) => format!("function `{}` never ran", entry["name"].as_str().unwrap_or_default()),
        ("expressions", _) => format!("{} never ran", entry["path"].as_str().unwrap_or_default()),
        (_, "match") if entry["outcome"] == true => format!("`match` case {condition} never matched"),
        (_, "match") => format!("`match` never fell to its default (after case {condition})"),
        (_, "cond") if entry["outcome"] == false => format!("`cond` never fell to its default (after `{condition}`)"),
        (_, "map") => format!("`map` never ran its body `{condition}`"),
        (_, kind @ ("exists" | "all" | "exists_one" | "filter")) => {
            format!("`{kind}` predicate `{condition}` was never {never}")
        }
        _ => format!("`{condition}` was never {never}"),
    }
}

/// Entries of `coverage` that `select` picks, as `{category, path, line,
/// column, message}` (and `excluded`), in file order.
fn listed(coverage: &Value, select: impl Fn(&Value) -> bool) -> Vec<Value> {
    let mut found = Vec::new();
    for category in CATEGORIES {
        for entry in coverage[category].as_array().into_iter().flatten().filter(|entry| select(entry)) {
            let mut item = json!({"category": category, "path": entry["path"], "line": entry["line"],
                "column": entry["column"], "message": describe(category, entry)});
            if let Some(reason) = entry.get("excluded") {
                item["excluded"] = reason.clone();
            }
            found.push(item);
        }
    }
    let at = |item: &Value| (item["line"].as_u64().unwrap_or(0), item["column"].as_u64().unwrap_or(0));
    found.sort_by_key(at);
    found
}

/// A coverage report for authors: its `summary`, the `uncovered` entries
/// and the `excluded` ones, in file order.
pub fn report(coverage: &Value) -> Value {
    json!({
        "summary": summary(coverage),
        "uncovered": listed(coverage, |entry| entry.get("excluded").is_none() && entry["count"].as_u64().unwrap_or(0) == 0),
        "excluded": listed(coverage, |entry| entry.get("excluded").is_some()),
    })
}

/// A summary in one line: `functions 12/14 (85.7%), expressions …`.
pub fn summary_text(summary: &Value) -> String {
    CATEGORIES
        .iter()
        .map(|category| {
            let totals = &summary[*category];
            format!("{category} {}/{} ({}%)", totals["covered"], totals["total"], totals["percent"])
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// A report as text: the summary, then each uncovered entry as
/// `<file>:<line>:<column> <message>`, indented by `indent`.
pub fn text(file: &str, report: &Value, indent: &str) -> String {
    let mut text = format!("{indent}{file}: {}\n", summary_text(&report["summary"]));
    for item in report["uncovered"].as_array().into_iter().flatten() {
        text.push_str(&format!(
            "{indent}  {file}:{}:{} {}\n",
            item["line"],
            item["column"],
            item["message"].as_str().unwrap_or_default()
        ));
    }
    text
}
