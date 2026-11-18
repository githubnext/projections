//! The `api/v0` extraction of a route table: one entity per route, mount and
//! unresolved declaration, listed by path.

use crate::mapper::{Route, Unresolved};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// A route's ID: its application's directory, its path, then its verbs after a
/// space, which sorts before any path character, so IDs order routes by path
/// with a resource's own routes before those nested under it.
fn id(kind: &str, app: &str, path: &str, verbs: &str) -> String {
    let app = if app.is_empty() { String::new() } else { format!("{app}:") };
    if verbs.is_empty() {
        format!("{kind}:{app}{path}")
    } else {
        format!("{kind}:{app}{path} {verbs}")
    }
}

/// What a route reaches and how it is named and qualified, as one line:
/// `photos#show as photo`, `redirect("/articles")`, `mount Sidekiq::Web as sidekiq_web`.
pub fn signature(route: &Route) -> String {
    let mut signature = match (&route.controller, &route.action, &route.endpoint) {
        (_, _, Some(endpoint)) if route.mount => format!("mount {endpoint}"),
        (_, _, Some(endpoint)) => endpoint.clone(),
        (Some(controller), Some(action), _) => format!("{controller}#{action}"),
        (Some(controller), None, _) => format!("{controller}#:action"),
        _ => String::new(),
    };
    if let Some(name) = &route.name {
        signature.push_str(&format!(" as {name}"));
    }
    if !route.constraints.is_empty() {
        signature.push_str(&format!(" constraints {}", route.constraints.join(", ")));
    }
    if !route.defaults.is_empty() {
        signature.push_str(&format!(" defaults {}", route.defaults.join(", ")));
    }
    for condition in &route.conditions {
        signature.push_str(&format!(" {condition}"));
    }
    signature
}

fn evidence(source: &str, line: usize) -> Value {
    json!([{"kind":"rails-routes","source":source,"location":{"line":line}}])
}

/// Entities for routes and unresolved declarations of the application at `app`
/// (its root directory, `""` at the repository root).
pub fn entities(app: &str, routes: &[Route], unresolved: &[Unresolved]) -> Vec<Value> {
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    let mut unique = |identity: String| {
        let count = seen.entry(identity.clone()).or_default();
        *count += 1;
        if *count == 1 { identity } else { format!("{identity} #{count}") }
    };
    let mut entities = Vec::new();
    for route in routes {
        let verbs = route.verbs.join("|");
        let (kind, label) = if route.mount {
            ("mount", route.path.clone())
        } else {
            ("route", format!("{verbs} {}", route.path))
        };
        let identity = unique(id(kind, app, &route.path, if route.mount { "" } else { &verbs }));
        entities.push(json!({
            "id": identity, "kind": kind, "label": label, "confidence": "authoritative",
            "data": {
                "signature": signature(route), "verbs": route.verbs, "path": route.path, "pattern": route.pattern,
                "controller": route.controller, "action": route.action, "endpoint": route.endpoint, "name": route.name,
                "constraints": route.constraints, "defaults": route.defaults, "conditions": route.conditions,
            },
            "evidence": evidence(&route.source, route.line),
        }));
    }
    for item in unresolved {
        let first = item.text.lines().next().unwrap_or_default().trim();
        let label: String = if first.chars().count() > 80 {
            first.chars().take(79).chain(['…']).collect()
        } else {
            first.to_owned()
        };
        let identity = unique(id("unresolved", app, &format!("{}:{}", item.source, first), ""));
        let mut signature = item.reason.clone();
        for condition in &item.conditions {
            signature.push_str(&format!(" ({condition})"));
        }
        entities.push(json!({
            "id": identity, "kind": "unresolved", "label": label, "confidence": "authoritative",
            "data": {"signature": signature, "text": item.text, "reason": item.reason, "conditions": item.conditions},
            "evidence": evidence(&item.source, item.line),
        }));
    }
    entities
}
