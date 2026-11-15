//! Tools that read projections: listing them, comparing revisions and
//! exploring candidates over history.

mod compare;
mod explore;
mod steps;
mod sweep;

use std::fmt::Write as _;

use serde_json::{Value, json};

use super::{Answer, Failure, OnDrop, Outcome, POLL, TRUST_HINT, encode, get, plural, post, text};
use crate::service::Service;

pub(super) use compare::compare;
#[cfg(test)]
pub(super) use compare::summarize_comparison;
pub(super) use explore::explore;
#[cfg(test)]
pub(super) use sweep::summarize_sweep;
pub(super) use sweep::sweep;

/// A definition's part in words.
pub(crate) fn part_text(name: &str, value: &Value) -> String {
    match (name, value) {
        ("comparator", Value::Null) => "default".to_owned(),
        ("comparator", Value::String(file)) => format!("custom {file}"),
        ("comparator", value) if value["file"].is_string() => {
            format!("custom {}", text(&value["file"]))
        }
        ("comparator", value) => format!("default with options {}", value["options"]),
        (_, Value::String(id)) => id.clone(),
        ("extractor", value) if value["command"].is_array() => {
            let argv: Vec<&str> = value["command"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            format!("command `{}`", argv.join(" "))
        }
        ("renderer", value) if value["bundle"].is_string() => {
            format!("custom bundle {}", text(&value["bundle"]))
        }
        (_, value) => value.to_string(),
    }
}

pub(super) async fn list_projections(service: &Service, input: &Value) -> Answer {
    let reference = input["ref"].as_str().unwrap_or("working-tree");
    let body = get(service, &format!("/api/definitions?ref={}", encode(reference))).await?;
    let policies: Vec<&Value> = body["policies"].as_array().into_iter().flatten().collect();
    let mut out = String::new();
    let mut projections = Vec::new();
    let definitions: Vec<&Value> = body["definitions"].as_array().into_iter().flatten().collect();
    let explore = service.explore();
    let _ = writeln!(
        out,
        "{} at {reference}{}{}",
        plural(definitions.len(), "projection", "projections"),
        if explore {
            " (explore candidates: this repository defines no projections of its own yet; adopt the ones the person chooses)"
        } else {
            ""
        },
        if definitions.is_empty() { "." } else { ":" }
    );
    for definition in &definitions {
        let id = text(&definition["id"]);
        let policy = policies.iter().find(|policy| policy["id"] == id).copied().unwrap_or(&Value::Null);
        let title = definition["title"].as_str().unwrap_or(id);
        let (extractor, renderer, comparator) = (
            part_text("extractor", &definition["extractor"]),
            part_text("renderer", &definition["renderer"]),
            part_text("comparator", &definition["comparator"]),
        );
        let requires_trust = policy["requiresTrust"] == true;
        let renderer_trust = policy["rendererRequiresTrust"] == true;
        let _ = writeln!(
            out,
            "- {id}: {title}. Extractor {extractor}; renderer {renderer}; comparator {comparator}{}{}",
            if requires_trust {
                "; runs repository code (needs trust)"
            } else {
                ""
            },
            if renderer_trust { "; custom renderer (needs trust)" } else { "" }
        );
        projections.push(json!({"id": id, "title": title, "extractor": definition["extractor"],
            "renderer": definition["renderer"], "comparator": definition["comparator"],
            "requiresTrust": requires_trust, "rendererRequiresTrust": renderer_trust}));
    }
    let invalid: Vec<&Value> = body["invalid"].as_array().into_iter().flatten().collect();
    if !invalid.is_empty() {
        let _ = writeln!(out, "Invalid definition files ({}):", invalid.len());
        for failure in &invalid {
            let _ = writeln!(out, "- {}", crate::runtime::invalid_summary(failure));
        }
    }
    let authorized = body["executionAuthorized"] == true;
    if !authorized && projections.iter().any(|item| item["requiresTrust"] == true) {
        let _ = writeln!(
            out,
            "Repository code doesn't run here, so projections that need trust can't extract. {TRUST_HINT}."
        );
    }
    Ok(Outcome::new(
        out,
        json!({"ref": reference, "explore": explore, "executionAuthorized": authorized,
            "projections": projections, "invalid": invalid}),
    ))
}

/// Runs an extraction or comparison job to its end; cancelled with the call.
pub(super) async fn run_job(service: &Service, body: &Value) -> Result<Value, Failure> {
    let created = post(service, "/api/jobs", body).await?;
    let id = text(&created["id"]).to_owned();
    let mut cancel = OnDrop(Some(|| service.cancel_job(&id)));
    loop {
        let job = get(service, &format!("/api/jobs/{id}")).await?;
        match text(&job["status"]) {
            "running" => tokio::time::sleep(POLL).await,
            "completed" => {
                cancel.disarm();
                return Ok(job);
            }
            status => {
                cancel.disarm();
                let diagnostic = &job["diagnostics"][0];
                let mut message = diagnostic["message"]
                    .as_str()
                    .unwrap_or(if status == "cancelled" {
                        "The job was cancelled"
                    } else {
                        "The job failed"
                    })
                    .to_owned();
                if diagnostic["code"] == "TRUST_REQUIRED" {
                    let _ = write!(message, ". {TRUST_HINT}.");
                }
                return Err(Failure(message));
            }
        }
    }
}
