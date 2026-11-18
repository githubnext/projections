//! A target's build settings in one configuration, layered as Xcode layers
//! them: defaults, the project's xcconfig and settings, then the target's
//! xcconfig and settings, each `$(inherited)` taking the layer below.

mod expand;

use crate::project::Project;
use anyhow::Result;
use projections_extractor_sdk::Context;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub(crate) use expand::expand;

pub(crate) type Settings = BTreeMap<String, String>;

/// The configuration a target's settings come from: `requested`, or its
/// configuration list's default (else its first).
pub(crate) fn configuration<'a>(project: &'a Project, target: &'a Map<String, Value>, requested: Option<&'a str>) -> Option<&'a str> {
    let (_, list) = project.follow(target, "buildConfigurationList")?;
    if let Some(requested) = requested {
        return Some(requested);
    }
    list.get("defaultConfigurationName")
        .and_then(Value::as_str)
        .or_else(|| project.each(list, "buildConfigurations").next()?.1.get("name")?.as_str())
}

/// The settings of `target` (or of the project when `None`) in `configuration`.
pub(crate) fn settings(cx: &Context, project: &Project, target: Option<&Map<String, Value>>, configuration: &str) -> Result<Settings> {
    let mut settings = Settings::new();
    if let Some(target) = target {
        let name = target.get("name").and_then(Value::as_str).unwrap_or_default();
        settings.insert("TARGET_NAME".into(), name.into());
        settings.insert("PRODUCT_NAME".into(), "$(TARGET_NAME)".into());
        settings.insert("PRODUCT_MODULE_NAME".into(), "$(PRODUCT_NAME:c99extidentifier)".into());
    }
    let name = crate::basename(&project.path).trim_end_matches(".xcodeproj").to_owned();
    settings.insert("PROJECT_NAME".into(), name);
    let owners = [Some(project.root_object()), target];
    for owner in owners.into_iter().flatten() {
        let Some(found) = project.follow(owner, "buildConfigurationList").and_then(|(_, list)| {
            project
                .each(list, "buildConfigurations")
                .find(|(_, c)| c.get("name").and_then(Value::as_str) == Some(configuration))
        }) else {
            continue;
        };
        let (_, config) = found;
        if let Some(path) = project
            .follow(config, "baseConfigurationReference")
            .and_then(|(id, _)| project.paths.get(id))
        {
            layer(&mut settings, xcconfig(cx, path, 0)?);
        }
        let own = config.get("buildSettings").and_then(Value::as_object).map(|settings| {
            settings
                .iter()
                .filter_map(|(key, value)| Some((key.clone(), text(value)?)))
                .collect::<Vec<_>>()
        });
        layer(&mut settings, own.unwrap_or_default());
    }
    Ok(settings)
}

/// A setting's value: a string, or a list joined by spaces.
fn text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => Some(items.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ")),
        _ => None,
    }
}

/// Adds `values` over `settings`, `$(inherited)` taking what each had.
/// Conditional settings (`KEY[sdk=iphoneos*]`) are left out.
fn layer(settings: &mut Settings, values: Vec<(String, String)>) {
    for (key, value) in values {
        if key.contains('[') {
            continue;
        }
        let below = settings.get(&key).cloned().unwrap_or_default();
        let value = value.replace("$(inherited)", &below).replace("${inherited}", &below);
        settings.insert(key, value.trim().to_owned());
    }
}

/// The settings an xcconfig file sets, with its `#include`s first.
fn xcconfig(cx: &Context, path: &str, depth: usize) -> Result<Vec<(String, String)>> {
    let mut values = Vec::new();
    if depth > 16 || !cx.exists(path)? {
        return Ok(values);
    }
    for line in cx.read_source(path)?.lines() {
        let line = line.trim();
        if let Some(include) = line.strip_prefix("#include?").or_else(|| line.strip_prefix("#include")) {
            let included = include.trim().trim_matches('"');
            let included = crate::project::normalize(&crate::join(&crate::parent_dir(path), included));
            values.extend(xcconfig(cx, &included, depth + 1)?);
        } else if let Some((key, value)) = line.split_once('=')
            && !line.starts_with("//")
        {
            let value = value.split(" //").next().unwrap_or(value).trim().trim_end_matches(';');
            values.push((key.trim().to_owned(), value.trim().to_owned()));
        }
    }
    Ok(values)
}
