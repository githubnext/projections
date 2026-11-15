//! `describe_part`: the built-in extractors, renderers and comparators a
//! definition can name, from the catalogs this build embeds.

use std::fmt::Write as _;

use serde_json::{Value, json};

use crate::help_text;
use crate::tools::{Answer, Failure, Outcome, text};

pub(in crate::tools) fn describe_part(input: &Value) -> Answer {
    let id = input["id"].as_str();
    match text(&input["part"]) {
        "extractor" => describe_extractor(id),
        "renderer" => describe_renderer(id),
        _ => describe_comparator(id),
    }
}

/// The built-in extractors, or the one named `id`.
fn describe_extractor(id: Option<&str>) -> Answer {
    let mut out = String::new();
    let catalog = crate::collectors::catalog();
    let extractors: Vec<&Value> = catalog["extractors"].as_array().into_iter().flatten().collect();
    let Some(id) = id else {
        let _ = writeln!(out, "Built-in extractors (\"extractor\": \"<id>\" in a definition):");
        for extractor in &extractors {
            let _ = writeln!(
                out,
                "- {}: {} (schema {}{})",
                text(&extractor["id"]),
                text(&extractor["title"]),
                text(&extractor["schema"]),
                if extractor["trust"] == "none" {
                    ""
                } else {
                    "; runs repository code: needs trust"
                }
            );
        }
        let ids: Vec<&Value> = extractors.iter().map(|extractor| &extractor["id"]).collect();
        return Ok(Outcome::new(out, json!({"part": "extractor", "ids": ids})));
    };
    let extractor = extractors.iter().find(|extractor| extractor["id"] == id).ok_or_else(|| {
        Failure(format!(
            "No built-in extractor {id}; describe_part with part extractor and no id lists them"
        ))
    })?;
    let _ = writeln!(
        out,
        "{} [{id}]\n{}\nSchema: {}. Default renderer: {}. Runs repository code: {}.",
        text(&extractor["title"]),
        text(&extractor["description"]),
        text(&extractor["schema"]),
        text(&extractor["renderer"]),
        if extractor["trust"] == "none" {
            "no"
        } else {
            "yes, so it needs trust"
        }
    );
    if let Some(inputs) = extractor["inputs"].as_object().filter(|inputs| !inputs.is_empty()) {
        out.push_str("Inputs (the definition's \"inputs\"):\n");
        for (name, description) in inputs {
            let _ = writeln!(out, "- {name}: {}", text(description));
        }
    }
    let _ = writeln!(
        out,
        "Definition template:\n{}",
        serde_json::to_string_pretty(&extractor["template"]).unwrap_or_default()
    );
    Ok(Outcome::new(out, json!({"part": "extractor", "extractor": extractor})))
}

/// The built-in renderers, or the one named `id`.
fn describe_renderer(id: Option<&str>) -> Answer {
    let mut out = String::new();
    let manifests: Vec<Value> = crate::assets::inspector_asset("renderers/index.json")
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|index| index["renderers"].as_array().cloned())
        .unwrap_or_default();
    let handles = |manifest: &Value| -> Vec<String> {
        manifest["handles"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|handle| handle.as_str().map(str::to_owned))
            .collect()
    };
    let schemas = |manifest: &Value| -> Vec<String> {
        manifest["accepts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|accepted| accepted["schema"].as_str().map(str::to_owned))
            .collect()
    };
    let Some(id) = id else {
        let _ = writeln!(out, "Built-in renderers (\"renderer\": \"<name>\" in a definition):");
        for manifest in &manifests {
            let _ = writeln!(
                out,
                "- {}: {}. Names: {}. Accepts {}.",
                text(&manifest["name"]),
                text(&manifest["title"]),
                handles(manifest).join(", "),
                schemas(manifest).join(", ")
            );
        }
        if manifests.is_empty() {
            out.push_str("This build embeds no renderers.\n");
        }
        let names: Vec<&Value> = manifests.iter().map(|manifest| &manifest["name"]).collect();
        return Ok(Outcome::new(out, json!({"part": "renderer", "names": names})));
    };
    let manifest = manifests
        .iter()
        .find(|manifest| manifest["name"] == id || handles(manifest).iter().any(|handle| handle == id))
        .ok_or_else(|| Failure(format!("No built-in renderer {id}; describe_part with part renderer and no id lists them, and a custom renderer is {{\"bundle\": dir}}")))?;
    let _ = writeln!(
        out,
        "{} [{}]\nNames a definition can use: {}.\nAccepts extractions of {}.\nComparison modes: {}.\nUse it: \"renderer\": \"{id}\".",
        text(&manifest["title"]),
        text(&manifest["name"]),
        handles(manifest).join(", "),
        schemas(manifest).join(", "),
        manifest["comparisonModes"]
            .as_array()
            .map(|modes| modes.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", "))
            .filter(|modes| !modes.is_empty())
            .unwrap_or_else(|| "side-by-side and animated".to_owned())
    );
    Ok(Outcome::new(out, json!({"part": "renderer", "renderer": manifest})))
}

/// The comparators: the default one, a custom comparator file, or both.
fn describe_comparator(id: Option<&str>) -> Answer {
    let default = help_text::from_markdown(include_str!("describe-part/default-comparator.md"));
    let rules = help_text::from_markdown(include_str!("describe-part/custom-comparator.md"));
    let (text, id) = match id {
        None => (format!("{default}\n\n{rules}\n"), Value::Null),
        Some("default") => (format!("{default}\n"), json!("default")),
        Some("custom") => (format!("{rules}\n"), json!("custom")),
        Some(other) => {
            return Err(Failure(format!("No comparator {other}: the comparators are default and custom")));
        }
    };
    Ok(Outcome::new(text, json!({"part": "comparator", "id": id})))
}
