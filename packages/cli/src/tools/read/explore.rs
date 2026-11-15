//! `explore`: the built-in projections that apply to a repository.

use std::fmt::Write as _;

use serde_json::{Value, json};

use super::super::{Answer, Outcome, get, plural, text};
use crate::service::Service;

pub(in crate::tools) async fn explore(service: &Service) -> Answer {
    let body = get(service, "/api/explore").await?;
    let candidates: Vec<&Value> = body["candidates"].as_array().into_iter().flatten().collect();
    let mut out = String::new();
    if candidates.is_empty() {
        out.push_str("No built-in projection applies to this repository. Build one for what the person wants to see: projections init <id> (see the projections skill).\n");
    } else {
        let _ = writeln!(
            out,
            "{} apply to this repository{}:",
            plural(candidates.len(), "built-in projection", "built-in projections"),
            if body["session"] == true {
                " (it defines none of its own yet)"
            } else {
                ""
            }
        );
    }
    let mut items = Vec::new();
    for candidate in &candidates {
        let mut notes = Vec::new();
        if let Some(adopted) = candidate["adopted"].as_str() {
            notes.push(format!("adopted as {adopted}"));
        }
        if candidate["requiresTrust"] == true {
            notes.push("runs repository code: needs trust".to_owned());
        }
        let reason = crate::explore::basis_text(candidate);
        let _ = writeln!(
            out,
            "- {}: {}. Why: {reason}{}",
            text(&candidate["id"]),
            text(&candidate["title"]),
            if notes.is_empty() {
                String::new()
            } else {
                format!(" ({})", notes.join("; "))
            }
        );
        if let Some(description) = candidate["description"].as_str() {
            let _ = writeln!(out, "  {description}");
        }
        items.push(
            json!({"id": candidate["id"], "title": candidate["title"], "description": candidate["description"],
            "reason": reason, "basis": candidate["basis"], "adopted": candidate["adopted"],
            "requiresTrust": candidate["requiresTrust"]}),
        );
    }
    if !candidates.is_empty() {
        out.push_str("\nSweep them to see what each shows on recent changes; adopt only the ones the person chooses.\n");
    }
    Ok(Outcome::new(out, json!({"session": body["session"], "candidates": items})))
}
