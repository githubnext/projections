//! What selector actions do: their display text and the effect they have.

use super::fields::{ENFORCING, KNOWN_ACTIONS, RESPONDING, TRACKING};
use super::values::scalar;
use crate::terms::Terms;
use serde_json::{Map, Value};

pub(super) fn action_terms(name: &str, action: &Map<String, Value>) -> Terms {
    let argument = |field: &str| {
        action
            .get(field)
            .filter(|v| !v.is_null())
            .map(|v| scalar(v, field).unwrap_or_default())
    };
    let named = |words: &str| Terms::new().text(words).text(" (").code(name).text(")");
    match name {
        "Sigkill" => named("Kill"),
        "Signal" => match argument("argSig") {
            Some(signal) => Terms::new().text("Send signal ").code(&signal).text(" (").code(name).text(")"),
            None => named("Send signal"),
        },
        "Override" => match argument("argError") {
            Some(error) => Terms::new().text("Deny (").code(name).text(" returns ").code(&error).text(")"),
            None => named("Override"),
        },
        "NotifyEnforcer" => named("Enforce through the enforcer"),
        "Post" => Terms::new().text("Observe"),
        "NoPost" => named("Suppress event"),
        "GetUrl" => match argument("argUrl") {
            Some(url) => Terms::new().text("Request ").code(&url),
            None => named("Request a URL"),
        },
        "DnsLookup" => match argument("argFqdn") {
            Some(fqdn) => Terms::new().text("Look up ").code(&fqdn),
            None => named("Look up a name"),
        },
        "TrackSock" => named("Track socket"),
        "UntrackSock" => named("Stop tracking socket"),
        "UpdateState" => named("Update state"),
        "Set" => named("Set value"),
        other => Terms::new().code(other),
    }
}

/// The strongest effect a selector's actions have.
pub(super) fn effect(names: &[&str]) -> &'static str {
    if names.iter().any(|name| ENFORCING.contains(name)) {
        "enforce"
    } else if names.iter().any(|name| !KNOWN_ACTIONS.contains(name)) {
        "unknown"
    } else if names.iter().any(|name| RESPONDING.contains(name)) {
        "respond"
    } else if !names.contains(&"NoPost") {
        "observe"
    } else if names.iter().any(|name| TRACKING.contains(name)) {
        "track"
    } else {
        "silent"
    }
}
