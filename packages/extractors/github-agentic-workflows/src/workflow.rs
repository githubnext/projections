//! One agentic workflow as an entity: its front matter read with gh-aw's
//! renames applied, merged with what it imports, and its lock's state.

use crate::capabilities::{Capabilities, permissions};
use crate::document::Document;
use crate::hash::Read;
use crate::imports::{Classes, Imported, imports, skills};
use crate::lock::{finding, lock};
use crate::{fields, outputs, settings, triggers};
use projections_extractor_sdk::parse_yaml;
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

/// A workflow file's name without `.md`, its label.
pub fn stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md").unwrap_or(name)
}

/// What a markdown file under the workflow globs is.
pub enum Kind {
    /// A workflow: it has triggers.
    Workflow(Map<String, Value>),
    /// Imported by workflows (no `on`), or a redirect stub: not a workflow of its own.
    Other,
    /// Front matter that isn't valid YAML, or isn't a mapping: why.
    Invalid(String),
}

pub fn classify(document: &Document) -> Kind {
    if !document.has_front {
        return Kind::Other;
    }
    match parse_yaml(&document.front, "front matter") {
        Err(error) => Kind::Invalid(format!("{error:#}")),
        Ok(Value::Object(front)) if front.contains_key("on") => Kind::Workflow(front),
        Ok(Value::Object(_) | Value::Null) => Kind::Other,
        Ok(_) => Kind::Invalid("front matter must be a mapping".to_owned()),
    }
}

/// A workflow whose front matter can't be read: only its path, and why.
pub fn invalid(path: &str, reason: &str) -> Value {
    let message = format!(
        "Its front matter can't be read, so gh-aw can't compile it: {}",
        reason.replace('`', "'")
    );
    json!({
        "id": format!("workflow:{path}"), "kind": "workflow", "label": stem(path), "confidence": "authoritative",
        "data": {"path": path, "findings": [finding("invalid", message)]},
        "evidence": [{"kind": "gh-aw-workflow", "source": path}],
    })
}

/// The workflow at `path` as an entity.
pub fn entity(path: &str, document: &Document, mut front: Map<String, Value>, classes: &Classes, read: Read) -> Value {
    let mut deprecated = fields::migrate(&mut front);
    let imported = imports(path, &front, classes, read);
    let fronts: Vec<(String, Map<String, Value>)> = imported
        .iter()
        .filter_map(|import| Some((import.entry["path"].as_str()?.to_owned(), import.front.clone()?)))
        .collect();
    let mut capabilities = Capabilities::default();
    capabilities.add(&front, None);
    let mut secrets = BTreeSet::new();
    settings::secrets(&Value::Object(front.clone()), &mut secrets);
    for (via, imported) in &fronts {
        capabilities.add(imported, Some(via));
        settings::secrets(&Value::Object(imported.clone()), &mut secrets);
    }
    let on = front.get("on");
    let full_check = on.and_then(|on| on.get("stale-check")).is_some_and(|check| check == "full");
    let inlined = front.get("inlined-imports") == Some(&Value::Bool(true));
    let (lock, mut findings) = lock(path, document, inlined, full_check, read);
    let diagnostics = diagnostics(&front, &imported, &mut deprecated);
    findings.extend(diagnostics.findings);
    let mut data = capabilities.finish();
    let text_of = |key: &str| front.get(key).filter(|value| value.is_string()).cloned().unwrap_or(Value::Null);
    data.insert("path".into(), json!(path));
    data.insert("name".into(), text_of("name"));
    data.insert("description".into(), text_of("description"));
    data.insert("engine".into(), settings::engine(&front));
    data.insert("triggers".into(), json!(triggers::triggers(on)));
    data.insert("activation".into(), triggers::activation(on));
    data.insert("permissions".into(), permissions(front.get("permissions")));
    data.insert("safeOutputs".into(), outputs::outputs(&front, &fronts));
    data.insert("secrets".into(), json!(secrets));
    data.insert(
        "imports".into(),
        json!(imported.iter().map(|import| &import.entry).collect::<Vec<_>>()),
    );
    data.insert("skills".into(), json!(skills(&front, classes)));
    data.insert("limits".into(), settings::limits(&front));
    data.insert("custom".into(), settings::custom(&front));
    data.insert("concurrency".into(), settings::concurrency(&front));
    data.insert("strict".into(), json!(front.get("strict") != Some(&Value::Bool(false))));
    data.insert("lock".into(), lock);
    data.insert("unrecognized".into(), json!(diagnostics.fields));
    data.insert("unrecognizedValues".into(), json!(diagnostics.values));
    data.insert("deprecated".into(), json!(deprecated));
    data.insert("findings".into(), json!(findings));
    let mut evidence = vec![json!({"kind": "gh-aw-workflow", "source": path})];
    for import in imported.iter().filter(|import| import.front.is_some()) {
        evidence.push(json!({"kind": "gh-aw-import", "source": import.entry["resolved"]}));
    }
    if data["lock"]["status"] != "missing" {
        evidence.push(json!({"kind": "gh-aw-lock", "source": data["lock"]["path"]}));
    }
    json!({
        "id": format!("workflow:{path}"), "kind": "workflow", "label": stem(path), "confidence": "authoritative",
        "data": data, "evidence": evidence,
    })
}

