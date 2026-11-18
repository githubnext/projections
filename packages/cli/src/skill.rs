//! The agent skill `projections init` writes and `projections help authoring`
//! prints. Its lists of schemas and built-in renderers are generated from the
//! engine, the renderer manifests this executable embeds and the extractor
//! catalog, so they always name what this CLI actually supports.

use serde_json::Value;
use std::collections::BTreeSet;

pub mod health;
pub mod install;

const TEMPLATE: &str = include_str!("../templates/SKILL.md");
/// The skill's name, and so its directory in a skills directory.
pub const NAME: &str = "projections";
/// The front matter `metadata` key holding the version of the CLI that wrote the
/// skill. `init` manages, and rewrites, only a skill that has it.
pub const VERSION_KEY: &str = "projections-version";

/// A built-in renderer bundle: its name, title and the definition renderer
/// names it presents (its own name first).
#[derive(Debug, Clone)]
pub struct BuiltinRenderer {
    pub name: String,
    pub title: String,
    pub handles: Vec<String>,
    /// The comparison modes it declares; empty means the SDK's defaults (no diff).
    pub comparison_modes: Vec<String>,
}

/// The built-in renderers this executable embeds, or none for a build without
/// the Inspector client.
pub fn builtin_renderers() -> Vec<BuiltinRenderer> {
    let Some(bytes) = crate::assets::inspector_asset("renderers/index.json") else {
        return Vec::new();
    };
    let Ok(index) = serde_json::from_slice::<Value>(&bytes) else {
        return Vec::new();
    };
    index["renderers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|manifest| {
            let name = manifest["name"].as_str()?.to_owned();
            let mut handles = vec![name.clone()];
            for handle in manifest["handles"].as_array().into_iter().flatten() {
                if let Some(handle) = handle.as_str().filter(|handle| !handles.iter().any(|known| known == handle)) {
                    handles.push(handle.to_owned());
                }
            }
            Some(BuiltinRenderer {
                comparison_modes: manifest["comparisonModes"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|mode| mode.as_str().map(str::to_owned))
                    .collect(),
                title: manifest["title"].as_str().unwrap_or(&name).to_owned(),
                name,
                handles,
            })
        })
        .collect()
}

/// Every name a definition's `"renderer"` may use for a built-in renderer.
pub fn renderer_names() -> BTreeSet<String> {
    builtin_renderers().into_iter().flat_map(|renderer| renderer.handles).collect()
}

/// What a schema is for, and what the engine requires of it.
fn schema_summary(schema: &str) -> &'static str {
    match schema {
        "graph/v0" => "entities and directed relationships between them; the general choice",
        "dag/v0" => "like `graph/v0`, with no cycles: steps, stages, job or build order",
        "treemap/v0" => "a containment forest (at most one parent each, no cycles) whose leaves carry a nonnegative numeric `data.value`",
        "metrics/v0" => "measurements: every entity carries a numeric `data.value` and optionally a string `data.unit`",
        "api/v0" => {
            "public API declarations; `export`, `type`, `member`, `function`, `class`, `interface`, `method`, `property` and `enum` entities carry a string `data.signature` and optionally a `data.contract` object of compatibility facts"
        }
        "database/v0" => {
            "tables, columns, keys and constraints; `column` entities carry `data.type` and optionally `data.databaseType` (a string or null), and booleans `data.nullable` and `data.primaryKey`; `constraint` and `primary-key` entities may name `data.table` and `data.columns`, and `foreign-key` and `relation` relationships `data.columns` and `data.principalColumns`"
        }
        "architecture/v0" => "components and their connections, as `graph/v0`, for architecture and infrastructure",
        _ => "",
    }
}

/// What a vocabulary is for and what it types.
fn vocabulary_summary(vocabulary: &str) -> &'static str {
    match vocabulary {
        "dependency-injection/v0" => {
            "`service`, `registration` and `implementation` entities and `dependsOn` relationships of a dependency-injection container, with lifetimes and keys"
        }
        "infrastructure/v0" => {
            "resources, data sources, modules and resource groups with their `data.type`, `data.provider` and planned `data.action`"
        }
        "runtime-policy/v0" => "kernel runtime policies (such as Tetragon): `policy`, `hook`, `selector` and `subject` entities",
        "agentic-workflows/v0" => "agentic workflows (such as GitHub Agentic Workflows): `workflow` and `group` entities",
        _ => "",
    }
}

/// The renderers the built-in extractors use for each schema, from the catalog.
fn catalog_renderers(schema: &str) -> BTreeSet<String> {
    crate::collectors::catalog()["extractors"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|descriptor| descriptor["schema"] == schema)
        .filter_map(|descriptor| descriptor["renderer"].as_str().map(str::to_owned))
        .collect()
}

fn code_list(items: impl IntoIterator<Item = impl AsRef<str>>) -> String {
    items
        .into_iter()
        .map(|item| format!("`{}`", item.as_ref()))
        .collect::<Vec<_>>()
        .join(", ")
}

