//! Renderer fixture scenarios as data: every `projections.scenarios` document
//! in the revision, each scenario with the renderer that draws it and its
//! synthetic extraction, or its before and after and their comparison. The
//! `gallery` renderer presents them, nested; nothing here runs repository code.

use anyhow::{Context as _, Result, bail, ensure};
use projections_extractor_sdk::{
    ComparisonRequest, Context, Descriptor, Trust, extraction, glob, globs, key, normalize_extraction, object, relationship,
};
use regex::Regex;
use serde_json::{Map, Value, json};

pub const ID: &str = "renderer-scenarios";
/// The vocabulary its extractions declare, which the `gallery` renderer accepts.
pub const VOCABULARY: &str = "scenarios/v0";
/// The documents read by default.
const DEFAULT_INCLUDE: &str = "**/scenarios.json";
/// The bounds the scenarios contract sets (docs/contracts/scenarios.md).
const MAX_DOCUMENT_BYTES: usize = 32 * 1024 * 1024;
const MAX_COMPARATOR_BYTES: usize = 16 * 1024 * 1024;
const MAX_SCENARIOS: usize = 1000;
const SCENARIO_FIELDS: &[&str] = &[
    "id",
    "title",
    "group",
    "description",
    "renderer",
    "before",
    "after",
    "extraction",
    "comparator",
    "presentation",
];

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Renderer scenarios",
        description: "Renderer fixture scenarios (projections.scenarios documents) with their synthetic extractions and comparisons",
        schema: "graph/v0",
        renderer: "gallery",
        trust: Trust::None,
        access: projections_extractor_sdk::Access::Files,
        determinism: projections_extractor_sdk::Determinism::Pure,
        inputs: json!({
            "include": "Globs of projections.scenarios documents to read; default **/scenarios.json",
            "exclude": "Globs of documents to leave out"
        }),
        template_inputs: None,
        detects: &["**/scenarios.json"],
    }
}

/// It reads files and compares them in the comparator sandbox: never trust.
pub fn requires_trust(_inputs: &Value) -> bool {
    false
}

pub fn collect(cx: &Context) -> Result<Value> {
    let inputs = &cx.definition()["inputs"];
    let mut include = globs(inputs.get("include"), "inputs.include")?;
    if include.is_empty() {
        include.push(glob(DEFAULT_INCLUDE)?);
    }
    let exclude = globs(inputs.get("exclude"), "inputs.exclude")?;
    let matches = |path: &str, patterns: &[Regex]| patterns.iter().any(|pattern| pattern.is_match(path));
    let paths: Vec<String> = cx
        .files()?
        .iter()
        .filter(|path| matches(path, &include) && !matches(path, &exclude))
        .cloned()
        .collect();
    let mut entities = vec![];
    let mut relationships = vec![];
    let mut documents = 0;
    for path in paths {
        let Some(document) = read_document(cx, &path)? else {
            continue;
        };
        documents += 1;
        Document { cx, path: &path }.collect(&document, &mut entities, &mut relationships)?;
    }
    let metadata = json!({
        "source": "projections.scenarios documents and the fixtures they name",
        "documents": documents,
        "limitations": ["Custom renderer bundles are named, not run: only built-in renderers draw nested."]
    });
    let mut result = extraction("graph/v0", entities, relationships, Some(metadata));
    result["vocabularies"] = json!([VOCABULARY]);
    Ok(result)
}

/// A `projections.scenarios` document; `None` for a matching file of another format, which is left out.
fn read_document(cx: &Context, path: &str) -> Result<Option<Value>> {
    let bytes = cx.read_bytes(path, MAX_DOCUMENT_BYTES)?;
    let text = std::str::from_utf8(&bytes).with_context(|| format!("{path} is not UTF-8"))?;
    let document = projections_extractor_sdk::parse_json(text).with_context(|| format!("{path} is not valid JSON"))?;
    if document.get("format").and_then(Value::as_str) != Some("projections.scenarios") {
        cx.diagnose(&format!("{path} is not a projections.scenarios document; left out"));
        return Ok(None);
    }
    ensure!(
        document["version"] == 0,
        "{path}: unsupported scenarios version {}",
        document["version"]
    );
    Ok(Some(document))
}

struct Document<'a> {
    cx: &'a Context,
    /// The document's project-relative path.
    path: &'a str,
}

