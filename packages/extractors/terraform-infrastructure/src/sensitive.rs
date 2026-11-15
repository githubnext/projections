//! Keeping values Terraform marks sensitive or unknown out of the graph.

use crate::plan::resources_of;
use serde_json::{Value, json};
use std::collections::BTreeSet;

/// Resource values with Terraform's sensitive and unknown markers applied:
/// sensitive values are replaced, never copied, and nulls are dropped. Any
/// other string that contains a value Terraform marked sensitive elsewhere in
/// the document is replaced too, because sensitivity is lost when a value is
/// copied through some attributes (`terraform_data.output`, for one).
pub(crate) fn safe(value: &Value, sensitive: &Value, unknown: &Value, secrets: &Secrets) -> Value {
    if sensitive == &json!(true) {
        return json!("(sensitive value)");
    }
    if unknown == &json!(true) {
        return json!("(known after apply)");
    }
    match value {
        Value::Array(a) => Value::Array(
            a.iter()
                .enumerate()
                .map(|(i, v)| safe(v, &sensitive[i], &unknown[i], secrets))
                .collect(),
        ),
        Value::Object(m) => {
            let keys: BTreeSet<_> = m
                .keys()
                .chain(sensitive.as_object().into_iter().flat_map(|m| m.keys()))
                .chain(unknown.as_object().into_iter().flat_map(|m| m.keys()))
                .collect();
            Value::Object(
                keys.into_iter()
                    .map(|k| (k.clone(), safe(&value[k], &sensitive[k], &unknown[k], secrets)))
                    .filter(|(_, v)| !v.is_null())
                    .collect(),
            )
        }
        Value::String(text) if secrets.reveals(text) => json!("(sensitive value)"),
        _ => value.clone(),
    }
}

/// Every scalar Terraform marks sensitive anywhere in the document.
#[derive(Default)]
pub(crate) struct Secrets(BTreeSet<String>);

impl Secrets {
    pub(crate) fn add(&mut self, value: &Value, sensitive: &Value) {
        match (value, sensitive) {
            (_, Value::Bool(true)) => self.all(value),
            (Value::Array(a), _) => {
                for (i, v) in a.iter().enumerate() {
                    self.add(v, &sensitive[i]);
                }
            }
            (Value::Object(m), _) => {
                for (k, v) in m {
                    self.add(v, &sensitive[k]);
                }
            }
            _ => {}
        }
    }

    fn all(&mut self, value: &Value) {
        match value {
            Value::String(s) if !s.is_empty() => {
                self.0.insert(s.clone());
            }
            Value::Number(n) => {
                self.0.insert(n.to_string());
            }
            Value::Array(a) => a.iter().for_each(|v| self.all(v)),
            Value::Object(m) => m.values().for_each(|v| self.all(v)),
            _ => {}
        }
    }

    fn resources(&mut self, values: Option<&Value>) {
        if let Ok(resources) = resources_of(values, "values") {
            for r in resources {
                self.add(&r["values"], &r["sensitive_values"]);
            }
        }
    }

    pub(crate) fn read(document: &Value) -> Self {
        let mut secrets = Self::default();
        secrets.resources(document.get("planned_values"));
        secrets.resources(document.get("values"));
        secrets.resources(document.get("prior_state").and_then(|s| s.get("values")));
        for change in document["resource_changes"].as_array().into_iter().flatten() {
            let change = &change["change"];
            secrets.add(&change["before"], &change["before_sensitive"]);
            secrets.add(&change["after"], &change["after_sensitive"]);
        }
        if let Some(variables) = document["variables"].as_object() {
            let declared = &document["configuration"]["root_module"]["variables"];
            for (name, variable) in variables {
                if declared[name]["sensitive"] == true {
                    secrets.all(&variable["value"]);
                }
            }
        }
        secrets
    }

    /// Short secrets are matched exactly, longer ones anywhere in the text.
    fn reveals(&self, text: &str) -> bool {
        self.0
            .iter()
            .any(|secret| text == secret || (secret.len() >= 6 && text.contains(secret.as_str())))
    }
}
