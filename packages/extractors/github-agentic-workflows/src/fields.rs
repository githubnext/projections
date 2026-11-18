//! Which front matter fields gh-aw knows, from its published schema at the
//! pinned release (`vendor/gh-aw/fields.json`, written by
//! `scripts/schema.mjs`), and the fields gh-aw has renamed, which are read
//! under their current names and reported.

use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

static TABLE: LazyLock<Value> =
    LazyLock::new(|| serde_json::from_str(include_str!("../vendor/gh-aw/fields.json")).expect("vendor/gh-aw/fields.json is JSON"));

/// The gh-aw release whose front matter schema the extractor knows.
pub fn release() -> &'static str {
    TABLE["release"].as_str().unwrap_or_default()
}

pub fn source() -> Value {
    json!({"release": TABLE["release"], "commit": TABLE["commit"], "schema": TABLE["schema"]})
}

/// The `max` gh-aw applies to a safe output handler of `kind` that sets none, as its schema documents it.
pub fn default_max(kind: &str) -> Option<&'static Value> {
    TABLE["maxima"].get(kind)
}

/// The fields gh-aw knows at the object at `path` (`""` is the root).
pub fn known(path: &str) -> BTreeSet<&'static str> {
    TABLE["objects"][path]["known"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect()
}

/// The objects whose fields are checked, in the table's order.
fn checked() -> impl Iterator<Item = &'static str> {
    TABLE["objects"]
        .as_object()
        .into_iter()
        .flat_map(|objects| objects.keys().map(String::as_str))
}

/// A field gh-aw renamed: where it was, where it is now, and the `gh aw fix`
/// codemod that moves it (`None` for an alias gh-aw still accepts as written).
struct Rename {
    from: (&'static str, &'static str),
    to: (&'static str, &'static str),
    codemod: Option<&'static str>,
}

const fn rename(from: (&'static str, &'static str), to: (&'static str, &'static str), codemod: Option<&'static str>) -> Rename {
    Rename { from, to, codemod }
}

/// gh-aw's field migrations (`pkg/cli/codemod_*.go`) and aliases, at the pinned release.
const RENAMES: &[Rename] = &[
    rename(("", "timeout_minutes"), ("", "timeout-minutes"), Some("timeout-minutes-migration")),
    rename(("", "roles"), ("on", "roles"), Some("roles-to-on-roles")),
    rename(("", "bots"), ("on", "bots"), Some("bots-to-on-bots")),
    rename(("", "safe-inputs"), ("", "mcp-scripts"), Some("safe-inputs-to-mcp-scripts")),
    rename(("", "rate-limit"), ("", "user-rate-limit"), Some("rate-limit-to-user-rate-limit")),
    rename(("", "max-runs"), ("", "max-turns"), Some("max-runs-to-max-turns")),
    rename(("", "app"), ("", "github-app"), Some("app-to-github-app")),
    rename(("engine", "max-turns"), ("", "max-turns"), Some("engine-max-turns-to-top-level")),
    rename(("engine", "max-runs"), ("", "max-turns"), Some("engine-max-runs-to-top-level")),
    rename(("engine", "steps"), ("", "steps"), Some("engine-steps-to-top-level")),
    rename(
        ("on", "command"),
        ("on", "slash_command"),
        Some("command-to-slash-command-migration"),
    ),
    rename(("on", "slash-command"), ("on", "slash_command"), None),
    rename(("on", "label-command"), ("on", "label_command"), None),
    rename(
        ("tools", "mount-as-clis"),
        ("tools", "cli-proxy"),
        Some("mount-as-clis-to-cli-proxy"),
    ),
    rename(
        ("tools.github", "repos"),
        ("tools.github", "allowed-repos"),
        Some("github-repos-to-allowed-repos"),
    ),
    rename(
        ("tools.github", "toolset"),
        ("tools.github", "toolsets"),
        Some("toolset-singular-to-toolsets"),
    ),
    rename(
        ("safe-outputs", "create-agent-task"),
        ("safe-outputs", "create-agent-session"),
        Some("agent-task-to-agent-session-migration"),
    ),
    rename(
        ("safe-outputs", "upload-assets"),
        ("safe-outputs", "upload-asset"),
        Some("upload-assets-to-upload-asset-migration"),
    ),
    rename(
        ("safe-outputs", "missing-tool"),
        ("safe-outputs", "report-missing-tool"),
        Some("safe-output-report-missing-tool"),
    ),
    rename(
        ("safe-outputs", "missing-tools"),
        ("safe-outputs", "report-missing-tool"),
        Some("safe-output-report-missing-tool"),
    ),
    rename(
        ("safe-outputs", "missing-data"),
        ("safe-outputs", "report-missing-data"),
        Some("safe-output-report-missing-data"),
    ),
    rename(
        ("safe-outputs", "dispatch_repository"),
        ("safe-outputs", "dispatch-repository"),
        Some("safe-output-dispatch-repository-key"),
    ),
    rename(
        ("safe-outputs", "dismiss-review"),
        ("safe-outputs", "dismiss-pull-request-review"),
        None,
    ),
];

fn object_at<'a>(root: &'a mut Map<String, Value>, path: &str) -> Option<&'a mut Map<String, Value>> {
    let mut current = root;
    for segment in path.split('.').filter(|segment| !segment.is_empty()) {
        current = current.get_mut(segment)?.as_object_mut()?;
    }
    Some(current)
}

fn dotted(path: &str, key: &str) -> String {
    if path.is_empty() { key.to_owned() } else { format!("{path}.{key}") }
}

