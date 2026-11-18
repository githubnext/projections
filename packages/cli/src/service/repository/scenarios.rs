//! `GET /api/scenarios`: a custom renderer package's sample scenarios, made
//! documents with the working tree's definition.

use std::path::PathBuf;

use anyhow::Context as _;
use serde_json::{Value, json};

use crate::{fixtures, runtime::Runner};

/// The working tree's projection `id`'s custom renderer package scenarios,
/// each extraction made a document with the working tree's definition, as
/// `{"file", "scenarios": [{"id", "title", "description"?, "before"?, "after"}
/// or {"id", "title", "error"}]}`; `file` is null without a `scenarios.json`.
pub(in crate::service) fn read(runner: &Runner, id: &str) -> anyhow::Result<Value> {
    let definitions = runner.discover("working-tree")?;
    let definition = definitions
        .iter()
        .find(|definition| definition["id"] == id)
        .with_context(|| format!("The working tree defines no projection {id}"))?;
    let Some(file) = crate::dev_server::package(&runner.repo, definition)
        .map(|package| package.join("scenarios.json"))
        .filter(|file| file.is_file())
    else {
        return Ok(json!({"file": null, "scenarios": []}));
    };
    let relative = file.strip_prefix(&runner.repo).unwrap_or(&file).to_path_buf();
    let loaded = fixtures::load(std::slice::from_ref(&file), &[], "", false, false);
    let entries = loaded.value["scenarios"].as_array().cloned().unwrap_or_default();
    // Every extraction, in order, with where it came from.
    let mut extractions = Vec::new();
    for entry in &entries {
        let subject = &entry["subject"];
        let scenario = entry["id"].as_str().unwrap_or_default();
        for side in ["before", "after", "extraction"] {
            if !subject[side].is_null() {
                extractions.push((
                    subject[side].clone(),
                    PathBuf::from(format!("{} (scenario {scenario}, {side})", relative.display())),
                ));
            }
        }
    }
    let mut documents = runner.supplied_documents(id, extractions)?.into_iter();
    let mut scenarios = Vec::new();
    for entry in &entries {
        let mut scenario = json!({"id": entry["id"], "title": entry["title"]});
        if let Some(description) = entry["description"].as_str() {
            scenario["description"] = json!(description);
        }
        if let Some(error) = entry["error"].as_str() {
            scenario["error"] = json!(error);
            scenarios.push(scenario);
            continue;
        }
        let subject = &entry["subject"];
        let sides: &[(&str, &str)] = if subject["mode"] == "comparison" {
            &[("before", "before"), ("after", "after")]
        } else {
            &[("extraction", "after")]
        };
        for (side, key) in sides {
            if subject[*side].is_null() {
                continue;
            }
            match documents.next() {
                Some(Ok(document)) => scenario[*key] = document,
                Some(Err(error)) if scenario.get("error").is_none() => {
                    scenario["error"] = json!(format!("{side}: {error:#}"));
                }
                Some(Err(_)) => {}
                None => {}
            }
        }
        if scenario.get("error").is_some() {
            scenario
                .as_object_mut()
                .unwrap()
                .retain(|key, _| ["id", "title", "description", "error"].contains(&key.as_str()));
        }
        scenarios.push(scenario);
    }
    Ok(json!({"file": relative.to_string_lossy(), "scenarios": scenarios}))
}
