//! When a workflow runs (`on`): its triggers, and the activation settings
//! gh-aw adds under `on` that decide who may start it and when it skips.

use serde_json::{Map, Value, json};

/// Keys under `on` that configure activation rather than name a trigger.
const ACTIVATION: &[&str] = &[
    "admission",
    "allow-bot-authored-trigger-comment",
    "bots",
    "cooldown",
    "github-app",
    "github-token",
    "labels",
    "manual-approval",
    "needs",
    "orgs",
    "permissions",
    "reaction",
    "report-blocked-version",
    "repos",
    "restore-memory",
    "roles",
    "skip-author-associations",
    "skip-bots",
    "skip-if-check-failing",
    "skip-if-match",
    "skip-if-no-match",
    "skip-roles",
    "stale-check",
    "status-comment",
    "steps",
    "stop-after",
];

/// The roles gh-aw lets trigger a workflow that doesn't name them.
pub const DEFAULT_ROLES: &[&str] = &["admin", "maintainer", "write"];

/// The settings of an event that restrict when it starts the workflow: which
/// runs it includes, and which it ignores (gh-aw's schema at the pinned release).
const FILTERS: &[&str] = &[
    "types",
    "branches",
    "branches-ignore",
    "tags",
    "tags-ignore",
    "paths",
    "paths-ignore",
    "workflows",
    "names",
    "forks",
    "draft",
];

/// One trigger: the event, what narrows it in words (`opened, labeled`,
/// `/repo-ask`, `daily`), when anything does, and its restricting settings
/// as `filters` (each a list of strings), when it has any.
fn trigger(event: &str, value: Option<&Value>) -> Value {
    let mut trigger = json!({"event": event});
    if let Some(detail) = value.and_then(|value| detail(event, value)).filter(|detail| !detail.is_empty()) {
        trigger["detail"] = json!(detail);
    }
    if let Some(Value::Object(settings)) = value {
        let filters: Map<String, Value> = FILTERS
            .iter()
            .filter_map(|key| Some(((*key).to_owned(), json!(listed(settings.get(*key)?)))))
            .collect();
        if !filters.is_empty() {
            trigger["filters"] = Value::Object(filters);
        }
    }
    trigger
}

/// A filter's values as strings: a list as written, or a single value.
fn listed(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items.iter().filter_map(words).collect(),
        other => words(other).into_iter().collect(),
    }
}

fn words(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Array(items) => Some(items.iter().filter_map(words).collect::<Vec<_>>().join(", ")),
        _ => None,
    }
}

/// What narrows a trigger: a command's name, a schedule, event types, branches.
fn detail(event: &str, value: &Value) -> Option<String> {
    match (event, value) {
        ("slash_command" | "label_command", Value::Object(command)) => command.get("name").and_then(words),
        ("slash_command" | "label_command", other) => words(other),
        ("schedule", Value::Array(entries)) => Some(
            entries
                .iter()
                .filter_map(|entry| entry.get("cron").and_then(words).or_else(|| words(entry)))
                .collect::<Vec<_>>()
                .join(", "),
        ),
        (_, Value::Object(settings)) => {
            let parts: Vec<String> = FILTERS
                .iter()
                .filter_map(|key| settings.get(*key).and_then(words).map(|value| format!("{key}: {value}")))
                .collect();
            Some(parts.join("; "))
        }
        (_, other) => words(other),
    }
}

/// The triggers, sorted by event: one per event under `on`, or the string
/// form as written (`daily`, `push to main`), which gh-aw expands when it
/// compiles.
pub fn triggers(on: Option<&Value>) -> Vec<Value> {
    match on {
        Some(Value::String(text)) => vec![trigger(text, None)],
        Some(Value::Object(events)) => events
            .iter()
            .filter(|(key, _)| !ACTIVATION.contains(&key.as_str()))
            .map(|(event, value)| trigger(event, Some(value)))
            .collect(),
        _ => vec![],
    }
}

/// Activation settings under `on`, as written, with `roles` always present
/// (gh-aw's default when absent) and `rolesDeclared` saying which.
pub fn activation(on: Option<&Value>) -> Value {
    let settings: Map<String, Value> = match on {
        Some(Value::Object(events)) => events
            .iter()
            .filter(|(key, _)| ACTIVATION.contains(&key.as_str()))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
        _ => Map::new(),
    };
    let declared = settings.get("roles").and_then(|roles| match roles {
        Value::String(role) => Some(vec![role.clone()]),
        Value::Array(roles) => Some(roles.iter().filter_map(|role| role.as_str().map(str::to_owned)).collect()),
        _ => None,
    });
    let mut roles = declared
        .clone()
        .unwrap_or_else(|| DEFAULT_ROLES.iter().map(|role| (*role).to_owned()).collect());
    roles.sort();
    roles.dedup();
    json!({"roles": roles, "rolesDeclared": declared.is_some(), "settings": settings})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_triggers_and_activation() {
        let on = json!({
            "slash_command": {"name": "repo-ask"},
            "reaction": "eyes",
            "schedule": [{"cron": "0 9 * * 1"}],
            "pull_request": {"types": ["opened", "labeled"]},
            "push": {"branches": "main", "paths-ignore": ["docs/**"], "draft": false},
            "workflow_dispatch": null,
            "roles": "all"
        });
        assert_eq!(
            triggers(Some(&on)),
            json!([
                {"event": "pull_request", "detail": "types: opened, labeled", "filters": {"types": ["opened", "labeled"]}},
                {
                    "event": "push",
                    "detail": "branches: main; paths-ignore: docs/**; draft: false",
                    "filters": {"branches": ["main"], "paths-ignore": ["docs/**"], "draft": ["false"]}
                },
                {"event": "schedule", "detail": "0 9 * * 1"},
                {"event": "slash_command", "detail": "repo-ask"},
                {"event": "workflow_dispatch"}
            ])
            .as_array()
            .unwrap()
            .clone()
        );
        let activation = activation(Some(&on));
        assert_eq!(activation["roles"], json!(["all"]));
        assert_eq!(activation["settings"]["reaction"], "eyes");
        assert_eq!(triggers(Some(&json!("daily"))), vec![json!({"event": "daily"})]);
        assert_eq!(super::activation(None)["roles"], json!(["admin", "maintainer", "write"]));
    }
}
