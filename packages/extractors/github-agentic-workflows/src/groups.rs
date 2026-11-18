//! The `groups` input: workflows that work together, such as a main workflow
//! and the ones that support it, drawn and compared as one unit.

use anyhow::{Result, bail};
use projections_extractor_sdk::glob;
use serde_json::Value;
use std::collections::BTreeMap;

/// The group of each workflow path that has one, from `groups`: `"prefix"`
/// groups each workflow with the workflows named after it and a dash
/// (`docs-bot` with `docs-bot-links` and `docs-bot-examples`); an object of
/// group name to globs puts a workflow whose path or name matches one in that
/// group (the first by name, when several match).
pub fn groups(input: Option<&Value>, paths: &[(String, String)]) -> Result<BTreeMap<String, String>> {
    match input.filter(|input| !input.is_null()) {
        None => Ok(BTreeMap::new()),
        Some(Value::String(mode)) if mode == "prefix" => Ok(by_prefix(paths)),
        Some(Value::Object(groups)) => by_globs(groups, paths),
        Some(_) => bail!("inputs.groups must be \"prefix\" or an object of group name to globs"),
    }
}

/// `paths` are `(path, name)` pairs.
fn by_prefix(paths: &[(String, String)]) -> BTreeMap<String, String> {
    let mut groups = BTreeMap::new();
    for (path, name) in paths {
        let root = paths
            .iter()
            .map(|(_, other)| other)
            .filter(|other| name.starts_with(&format!("{other}-")))
            .min_by_key(|other| other.len());
        if let Some(root) = root {
            groups.insert(path.clone(), root.clone());
            if let Some((root_path, _)) = paths.iter().find(|(_, other)| other == root) {
                groups.insert(root_path.clone(), root.clone());
            }
        }
    }
    groups
}

fn by_globs(groups: &serde_json::Map<String, Value>, paths: &[(String, String)]) -> Result<BTreeMap<String, String>> {
    let mut patterns = Vec::new();
    for (group, globs) in groups {
        let globs = match globs {
            Value::String(pattern) => vec![pattern.clone()],
            other => projections_extractor_sdk::strings(other, &format!("inputs.groups.{group}"))?,
        };
        patterns.push((group, globs.iter().map(|pattern| glob(pattern)).collect::<Result<Vec<_>>>()?));
    }
    Ok(paths
        .iter()
        .filter_map(|(path, name)| {
            let (group, _) = patterns
                .iter()
                .find(|(_, globs)| globs.iter().any(|glob| glob.is_match(path) || glob.is_match(name)))?;
            Some((path.clone(), (*group).clone()))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn paths(names: &[&str]) -> Vec<(String, String)> {
        names
            .iter()
            .map(|name| (format!(".github/workflows/{name}.md"), (*name).to_owned()))
            .collect()
    }

    #[test]
    fn groups_by_prefix_or_globs() {
        let workflows = paths(&["docs-bot", "docs-bot-links", "docs-bot-examples", "triage", "docs"]);
        let grouped = groups(Some(&json!("prefix")), &workflows).unwrap();
        assert_eq!(grouped[".github/workflows/docs-bot-examples.md"], "docs");
        assert_eq!(grouped[".github/workflows/docs.md"], "docs");
        assert!(!grouped.contains_key(".github/workflows/triage.md"));
        let grouped = groups(
            Some(&json!({"bot": ["docs-bot*"], "ops": ".github/workflows/triage.md"})),
            &workflows,
        )
        .unwrap();
        assert_eq!(grouped[".github/workflows/docs-bot.md"], "bot");
        assert_eq!(grouped[".github/workflows/triage.md"], "ops");
        assert!(!grouped.contains_key(".github/workflows/docs.md"));
        assert!(groups(Some(&json!(3)), &workflows).is_err());
    }
}