impl Document<'_> {
    fn collect(&self, document: &Value, entities: &mut Vec<Value>, relationships: &mut Vec<Value>) -> Result<()> {
        let path = self.path;
        let fields = object(document, path)?;
        if let Some(unknown) = fields
            .keys()
            .find(|name| !["format", "version", "title", "renderer", "scenarios"].contains(&name.as_str()))
        {
            bail!("{path}: unknown field {unknown}");
        }
        let title = optional_text(document, "title", path)?;
        let scenarios = document["scenarios"]
            .as_array()
            .with_context(|| format!("{path}: scenarios must be an array"))?;
        ensure!(scenarios.len() <= MAX_SCENARIOS, "{path} has more than {MAX_SCENARIOS} scenarios");
        let default_renderer = match document.get("renderer") {
            Some(renderer) => Some(self.renderer(renderer, &format!("{path}.renderer"))?),
            None => None,
        };
        let id = key(&["scenarios", path]);
        let mut data = json!({"path": self.cx.repository_path(path)?});
        if let Some(renderer) = &default_renderer {
            data["renderer"] = json!(renderer.name);
        }
        let document_index = entities.len();
        entities.push(json!({
            "id": id, "kind": "scenarios", "label": title.unwrap_or(path), "data": data,
            "confidence": "authoritative", "evidence": [{"kind": "projections-scenarios", "source": path}]
        }));
        let mut order = vec![];
        let mut seen = std::collections::BTreeSet::new();
        for (index, scenario) in scenarios.iter().enumerate() {
            let label = format!("{path}: scenarios[{index}]");
            let scenario_id = scenario["id"].as_str().with_context(|| format!("{label}.id must be a string"))?;
            ensure!(
                !scenario_id.is_empty() && scenario_id.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)),
                "{label}.id must be filename-safe: letters, digits, `.`, `_` and `-`"
            );
            ensure!(seen.insert(scenario_id), "{path}: scenario {scenario_id} is listed twice");
            let entity = self
                .scenario(scenario, title.unwrap_or(path), default_renderer.as_ref())
                .with_context(|| format!("{path}: scenario {scenario_id}"))?;
            let scenario_key = key(&["scenario", path, scenario_id]);
            relationships.push(relationship("contains", &id, &scenario_key));
            order.push(json!(scenario_key));
            entities.push(json!({
                "id": scenario_key, "kind": "scenario", "label": entity.label, "data": entity.data,
                "confidence": "authoritative", "evidence": [{"kind": "projections-scenarios", "source": path}]
            }));
        }
        entities[document_index]["data"]["scenarios"] = Value::Array(order);
        Ok(())
    }

    fn scenario(&self, scenario: &Value, document_title: &str, default_renderer: Option<&Renderer>) -> Result<Scenario> {
        let fields = object(scenario, "scenario")?;
        if let Some(unknown) = fields.keys().find(|name| !SCENARIO_FIELDS.contains(&name.as_str())) {
            bail!("unknown field {unknown}");
        }
        let title = optional_text(scenario, "title", "scenario")?.context("title is required")?;
        let renderer = match scenario.get("renderer") {
            Some(renderer) => self.renderer(renderer, "renderer")?,
            None => default_renderer
                .cloned()
                .context("names no renderer, and its document names none")?,
        };
        let mut data = Map::new();
        data.insert("renderer".into(), json!(renderer.name));
        if let Some(bundle) = renderer.bundle {
            data.insert("bundle".into(), json!(bundle));
        }
        data.insert(
            "group".into(),
            json!(optional_text(scenario, "group", "scenario")?.unwrap_or(document_title)),
        );
        if let Some(description) = optional_text(scenario, "description", "scenario")? {
            data.insert("description".into(), json!(description));
        }
        if let Some(presentation) = scenario.get("presentation") {
            object(presentation, "presentation")?;
            data.insert("presentation".into(), presentation.clone());
        }
        match (scenario.get("extraction"), scenario.get("before"), scenario.get("after")) {
            (Some(extraction), None, None) => {
                ensure!(scenario.get("comparator").is_none(), "comparator requires before and after");
                data.insert("mode".into(), json!("extraction"));
                data.insert("extraction".into(), self.extraction(extraction, "extraction")?);
            }
            (None, Some(before), Some(after)) => {
                let before = self.extraction(before, "before")?;
                let after = self.extraction(after, "after")?;
                ensure!(before["schema"] == after["schema"], "before and after must share one domain schema");
                let (comparator, comparison) = self.compare(scenario.get("comparator"), &before, &after)?;
                data.insert("mode".into(), json!("comparison"));
                data.insert("before".into(), before);
                data.insert("after".into(), after);
                data.insert("comparison".into(), comparison);
                data.insert("comparator".into(), json!(comparator));
            }
            (Some(_), _, _) => bail!("has either extraction or before and after, not both"),
            _ => bail!("requires extraction, or before and after"),
        }
        Ok(Scenario {
            label: title.to_owned(),
            data: Value::Object(data),
        })
    }

    /// A renderer name, or a custom bundle: `{"bundle": "<directory>"}`, named by its manifest when the revision has it.
    fn renderer(&self, value: &Value, label: &str) -> Result<Renderer> {
        if let Some(name) = value.as_str() {
            ensure!(
                identifier(name),
                "{label} must be a renderer name: 1 to 100 letters, digits, `.`, `_` and `-`, starting with a letter or digit"
            );
            return Ok(Renderer {
                name: name.to_owned(),
                bundle: None,
            });
        }
        let fields = object(value, label)?;
        ensure!(
            fields.len() == 1 && fields.contains_key("bundle"),
            "{label} must be a renderer name or {{\"bundle\": \"<directory>\"}}"
        );
        let bundle = self.resolve(&value["bundle"], &format!("{label}.bundle"))?;
        let manifest = format!("{bundle}/renderer.json");
        let name = if self.cx.exists(&manifest)? {
            self.cx.read_json(&manifest)?["name"]
                .as_str()
                .filter(|name| renderer_name(name))
                .map(str::to_owned)
        } else {
            None
        };
        Ok(Renderer {
            name: name.unwrap_or_else(|| "custom".to_owned()),
            bundle: Some(self.cx.repository_path(&bundle)?),
        })
    }

    /// An inline extraction, or a path to a JSON file holding one or a saved `projections.extraction` document;
    /// normalized by the Engine.
    fn extraction(&self, value: &Value, label: &str) -> Result<Value> {
        let raw = if value.is_object() {
            value.clone()
        } else {
            let path = self.resolve(value, label)?;
            let bytes = self.cx.read_bytes(&path, MAX_DOCUMENT_BYTES)?;
            let text = std::str::from_utf8(&bytes).with_context(|| format!("{label} {path} is not UTF-8"))?;
            let document = projections_extractor_sdk::parse_json(text).with_context(|| format!("{label} {path} is not valid JSON"))?;
            match document.get("format").and_then(Value::as_str) {
                Some("projections.extraction") => document["extraction"].clone(),
                Some(format) => bail!("{label} {path} is a {format} document, not an extraction"),
                None => document,
            }
        };
        normalize_extraction(&raw).with_context(|| format!("{label} is not a valid extraction"))
    }

    /// The comparison of `before` and `after` by the scenario's comparator, and its name: `default`, or the
    /// comparator file's repository-relative path. A comparator file is data, read from this revision.
    fn compare(&self, value: Option<&Value>, before: &Value, after: &Value) -> Result<(String, Value)> {
        let empty = json!({});
        let (file, options) = match value {
            None => (None, &empty),
            Some(Value::String(_)) => (value, &empty),
            Some(comparator) => {
                let fields = object(comparator, "comparator")?;
                if let Some(unknown) = fields.keys().find(|name| !["file", "options"].contains(&name.as_str())) {
                    bail!("comparator has an unknown field {unknown}");
                }
                let options = comparator.get("options").unwrap_or(&empty);
                object(options, "comparator.options")?;
                (comparator.get("file"), options)
            }
        };
        let Some(file) = file else {
            let comparison = self.cx.compare(&ComparisonRequest {
                before,
                after,
                options,
                file: None,
            })?;
            return Ok(("default".to_owned(), comparison));
        };
        let path = self.resolve(file, "comparator")?;
        ensure!(
            path.ends_with(".comparator.yaml") || path.ends_with(".comparator.yml"),
            "comparator must name a comparator file, ending in `.comparator.yaml` or `.comparator.yml`"
        );
        let rules = self.cx.read_bytes(&path, MAX_COMPARATOR_BYTES)?;
        let repository = self.cx.repository_path(&path)?;
        let comparison = self.cx.compare(&ComparisonRequest {
            before,
            after,
            options,
            file: Some((&repository, &rules)),
        })?;
        Ok((repository, comparison))
    }

    /// A path the document names, relative to it, as a normalized project-relative path. It may use `..` but never
    /// leave the project, and is never absolute or a URL.
    fn resolve(&self, value: &Value, label: &str) -> Result<String> {
        let written = value.as_str().with_context(|| format!("{label} must be a relative path"))?;
        ensure!(
            !written.is_empty() && !written.starts_with('/') && !written.contains('\\') && !written.contains(':'),
            "{label} must be a relative path, never absolute or a URL: {written}"
        );
        let mut parts: Vec<&str> = self.path.split('/').collect();
        parts.pop();
        for part in written.split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    ensure!(parts.pop().is_some(), "{label} {written} leaves the project");
                }
                part => parts.push(part),
            }
        }
        ensure!(!parts.is_empty(), "{label} {written} names the project itself");
        Ok(parts.join("/"))
    }
}

struct Scenario {
    label: String,
    data: Value,
}

#[derive(Clone)]
struct Renderer {
    name: String,
    /// A custom bundle's repository-relative directory.
    bundle: Option<String>,
}

/// The scenarios schema's renderer `Identifier`. A name no built-in renderer has is the gallery's to report, per scenario.
fn identifier(name: &str) -> bool {
    let bytes = name.as_bytes();
    (1..=100).contains(&bytes.len())
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

/// A renderer manifest's `name`: stricter than an identifier, as hosts register it.
fn renderer_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    (1..=64).contains(&bytes.len())
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

fn optional_text<'a>(value: &'a Value, field: &str, label: &str) -> Result<Option<&'a str>> {
    match value.get(field) {
        None => Ok(None),
        Some(Value::String(text)) if !text.trim().is_empty() => Ok(Some(text)),
        Some(_) => bail!("{label}.{field} must be a nonempty string"),
    }
}
