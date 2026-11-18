//! What a workflow loads: the files it imports (transitively, as gh-aw
//! resolves them) and the skills it installs, each with the classes the
//! definition's `classes` input gives it, such as `guardrail`.

use crate::document::split;
use crate::fields;
use crate::paths::{dir, resolve_import};
use anyhow::{Result, bail};
use projections_extractor_sdk::{glob, parse_yaml};
use regex::Regex;
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

/// The `classes` input: class name to the globs of import paths and skill references it covers.
pub struct Classes(Vec<(String, Vec<Regex>)>);

impl Classes {
    pub fn read(input: Option<&Value>) -> Result<Self> {
        let Some(input) = input.filter(|input| !input.is_null()) else {
            return Ok(Classes(vec![]));
        };
        let Some(classes) = input.as_object() else {
            bail!("inputs.classes must be an object of class name to globs")
        };
        let mut read = Vec::new();
        for (name, patterns) in classes {
            let patterns = match patterns {
                Value::String(pattern) => vec![pattern.clone()],
                other => projections_extractor_sdk::strings(other, &format!("inputs.classes.{name}"))?,
            };
            read.push((name.clone(), patterns.iter().map(|pattern| glob(pattern)).collect::<Result<_>>()?));
        }
        Ok(Classes(read))
    }

    /// The classes any of `names` (a path as written, as resolved, a skill reference) falls in, sorted.
    pub fn of(&self, names: &[&str]) -> Vec<String> {
        self.0
            .iter()
            .filter(|(_, patterns)| patterns.iter().any(|pattern| names.iter().any(|name| pattern.is_match(name))))
            .map(|(class, _)| class.clone())
            .collect()
    }
}

/// The imports `front` declares, as written: the list form, or `aw:` in the
/// object form, each a path or a `{path}` / `{uses}` object.
fn declared(front: &Map<String, Value>) -> Vec<String> {
    let items = match front.get("imports") {
        Some(Value::Array(items)) => items.clone(),
        Some(Value::Object(forms)) => forms.get("aw").and_then(Value::as_array).cloned().unwrap_or_default(),
        _ => vec![],
    };
    items
        .iter()
        .filter_map(|item| match item {
            Value::String(path) => Some(path.clone()),
            Value::Object(form) => form
                .get("path")
                .or_else(|| form.get("uses"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            _ => None,
        })
        .collect()
}

/// One imported file: its entry in the extraction, its front matter (renames
/// applied) for merging, and the renamed fields it used.
pub struct Imported {
    pub entry: Value,
    pub front: Option<Map<String, Value>>,
    pub deprecated: Vec<Value>,
}

/// Every import of the workflow at `path`, depth first, each file once; one
/// that is missing (or in another repository, which gh-aw fetches when it
/// compiles) is listed without front matter.
pub fn imports(path: &str, front: &Map<String, Value>, classes: &Classes, read: crate::hash::Read) -> Vec<Imported> {
    let mut found = Vec::new();
    let mut visited = BTreeSet::new();
    visit(front, &dir(path), &dir(path), None, classes, read, &mut visited, &mut found);
    found
}

#[allow(clippy::too_many_arguments)]
fn visit(
    front: &Map<String, Value>,
    base: &str,
    root: &str,
    via: Option<&str>,
    classes: &Classes,
    read: crate::hash::Read,
    visited: &mut BTreeSet<String>,
    found: &mut Vec<Imported>,
) {
    for written in declared(front) {
        let path = written.trim_end_matches('?');
        let resolved = resolve_import(path, base, root).ok();
        if !visited.insert(resolved.clone().unwrap_or_else(|| written.clone())) {
            continue;
        }
        let imported = resolved.as_deref().and_then(read).and_then(|content| split(&content).ok());
        let mut front = imported
            .as_ref()
            .and_then(|document| parse_yaml(&document.front, path).ok())
            .and_then(|value| match value {
                Value::Object(front) => Some(front),
                Value::Null => Some(Map::new()),
                _ => None,
            });
        // gh-aw doesn't validate custom agent files against its schema: they follow Copilot's agent format.
        let agent = resolved.as_deref().is_some_and(custom_agent);
        let deprecated = front.as_mut().filter(|_| !agent).map(fields::migrate).unwrap_or_default();
        let names: Vec<&str> = [Some(path), resolved.as_deref()].into_iter().flatten().collect();
        let mut entry = json!({"path": path, "classes": classes.of(&names), "found": imported.is_some()});
        if agent {
            entry["agent"] = json!(true);
        }
        if let Some(resolved) = &resolved {
            entry["resolved"] = json!(resolved);
        }
        if let Some(via) = via {
            entry["via"] = json!(via);
        }
        let nested = front.clone();
        found.push(Imported { entry, front, deprecated });
        if let (Some(nested), Some(resolved)) = (nested, resolved) {
            visit(&nested, &dir(&resolved), root, Some(path), classes, read, visited, found);
        }
    }
}

/// Whether a resolved path is a custom agent file (`.github/agents/*.md`), as gh-aw decides.
fn custom_agent(path: &str) -> bool {
    path.contains(".github/agents/") && path.to_lowercase().ends_with(".md")
}

/// The skills the workflow installs, `{ref, name, classes}` in the order
/// written: `name` is the reference without its `@ref`, which stays the same
/// when a pin moves, and the classes match either.
pub fn skills(front: &Map<String, Value>, classes: &Classes) -> Vec<Value> {
    front
        .get("skills")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|skill| skill.as_str().or_else(|| skill.get("skill").and_then(Value::as_str)))
        .map(|reference| {
            let bare = reference.split_once('@').map_or(reference, |(path, _)| path);
            json!({"ref": reference, "name": bare, "classes": classes.of(&[reference, bare])})
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_resolve_nest_and_take_classes() {
        let classes = Classes::read(Some(
            &json!({"guardrail": [".github/workflows/shared/check-*.md", "skills/check-*"]}),
        ))
        .unwrap();
        let read = |path: &str| match path {
            ".github/workflows/shared/check-style.md" => Some("---\nimports:\n  - common.md\n---\n".to_owned()),
            ".github/workflows/shared/common.md" => Some("---\nnetwork: defaults\n---\n".to_owned()),
            _ => None,
        };
        let front =
            json!({"imports": ["shared/check-style.md", "owner/repo/x.md@v1"], "skills": ["skills/check-lint", {"skill": "o/r/s@abc"}]});
        let found = imports(".github/workflows/lab.md", front.as_object().unwrap(), &classes, &read);
        let entries: Vec<&Value> = found.iter().map(|imported| &imported.entry).collect();
        assert_eq!(entries[0]["classes"], json!(["guardrail"]));
        assert_eq!(entries[1]["path"], "common.md");
        assert_eq!(entries[1]["via"], "shared/check-style.md");
        assert_eq!(entries[2]["found"], false);
        assert_eq!(
            skills(front.as_object().unwrap(), &classes),
            vec![
                json!({"ref": "skills/check-lint", "name": "skills/check-lint", "classes": ["guardrail"]}),
                json!({"ref": "o/r/s@abc", "name": "o/r/s", "classes": []})
            ]
        );
    }
}
