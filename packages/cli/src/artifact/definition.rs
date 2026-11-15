//! Projection definitions: validation, defaults and the files they name.

use anyhow::{Context, Result, ensure};
use serde_json::{Map, Value, json};

use super::{
    FieldError, default_comparator_options, fields, identifier, object, parse,
    presentation::presentation_defaults,
    text,
    values::{repository_path, reproducibility, safe_positive_integer, strings},
};

/// Where custom comparators are documented, for messages about the forms they replaced.
pub const COMPARATOR_DOCS: &str = concat!(crate::docs_base!(), "docs/guides/comparators.md");

/// A comparator file's path: relative to the project, ending in `.comparator.yaml`
/// or `.comparator.yml`.
fn comparator_file<'a>(value: &'a Value, label: &str) -> Result<&'a str> {
    let path = repository_path(value, label)?;
    if !projections_comparator_runtime::is_comparator_file(path) {
        return Err(FieldError {
            pointer: format!("/{}", label.replace('.', "/")),
            message: format!(
                "{label} must name a comparator file, ending in `.comparator.yaml` or `.comparator.yml` (for example `{}`). See {COMPARATOR_DOCS}",
                suggested_comparator_file(path)
            ),
        }
        .into());
    }
    Ok(path)
}

/// The comparator file name a wrongly named path most likely means.
fn suggested_comparator_file(path: &str) -> String {
    let stem = [".rules.yaml", ".rules.yml", ".yaml", ".yml", ".json"]
        .iter()
        .find_map(|suffix| path.strip_suffix(suffix))
        .unwrap_or(path);
    format!("{stem}.comparator.yaml")
}

pub(super) fn sources(value: &Value, normalized: &mut Value, label: &str) -> Result<()> {
    if let Some(paths) = value.get("sources") {
        let paths = strings(paths, &format!("{label}.sources"))?;
        let paths = paths.as_array().unwrap();
        ensure!(paths.len() <= 256, "{label}.sources allows at most 256 paths");
        for (index, path) in paths.iter().enumerate() {
            repository_path(path, &format!("{label}.sources[{index}]"))?;
        }
        normalized["sources"] = json!(paths);
    }
    Ok(())
}