/// Fields gh-aw doesn't know, in the workflow's front matter and every file it
/// imports, and the findings for them and for renamed fields.
struct Diagnostics {
    /// Dotted paths; one an import declares is prefixed with the import's path and a colon.
    fields: Vec<String>,
    /// `{field, value, via?}`: each unknown field's value, so a change to it changes the workflow.
    values: Vec<Value>,
    findings: Vec<Value>,
}

/// Where fields come from (the workflow, or an import's path), its unknown fields and its renamed ones.
type Source<'a> = (Option<&'a str>, Vec<(String, Value)>, Vec<Value>);

/// The diagnostics of the front matter and its imports; `deprecated` gains the
/// imports' renamed fields, each with the import it is in as `via`.
fn diagnostics(front: &Map<String, Value>, imported: &[Imported], deprecated: &mut Vec<Value>) -> Diagnostics {
    let mut result = Diagnostics {
        fields: vec![],
        values: vec![],
        findings: vec![],
    };
    let checked: Vec<&Imported> = imported.iter().filter(|import| import.entry.get("agent").is_none()).collect();
    let mut connected = BTreeSet::new();
    fields::connected(front, &mut connected);
    for import in &checked {
        if let Some(front) = &import.front {
            fields::connected(front, &mut connected);
        }
    }
    let mut sources: Vec<Source> = vec![(None, fields::unrecognized(front, &connected), std::mem::take(deprecated))];
    for import in checked {
        let (Some(via), Some(front)) = (import.entry["path"].as_str(), &import.front) else {
            continue;
        };
        sources.push((Some(via), fields::unrecognized(front, &connected), import.deprecated.clone()));
    }
    for (via, unknown, renamed) in sources {
        let place = via.map(|via| format!(" in `{via}`")).unwrap_or_default();
        if !unknown.is_empty() {
            let names = unknown.iter().map(|(field, _)| format!("`{field}`")).collect::<Vec<_>>().join(", ");
            result.findings.push(finding(
                "unrecognized",
                format!(
                    "gh-aw `{}` doesn't know {names}{place}: a newer gh-aw's field, or one it rejects.",
                    fields::release()
                ),
            ));
        }
        for (field, value) in unknown {
            result
                .fields
                .push(via.map_or_else(|| field.clone(), |via| format!("{via}: {field}")));
            let mut entry = json!({"field": field, "value": value});
            if let Some(via) = via {
                entry["via"] = json!(via);
            }
            result.values.push(entry);
        }
        for mut entry in renamed {
            let (field, now, codemod) = (&entry["field"], &entry["now"], &entry["codemod"]);
            result.findings.push(finding(
                "deprecated",
                format!(
                    "`{}`{place} is now `{}`; `gh aw fix` moves it (`{}`).",
                    text(field),
                    text(now),
                    text(codemod)
                ),
            ));
            if let Some(via) = via {
                entry["via"] = json!(via);
            }
            deprecated.push(entry);
        }
    }
    result
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

/// The workflows a workflow starts through its `dispatch-workflow` and `call-workflow` safe outputs, by name.
pub fn dispatched(entity: &Value) -> Vec<String> {
    let handlers = entity["data"]["safeOutputs"]["handlers"].as_array().cloned().unwrap_or_default();
    let mut names: Vec<String> = handlers
        .iter()
        .filter(|handler| matches!(handler["kind"].as_str(), Some("dispatch-workflow" | "call-workflow")))
        .flat_map(|handler| match &handler["workflows"] {
            Value::String(name) => vec![name.clone()],
            Value::Array(names) => names.iter().filter_map(Value::as_str).map(str::to_owned).collect(),
            _ => vec![],
        })
        .map(|name| name.trim_end_matches(".md").trim_end_matches(".lock.yml").to_owned())
        .collect();
    names.sort();
    names.dedup();
    names
}
