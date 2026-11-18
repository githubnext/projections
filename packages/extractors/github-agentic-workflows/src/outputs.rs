//! What a workflow may write, through gh-aw's safe outputs: each handler with
//! its limits and target repositories, custom safe-output jobs, and whether
//! outputs are only staged (previewed).

use serde_json::{Map, Value, json};

/// `safe-outputs` keys that configure every handler rather than enable one.
const GLOBAL: &[&str] = &[
    "actions",
    "activation-comments",
    "allowed-domains",
    "allowed-github-references",
    "body-footer",
    "claim-adapters",
    "concurrency-group",
    "data",
    "env",
    "environment",
    "failure-issue-repo",
    "footer",
    "github-app",
    "github-token",
    "group-reports",
    "id-token",
    "jobs",
    "max-bot-mentions",
    "max-patch-files",
    "max-patch-size",
    "mentions",
    "messages",
    "needs",
    "report-failed-jobs",
    "report-failure-as-issue",
    "require-agent-success",
    "runs-on",
    "scripts",
    "staged",
    "steer",
    "steps",
    "threat-detection",
    "timeout-minutes",
    "urls",
];

/// A handler's settings that widen or narrow what it may do, as the extraction names them.
const LIMITS: &[(&str, &str)] = &[
    ("max", "max"),
    ("target", "target"),
    ("target-repo", "targetRepo"),
    ("allowed-repos", "allowedRepos"),
    ("staged", "staged"),
    ("draft", "draft"),
    ("allowed", "allowed"),
    ("workflows", "workflows"),
];

/// One handler: `{kind, max?, maxDeclared?, target?, targetRepo?, allowedRepos?, staged?, draft?, allowed?, workflows?}`,
/// with gh-aw's default `max` (and `maxDeclared: false`) when it sets none.
fn handler(kind: &str, value: &Value) -> Value {
    let mut handler = Map::new();
    handler.insert("kind".into(), json!(kind));
    if let Some(settings) = value.as_object() {
        for (key, name) in LIMITS {
            if let Some(setting) = settings.get(*key).filter(|setting| !setting.is_null()) {
                handler.insert((*name).into(), setting.clone());
            }
        }
    }
    if !handler.contains_key("max")
        && let Some(default) = crate::fields::default_max(kind)
    {
        handler.insert("max".into(), default.clone());
        handler.insert("maxDeclared".into(), json!(false));
    }
    Value::Object(handler)
}

/// The workflow's safe outputs: `{handlers, jobs, staged, allowedDomains}`,
/// handlers sorted by kind; one set to `false` is off. Imports add handlers
/// the workflow doesn't define (gh-aw allows each type once).
pub fn outputs(front: &Map<String, Value>, imports: &[(String, Map<String, Value>)]) -> Value {
    let mut handlers: Map<String, Value> = Map::new();
    let mut jobs: Vec<String> = Vec::new();
    let mut sources = Map::new();
    let declared = std::iter::once((None, front)).chain(imports.iter().map(|(path, front)| (Some(path.as_str()), front)));
    for (via, front) in declared {
        let Some(outputs) = front.get("safe-outputs").and_then(Value::as_object) else {
            continue;
        };
        for (kind, value) in outputs {
            if GLOBAL.contains(&kind.as_str()) || *value == Value::Bool(false) || handlers.contains_key(kind) {
                continue;
            }
            handlers.insert(kind.clone(), handler(kind, value));
            if let Some(via) = via {
                sources.insert(kind.clone(), json!([via]));
            }
        }
        if let Some(custom) = outputs.get("jobs").and_then(Value::as_object) {
            jobs.extend(custom.keys().cloned());
        }
    }
    jobs.sort();
    jobs.dedup();
    let settings = front.get("safe-outputs").and_then(Value::as_object);
    let setting = |key: &str| settings.and_then(|settings| settings.get(key)).cloned().unwrap_or(Value::Null);
    json!({
        "handlers": handlers.into_iter().map(|(_, handler)| handler).collect::<Vec<_>>(),
        "jobs": jobs,
        "staged": setting("staged") == Value::Bool(true),
        "allowedDomains": setting("allowed-domains"),
        "sources": sources,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_handlers_with_their_limits() {
        let front = json!({"safe-outputs": {
            "add-comment": null,
            "create-issue": {"max": 3, "target-repo": "org/tracker", "labels": ["x"]},
            "noop": false,
            "staged": true,
            "jobs": {"notify": {}}
        }});
        let imported = json!({"safe-outputs": {"add-labels": {"allowed": ["bug"]}, "add-comment": {"max": 9}}});
        let outputs = outputs(
            front.as_object().unwrap(),
            &[("shared/a.md".into(), imported.as_object().unwrap().clone())],
        );
        assert_eq!(
            outputs["handlers"],
            json!([
                {"kind": "add-comment", "max": 1, "maxDeclared": false},
                {"kind": "add-labels", "allowed": ["bug"], "max": 5, "maxDeclared": false},
                {"kind": "create-issue", "max": 3, "targetRepo": "org/tracker"}
            ])
        );
        assert_eq!(outputs["jobs"], json!(["notify"]));
        assert_eq!(outputs["staged"], true);
        assert_eq!(outputs["sources"], json!({"add-labels": ["shared/a.md"]}));
    }
}