/// Moves renamed fields to their current names, in place, and returns one
/// `{field, now, codemod}` per renamed field that has a codemod. A value
/// already present under the current name wins, as `gh aw fix` keeps it.
pub fn migrate(front: &mut Map<String, Value>) -> Vec<Value> {
    let mut deprecated = Vec::new();
    for rule in RENAMES {
        let Some(value) = object_at(front, rule.from.0).and_then(|object| object.remove(rule.from.1)) else {
            continue;
        };
        if rule.to.0 == "on" && !front.get("on").is_some_and(Value::is_object) {
            // A string `on` has nowhere to put an activation setting; keep it where it was.
            object_at(front, rule.from.0).map(|object| object.insert(rule.from.1.to_owned(), value));
            continue;
        }
        if let Some(target) = object_at(front, rule.to.0) {
            target.entry(rule.to.1.to_owned()).or_insert(value);
        }
        if let Some(codemod) = rule.codemod {
            deprecated.push(json!({"field": dotted(rule.from.0, rule.from.1), "now": dotted(rule.to.0, rule.to.1), "codemod": codemod}));
        }
    }
    migrate_permissions(front, &mut deprecated);
    migrate_playwright_domains(front, &mut deprecated);
    deprecated.sort_by_key(|entry| entry["field"].as_str().unwrap_or_default().to_owned());
    deprecated
}

/// `permissions: read` and `write` are `read-all` and `write-all`.
fn migrate_permissions(front: &mut Map<String, Value>, deprecated: &mut Vec<Value>) {
    let Some(Value::String(level)) = front.get_mut("permissions") else {
        return;
    };
    if level == "read" || level == "write" {
        let now = format!("{level}-all");
        deprecated.push(json!({"field": format!("permissions: {level}"), "now": format!("permissions: {now}"), "codemod": "permissions-read-to-read-all"}));
        *level = now;
    }
}

/// `tools.playwright.allowed_domains` moved to `network.allowed`.
fn migrate_playwright_domains(front: &mut Map<String, Value>, deprecated: &mut Vec<Value>) {
    let Some(domains) = object_at(front, "tools.playwright").and_then(|playwright| playwright.remove("allowed_domains")) else {
        return;
    };
    deprecated.push(
        json!({"field": "tools.playwright.allowed_domains", "now": "network.allowed", "codemod": "playwright-allowed-domains-migration"}),
    );
    let network = front.entry("network").or_insert_with(|| json!({}));
    if network == "defaults" {
        *network = json!({"allowed": ["defaults"]});
    }
    if let Some(network) = network.as_object_mut() {
        let allowed = network.entry("allowed").or_insert_with(|| json!([]));
        if let (Some(allowed), Some(domains)) = (allowed.as_array_mut(), domains.as_array()) {
            allowed.extend(domains.iter().cloned());
        }
    }
}

/// The safe outputs the connectors in `front` add: `<alias>-<operation>` for
/// each operation under `connectors.<alias>.safe-outputs`.
pub fn connected(front: &Map<String, Value>, found: &mut BTreeSet<String>) {
    let Some(Value::Object(connectors)) = front.get("connectors") else {
        return;
    };
    for (alias, connector) in connectors {
        if let Some(Value::Object(operations)) = connector.get("safe-outputs") {
            found.extend(operations.keys().map(|operation| format!("{alias}-{operation}")));
        }
    }
}

/// Fields of the checked objects that gh-aw's schema at the pinned release
/// doesn't declare, as dotted paths in sorted order with their values: a
/// newer gh-aw's field, or a mistake gh-aw would reject. `connected` names the
/// safe outputs connectors add (`jira-add-comment`), which gh-aw accepts too.
pub fn unrecognized(front: &Map<String, Value>, connected: &BTreeSet<String>) -> Vec<(String, Value)> {
    let mut found = BTreeMap::new();
    for path in checked() {
        let mut node = Some(front);
        for segment in path.split('.').filter(|segment| !segment.is_empty()) {
            node = node.and_then(|object| object.get(segment)).and_then(Value::as_object);
        }
        let Some(object) = node else { continue };
        let known = known(path);
        let connector = |key: &str| path == "safe-outputs" && connected.contains(key);
        for (key, value) in object.iter().filter(|(key, _)| !known.contains(key.as_str()) && !connector(key)) {
            found.insert(dotted(path, key), value.clone());
        }
    }
    found.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_renamed_fields_and_reports_unknown_ones() {
        let mut front = json!({
            "timeout_minutes": 5,
            "roles": ["admin"],
            "on": {"command": {"name": "ask"}},
            "permissions": "read",
            "tools": {"github": {"repos": ["a/b"]}, "playwright": {"allowed_domains": ["example.com"]}},
            "frobnicate": true,
            "engine": {"id": "copilot", "max-turns": 9, "turbo": 1}
        });
        let front = front.as_object_mut().unwrap();
        let deprecated = migrate(front);
        assert_eq!(front["timeout-minutes"], 5);
        assert_eq!(front["on"]["roles"], json!(["admin"]));
        assert_eq!(front["on"]["slash_command"]["name"], "ask");
        assert_eq!(front["permissions"], "read-all");
        assert_eq!(front["tools"]["github"]["allowed-repos"], json!(["a/b"]));
        assert_eq!(front["network"]["allowed"], json!(["example.com"]));
        assert_eq!(front["max-turns"], 9);
        assert_eq!(deprecated.len(), 7);
        front.insert("safe-outputs".into(), json!({"jira-add-comment": null}));
        let connected = BTreeSet::from(["jira-add-comment".to_owned()]);
        assert_eq!(
            unrecognized(front, &connected),
            [("engine.turbo".to_owned(), json!(1)), ("frobnicate".to_owned(), json!(true))]
        );
        assert_eq!(unrecognized(front, &BTreeSet::new())[2].0, "safe-outputs.jira-add-comment");
        assert_eq!(release(), "v1.3.0");
    }
}