/// Every repository path whose content belongs to the definition's components
/// (declared relative to its project; see [`crate::project::check`]).
/// A custom comparator's comparator file always belongs to it, declared or not, so
/// the definition digest identifies exactly what explains a comparison.
pub fn definition_sources(definition: &Value) -> Vec<String> {
    let mut paths: Vec<String> = ["extractor", "comparator", "renderer"]
        .iter()
        .filter_map(|component| definition[component]["sources"].as_array())
        .flatten()
        .chain(definition["comparator"].get("file"))
        .filter_map(|path| crate::project::resolve(path.as_str()?).ok())
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

pub fn validate_definition(value: &Value) -> Result<Value> {
    fields(
        value,
        &[
            "id",
            "title",
            "description",
            "extractor",
            "comparator",
            "renderer",
            "inputs",
            "correspondence",
            "execution",
            "presentation",
        ],
        "Projection definition",
    )?;
    let id = identifier(&value["id"], "projection.id")?;
    let renderer = normalized_renderer(value)?;
    let extractor = normalized_extractor(value)?;
    let mut result = json!({"id": id, "renderer": renderer, "extractor": extractor});
    for key in ["title", "description"] {
        if let Some(value) = value.get(key) {
            result[key] = json!(text(value, key)?);
        }
    }
    if let Some(comparator) = value.get("comparator") {
        result["comparator"] = normalized_comparator(comparator)?;
    }
    if let Some(inputs) = value.get("inputs") {
        let inputs = parse(&serde_json::to_string(inputs)?)?;
        object(&inputs, "inputs")?;
        result["inputs"] = inputs;
    }
    if let Some(correspondence) = value.get("correspondence") {
        result["correspondence"] = normalized_correspondence(correspondence)?;
    }
    if let Some(execution) = value.get("execution") {
        result["execution"] = normalized_execution(execution)?;
    }
    if let Some(presentation) = value.get("presentation") {
        result["presentation"] = presentation_defaults(presentation)?;
    }
    Ok(result)
}

/// A definition's `renderer`: a built-in renderer's name, or a custom renderer bundle.
fn normalized_renderer(value: &Value) -> Result<Value> {
    Ok(if value["renderer"].is_string() {
        json!(identifier(&value["renderer"], "projection.renderer")?)
    } else {
        fields(&value["renderer"], &["bundle", "sources"], "renderer")?;
        let mut renderer = json!({"bundle": repository_path(&value["renderer"]["bundle"], "renderer.bundle")?});
        sources(&value["renderer"], &mut renderer, "renderer")?;
        renderer
    })
}

/// A definition's `extractor`: a built-in extractor's ID, or a command.
fn normalized_extractor(value: &Value) -> Result<Value> {
    Ok(if value["extractor"].is_string() {
        json!(text(&value["extractor"], "extractor")?)
    } else {
        fields(&value["extractor"], &["command", "sources", "upstream"], "extractor")?;
        let command = value["extractor"]["command"]
            .as_array()
            .context("extractor.command must contain 1-256 executable argv elements")?;
        ensure!(
            !command.is_empty() && command.len() <= 256,
            "extractor.command must contain 1-256 executable argv elements"
        );
        for (index, argument) in command.iter().enumerate() {
            let argument = argument.as_str().context("Invalid executable argv")?;
            ensure!(
                !argument.contains('\0') && (index != 0 || !argument.is_empty()),
                "Invalid executable argv"
            );
        }
        let mut extractor = json!({"command": command});
        sources(&value["extractor"], &mut extractor, "extractor")?;
        if let Some(upstream) = value["extractor"].get("upstream") {
            extractor["upstream"] = super::upstream::normalized_upstream(upstream, value["id"].as_str().unwrap_or_default())?;
        }
        extractor
    })
}

/// A definition's `comparator`: a string or an object with `file` is a custom
/// comparator; an object without `file` is the default comparator.
fn normalized_comparator(comparator: &Value) -> Result<Value> {
    Ok(if comparator.is_string() {
        json!({"file": comparator_file(comparator, "comparator")?})
    } else {
        object(comparator, "comparator")?;
        if comparator.get("module").is_some() {
            return Err(FieldError {
                pointer: "/comparator/module".to_owned(),
                message: format!(
                    "Module comparators were removed; name a comparator file instead: `\"comparator\": \"<path>.comparator.yaml\"`. See {COMPARATOR_DOCS}"
                ),
            }
            .into());
        }
        if comparator.get("rules").is_some() {
            return Err(FieldError {
                pointer: "/comparator/rules".to_owned(),
                message: format!(
                    "`comparator.rules` was renamed: name the file directly, `\"comparator\": \"<path>.comparator.yaml\"`, or `{{\"file\": \"<path>.comparator.yaml\", \"options\": {{...}}}}`; comparator files end in `.comparator.yaml`. See {COMPARATOR_DOCS}"
                ),
            }
            .into());
        }
        if let Some(file) = comparator.get("file") {
            fields(comparator, &["file", "sources", "options"], "comparator")?;
            let mut normalized = json!({"file": comparator_file(file, "comparator.file")?});
            sources(comparator, &mut normalized, "comparator")?;
            if let Some(options) = comparator.get("options") {
                let options = parse(&serde_json::to_string(options)?)?;
                object(&options, "comparator.options")?;
                normalized["options"] = options;
            }
            normalized
        } else {
            fields(comparator, &["options"], "comparator")?;
            match comparator.get("options") {
                Some(options) => {
                    default_comparator_options(options)?;
                    json!({"options": options})
                }
                None => json!({}),
            }
        }
    })
}

/// A definition's `correspondence`: aliases by entity ID.
fn normalized_correspondence(correspondence: &Value) -> Result<Value> {
    let mut normalized = Map::new();
    for (id, aliases) in object(correspondence, "correspondence")? {
        text(&json!(id), "correspondence ID")?;
        normalized.insert(id.clone(), strings(aliases, "correspondence aliases")?);
    }
    Ok(Value::Object(normalized))
}

/// A definition's `execution` settings.
fn normalized_execution(execution: &Value) -> Result<Value> {
    fields(
        execution,
        &["timeoutMs", "environment", "network", "reproducibility", "determinism", "scope"],
        "execution",
    )?;
    let mut normalized = json!({});
    if let Some(timeout) = execution.get("timeoutMs") {
        let timeout = safe_positive_integer(timeout, 300_000.0, "execution.timeoutMs")?;
        normalized["timeoutMs"] = json!(timeout as u64);
    }
    if let Some(environment) = execution.get("environment") {
        normalized["environment"] = strings(environment, "execution.environment")?;
        for name in normalized["environment"].as_array().unwrap() {
            let name = name.as_str().unwrap();
            ensure!(
                name.as_bytes()[0].is_ascii_alphabetic() || name.starts_with('_'),
                "Invalid environment allowlist name"
            );
            ensure!(
                name.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_'),
                "Invalid environment allowlist name"
            );
        }
    }
    if let Some(network) = execution.get("network") {
        ensure!(network.is_boolean(), "execution.network must be boolean");
        normalized["network"] = network.clone();
    }
    if let Some(value) = execution.get("reproducibility") {
        normalized["reproducibility"] = json!(reproducibility(value, "execution.reproducibility")?);
    }
    if let Some(value) = execution.get("determinism") {
        ensure!(
            value.as_str().and_then(projections_extractor_sdk::Determinism::parse).is_some(),
            "execution.determinism must be pure, environmental or observed"
        );
        normalized["determinism"] = value.clone();
    }
    if let Some(value) = execution.get("scope") {
        normalized["scope"] = scope(value)?;
    }
    Ok(normalized)
}

/// The part of a definition that determines extractions: everything except
/// `presentation`, which only sets viewers' initial settings. Definition digests
/// and comparability use it, so changing presentation defaults never makes
/// existing extractions incomparable.
pub fn semantic_definition(definition: &Value) -> Value {
    let mut semantic = definition.clone();
    if let Some(object) = semantic.as_object_mut() {
        object.remove("presentation");
    }
    semantic
}

/// A scope: 1–100 files or directories relative to the project, `/`-separated,
/// normalized without a trailing slash, sorted and unique. `.` is the project
/// itself, and leading `..` segments widen it beyond a nested project.
pub fn scope(value: &Value) -> Result<Value> {
    let paths = value.as_array().context("execution.scope must be an array of project paths")?;
    ensure!((1..=100).contains(&paths.len()), "execution.scope lists 1-100 paths");
    let mut normalized = std::collections::BTreeSet::new();
    for path in paths {
        let text = text(path, "execution.scope[]")?;
        let path = if text == "." || text == "./" {
            "."
        } else {
            text.trim_end_matches('/')
        };
        ensure!(
            !path.is_empty()
                && path.len() <= 1024
                && !path.starts_with('/')
                && !path.contains(['\\', '\0', '*', '?', '['])
                && (path == "." || super::values::project_relative(path)),
            "execution.scope paths are files or directories relative to the project (`.` is the project; `../` leaves it), not globs: {path}"
        );
        normalized.insert(path.to_owned());
    }
    Ok(json!(normalized.into_iter().collect::<Vec<_>>()))
}
