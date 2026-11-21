//! Renderer bundles: their validated `renderer.json` manifests, digests and
//! the bundle a renderer package names.

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::path::Path;

use super::{
    MAX_RENDERER_BYTES, RENDERER_FILES,
    read::{json_text, local_path, read, short_sha256},
};
use crate::artifact::{self, fields, text};

/// A renderer bundle's `renderer.json` (`projections.renderer` version 0),
/// validated like the renderer SDK's `parseRendererManifest`.
pub fn renderer_manifest(value: &Value) -> Result<Value> {
    ensure!(
        value.is_object() && value["format"] == "projections.renderer" && value["version"].as_f64() == Some(0.0),
        "Unsupported renderer manifest"
    );
    fields(
        value,
        &["format", "version", "name", "title", "handles", "comparisonModes", "accepts"],
        "Renderer manifest",
    )?;
    let name = value["name"].as_str().unwrap_or_default();
    let mut characters = name.chars();
    ensure!(
        name.len() <= 64
            && characters.next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            && characters.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
        "Renderer manifest name must be a lowercase identifier"
    );
    let title = text(&value["title"], "Renderer manifest title")
        .ok()
        // Characters (code points), as renderer/v0's maxLength and the SDK's parser count them.
        .filter(|title| title.chars().count() <= 200)
        .context("Renderer manifest title must be 1-200 characters")?;
    let handles = value["handles"]
        .as_array()
        .filter(|handles| {
            handles.len() <= 100
                && handles.iter().all(|handle| {
                    let handle = handle.as_str().unwrap_or_default();
                    let mut characters = handle.chars();
                    handle.len() <= 64
                        && characters.next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
                        && characters.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "/.-".contains(c))
                })
        })
        .context("Renderer manifest handles must be renderer names")?;
    let mut manifest = json!({
        "format": "projections.renderer", "version": 0,
        "name": name, "title": title, "handles": handles,
    });
    if let Some(modes) = value.get("comparisonModes") {
        const MODES: [&str; 4] = ["animated", "side-by-side", "swipe", "diff"];
        let valid = modes.as_array().is_some_and(|modes| {
            let names: Vec<_> = modes.iter().filter_map(Value::as_str).collect();
            !names.is_empty()
                && names.len() == modes.len()
                && names.iter().all(|mode| MODES.contains(mode))
                && names.iter().enumerate().all(|(index, mode)| !names[..index].contains(mode))
        });
        ensure!(valid, "Renderer manifest comparisonModes must be distinct comparison modes");
        manifest["comparisonModes"] = modes.clone();
    }
    if let Some(accepts) = value.get("accepts") {
        let valid = accepts.as_array().is_some_and(|items| {
            !items.is_empty()
                && items.len() <= 32
                && items.iter().enumerate().all(|(index, item)| {
                    let schema = item["schema"].as_str().unwrap_or_default();
                    let vocabulary = item.get("vocabulary");
                    item.as_object()
                        .is_some_and(|object| object.keys().all(|key| key == "schema" || key == "vocabulary"))
                        && projections_engine::SCHEMAS.contains(&schema)
                        && vocabulary.is_none_or(|vocabulary| projections_engine::VOCABULARIES.iter().any(|(name, _)| vocabulary == name))
                        && !items[..index].contains(item)
                })
        });
        ensure!(
            valid,
            "Renderer manifest accepts must be distinct domain schemas, each with an optional vocabulary"
        );
        manifest["accepts"] = accepts.clone();
    }
    Ok(manifest)
}

/// The bundle directory a package's `package.json` names in `projections.renderer`.
pub(super) fn package_bundle(manifest: &Path) -> Result<String> {
    let bytes = read(manifest, artifact::MAX_ARTIFACT_BYTES)
        .context("A renderer directory holds index.html and renderer.json, or a package.json naming projections.renderer")?;
    let package: Value = serde_json::from_slice(&bytes).context("Renderer package.json is not valid JSON")?;
    Ok(local_path(&package["projections"]["renderer"], "package.json projections.renderer")?.to_owned())
}

/// A bundle's validated manifest and its digest, which changes only when the
/// bundle's `index.html` or `renderer.json` bytes change.
pub(super) fn bundle(directory: &Path) -> Result<(Value, String)> {
    let mut bytes = Vec::new();
    let mut manifest = Value::Null;
    for name in RENDERER_FILES {
        let file = read(&directory.join(name), MAX_RENDERER_BYTES).with_context(|| format!("Renderer bundle {name} is unavailable"))?;
        if name == "renderer.json" {
            manifest = renderer_manifest(&json_text(&file, "renderer.json")?)?;
        }
        bytes.extend_from_slice(&file);
    }
    Ok((manifest, short_sha256(&bytes)))
}