/// The schema list: one bullet per schema the engine accepts.
fn schemas() -> String {
    projections_engine::SCHEMAS
        .iter()
        .map(|schema| {
            let renderers = catalog_renderers(schema);
            let used = if renderers.is_empty() {
                String::new()
            } else {
                format!(" Built-in extractors present it with {}.", code_list(&renderers))
            };
            let vocabularies: String = projections_engine::VOCABULARIES
                .iter()
                .filter(|(_, schemas)| schemas.contains(schema))
                .map(|(vocabulary, _)| {
                    format!(
                        "  - With `\"vocabularies\": [\"{vocabulary}\"]`: {}; the engine checks its typed `data`.\n",
                        vocabulary_summary(vocabulary)
                    )
                })
                .collect();
            format!("- `{schema}`: {}.{used}\n{vocabularies}", schema_summary(schema))
        })
        .collect()
}

/// The built-in renderer list: each bundle with the names it answers to.
fn renderers() -> String {
    let renderers = builtin_renderers();
    if renderers.is_empty() {
        return "This build of the CLI doesn't include the built-in renderers; `projections extractor list` names the renderer each built-in extractor uses.\n".to_owned();
    }
    renderers
        .iter()
        .map(|renderer| {
            let also = &renderer.handles[1..];
            format!(
                "- `{}`: {}{}\n",
                renderer.name,
                renderer.title,
                if also.is_empty() {
                    String::new()
                } else {
                    format!(" (also named {})", code_list(also))
                }
            )
        })
        .collect()
}

/// The skill file, with its generated lists.
pub fn skill() -> String {
    TEMPLATE
        .replace("{{schemas}}\n", &schemas())
        .replace("{{renderers}}\n", &renderers())
        .replace("{{docs}}", crate::docs::DOCS_BASE)
        .replace("{{version}}", env!("CARGO_PKG_VERSION"))
}

/// The version a skill file's front matter records in `metadata.projections-version`,
/// or `None` when Projections didn't write it (or someone removed the key to keep their edits).
pub fn written_by(skill: &str) -> Option<String> {
    let skill = skill.replace("\r\n", "\n");
    let (front, _) = skill.strip_prefix("---\n")?.split_once("\n---")?;
    front.lines().find_map(|line| {
        let value = line.trim_start().strip_prefix(VERSION_KEY)?.strip_prefix(':')?;
        Some(value.trim().trim_matches(['"', '\'']).to_owned())
    })
}

/// The skill without its front matter: `projections help authoring`.
pub fn authoring_guide() -> String {
    let skill = skill();
    match skill.strip_prefix("---\n").and_then(|rest| rest.split_once("\n---\n")) {
        Some((_, body)) => body.trim_start().to_owned(),
        None => skill,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use regex::Regex;

    #[test]
    fn every_schema_has_a_summary() {
        for schema in projections_engine::SCHEMAS {
            assert!(!schema_summary(schema).is_empty(), "{schema} has no summary");
        }
    }

    #[test]
    fn every_vocabulary_has_a_summary() {
        for (vocabulary, _) in projections_engine::VOCABULARIES {
            assert!(!vocabulary_summary(vocabulary).is_empty(), "{vocabulary} has no summary");
        }
    }

    /// The skill names only schemas and vocabularies the engine accepts and, wherever a renderer
    /// is chosen, renderers this CLI ships.
    #[test]
    fn the_skill_names_only_real_schemas_and_renderers() {
        let skill = skill();
        assert!(!skill.contains("{{"), "unfilled placeholder");
        for schema in Regex::new(r"[a-z-]+/v[0-9]+").unwrap().find_iter(&skill) {
            // A published schema's URL (`https://schemas.projections.githubnext.com/comparator/v0.json`)
            // isn't a domain schema.
            if skill[..schema.start()].ends_with("://schemas.projections.githubnext.com/") {
                continue;
            }
            assert!(
                projections_engine::SCHEMAS.contains(&schema.as_str())
                    || projections_engine::VOCABULARIES
                        .iter()
                        .any(|(vocabulary, _)| *vocabulary == schema.as_str()),
                "the skill names the unknown schema or vocabulary {}",
                schema.as_str()
            );
        }
        let names = renderer_names();
        let chosen = Regex::new(r#"--renderer ([a-z-]+)|"renderer": "([a-z-]+)""#).unwrap();
        for capture in chosen.captures_iter(&skill) {
            let name = capture.get(1).or(capture.get(2)).unwrap().as_str();
            assert!(
                name == "custom" || names.is_empty() || names.contains(name),
                "the skill chooses the unknown renderer {name}; built-in renderers are {names:?}"
            );
        }
        // Every renderer the extractor catalog uses is one this CLI ships.
        for descriptor in crate::collectors::catalog()["extractors"].as_array().unwrap() {
            let renderer = descriptor["renderer"].as_str().unwrap();
            assert!(
                names.is_empty() || names.contains(renderer),
                "extractor {} uses the unknown renderer {renderer}",
                descriptor["id"]
            );
        }
        // Renderers that no longer exist stay out of it.
        for removed in [
            "tree",
            "interfaces",
            "messaging",
            "timeline",
            "plan",
            "routes",
            "flags",
            "state-slices",
        ] {
            assert!(
                !skill.contains(&format!("`{removed}`")),
                "the skill names the removed renderer {removed}"
            );
            assert!(!names.contains(removed));
        }
    }
}
