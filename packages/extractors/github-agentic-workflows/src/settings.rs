//! How a workflow runs: its engine and model, its budgets (timeout, turns,
//! AI credits), custom jobs and steps, concurrency, strict mode and the
//! secrets its front matter references.

use regex::Regex;
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;
use std::sync::LazyLock;

/// The engine gh-aw runs when a workflow names none.
const DEFAULT_ENGINE: &str = "copilot";

/// `{id, model?, version?, declared}`: `engine` as a string or object, with
/// the top-level `model` when the engine names none.
pub fn engine(front: &Map<String, Value>) -> Value {
    let declared = front.get("engine");
    let (id, model, version) = match declared {
        Some(Value::String(id)) => (Some(id.clone()), None, None),
        Some(Value::Object(engine)) => (
            engine.get("id").and_then(Value::as_str).map(str::to_owned),
            engine.get("model").cloned(),
            engine.get("version").cloned(),
        ),
        _ => (None, None, None),
    };
    let mut engine = Map::new();
    engine.insert("id".into(), json!(id.unwrap_or_else(|| DEFAULT_ENGINE.to_owned())));
    if let Some(model) = model.or_else(|| front.get("model").cloned()) {
        engine.insert("model".into(), model);
    }
    if let Some(version) = version {
        engine.insert("version".into(), version);
    }
    engine.insert("declared".into(), json!(declared.is_some()));
    Value::Object(engine)
}

/// A budget's value: a number, `unlimited`, or an expression or other text as written.
/// AI credits accept `1k` and `1M` and use `-1` to turn the budget off.
fn amount(value: &Value, credits: bool) -> Value {
    let value = value.get("value").unwrap_or(value);
    match value {
        Value::Number(number) if credits && number.as_i64() == Some(-1) => json!("unlimited"),
        Value::String(text) if credits => {
            let text = text.trim();
            let (digits, scale) = match text.chars().last() {
                Some('k' | 'K') => (&text[..text.len() - 1], 1_000.0),
                Some('m' | 'M') => (&text[..text.len() - 1], 1_000_000.0),
                _ => (text, 1.0),
            };
            match digits.parse::<f64>() {
                Ok(-1.0) if scale == 1.0 => json!("unlimited"),
                Ok(number) if number.is_finite() && (number * scale).fract() == 0.0 => json!((number * scale) as i64),
                _ => json!(text),
            }
        }
        other => other.clone(),
    }
}

/// Each budget as `{value, declared}`, with gh-aw's default where it has one:
/// 20 minutes, 1000 AI credits per run, no daily AI credit limit. Turn and tool
/// call caps appear only when declared.
pub fn limits(front: &Map<String, Value>) -> Value {
    let mut limits = Map::new();
    let mut add = |name: &str, key: &str, default: Option<Value>, credits: bool| {
        let entry = match (front.get(key), default) {
            (Some(value), _) => json!({"value": amount(value, credits), "declared": true}),
            (None, Some(default)) => json!({"value": default, "declared": false}),
            (None, None) => return,
        };
        limits.insert(name.to_owned(), entry);
    };
    add("timeoutMinutes", "timeout-minutes", Some(json!(20)), false);
    add("maxTurns", "max-turns", None, false);
    add("maxToolCalls", "max-tool-calls", None, false);
    add("maxAiCredits", "max-ai-credits", Some(json!(1000)), true);
    add("maxDailyAiCredits", "max-daily-ai-credits", Some(json!("unlimited")), true);
    Value::Object(limits)
}

fn count(front: &Map<String, Value>, key: &str) -> usize {
    front.get(key).and_then(Value::as_array).map_or(0, Vec::len)
}

/// Custom jobs by name, and how many custom steps run where, leaving out what's absent.
pub fn custom(front: &Map<String, Value>) -> Value {
    let mut jobs: Vec<&String> = front
        .get("jobs")
        .and_then(Value::as_object)
        .map(|jobs| jobs.keys().collect())
        .unwrap_or_default();
    jobs.sort();
    let steps: Map<String, Value> = [
        ("steps", "steps"),
        ("pre-steps", "preSteps"),
        ("pre-agent-steps", "preAgentSteps"),
        ("post-steps", "postSteps"),
    ]
    .iter()
    .filter(|(key, _)| count(front, key) > 0)
    .map(|(key, name)| ((*name).to_owned(), json!(count(front, key))))
    .collect();
    json!({"jobs": jobs, "steps": steps})
}

/// The concurrency group, as written.
pub fn concurrency(front: &Map<String, Value>) -> Value {
    match front.get("concurrency") {
        Some(Value::Object(settings)) => settings.get("group").cloned().unwrap_or(Value::Null),
        Some(other) => other.clone(),
        None => Value::Null,
    }
}

static SECRET: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\bsecrets(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*'([^']+)'\s*\]|\[\s*"([^"]+)"\s*\])"#).unwrap());

/// The secrets the values of `front` reference (`${{ secrets.NAME }}`, or
/// `${{ secrets['NAME'] }}`), added to `found`.
pub fn secrets(value: &Value, found: &mut BTreeSet<String>) {
    match value {
        Value::String(text) => found.extend(
            SECRET
                .captures_iter(text)
                .filter_map(|capture| capture.iter().skip(1).flatten().next().map(|name| name.as_str().to_owned())),
        ),
        Value::Array(items) => items.iter().for_each(|item| secrets(item, found)),
        Value::Object(fields) => fields.values().for_each(|item| secrets(item, found)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_engine_budgets_and_secrets() {
        let front = json!({
            "engine": {"id": "claude", "model": "sonnet"},
            "timeout-minutes": 30,
            "max-ai-credits": "2k",
            "max-daily-ai-credits": {"value": -1},
            "jobs": {"setup": {}, "bench": {}},
            "post-steps": [{}],
            "concurrency": {"group": "ci-${{ github.ref }}"},
            "mcp-servers": {"x": {"env": {"TOKEN": "${{ secrets.X_TOKEN }} ${{secrets.OTHER}}"}}},
            "imports": [{"path": "x.md", "with": {"a": "${{ secrets['QUOTED'] }}", "b": "${{ secrets[\"DOUBLE\"] }}"}}]
        });
        let front = front.as_object().unwrap();
        assert_eq!(engine(front), json!({"id": "claude", "model": "sonnet", "declared": true}));
        assert_eq!(
            limits(front),
            json!({
                "timeoutMinutes": {"value": 30, "declared": true},
                "maxAiCredits": {"value": 2000, "declared": true},
                "maxDailyAiCredits": {"value": "unlimited", "declared": true}
            })
        );
        assert_eq!(custom(front), json!({"jobs": ["bench", "setup"], "steps": {"postSteps": 1}}));
        assert_eq!(concurrency(front), "ci-${{ github.ref }}");
        let mut found = BTreeSet::new();
        secrets(&Value::Object(front.clone()), &mut found);
        assert_eq!(found.into_iter().collect::<Vec<_>>(), ["DOUBLE", "OTHER", "QUOTED", "X_TOKEN"]);
        assert_eq!(engine(&Map::new())["id"], "copilot");
    }
}
