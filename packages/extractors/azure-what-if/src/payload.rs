//! Resource payloads: which properties are back-references or secrets, and the resource IDs they hold.

use crate::resource_id::{ResourceId, parse_id};
use serde_json::{Value, json};

/// Read-only properties ARM fills in on the *referenced* resource, pointing back
/// at whatever uses it (a subnet's `ipConfigurations`, a disk's `managedBy`).
/// They restate a reference in the opposite direction, so they are neither
/// references nor values.
pub(crate) const BACK_REFERENCES: &[&str] = &[
    "backendIPConfigurations",
    "ipConfiguration",
    "ipConfigurations",
    "loadBalancerBackendAddresses",
    "managedBy",
    "networkInterfaces",
    "privateEndpoint",
    "privateEndpointConnections",
    "privateEndpoints",
    "resourceNavigationLinks",
    "serviceAssociationLinks",
    "subnets",
    "virtualMachine",
];

fn sensitive_name(key: &str) -> bool {
    let key = key.to_lowercase();
    ["password", "secret", "token", "connectionstring", "sas", "credential", "key"]
        .iter()
        .any(|word| key.contains(word))
        && ![
            "id",
            "ids",
            "uri",
            "url",
            "name",
            "names",
            "source",
            "type",
            "version",
            "size",
            "length",
            "expiry",
            "vault",
            "policy",
            "policies",
            "permissions",
        ]
        .iter()
        .any(|suffix| key.ends_with(suffix))
}

pub(crate) fn template_expression(text: &str) -> bool {
    text.starts_with('[') && !text.starts_with("[[") && text.ends_with(']')
}

/// Payload values with secret-named properties replaced and unevaluated template
/// expressions marked; read-only bookkeeping (etag, provisioning state) is dropped.
pub(crate) fn safe(value: &Value) -> Value {
    match value {
        Value::Object(m) => Value::Object(
            m.iter()
                .filter(|(k, v)| !v.is_null() && !["etag", "provisioningState", "resourceGuid"].contains(&k.as_str()))
                .map(|(k, v)| {
                    let v = if sensitive_name(k) && !v.is_boolean() {
                        json!("(sensitive value)")
                    } else {
                        safe(v)
                    };
                    (k.clone(), v)
                })
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(safe).collect()),
        Value::String(s) if template_expression(s) => json!("(known after deployment)"),
        _ => value.clone(),
    }
}

/// Every string in a payload that parses as a resource ID, with a readable property path.
pub(crate) fn resource_ids(value: &Value, path: &mut Vec<String>, found: &mut Vec<(String, ResourceId)>) {
    match value {
        Value::Object(m) => {
            for (k, v) in m {
                path.push(k.clone());
                resource_ids(v, path, found);
                path.pop();
            }
        }
        Value::Array(a) => a.iter().for_each(|v| resource_ids(v, path, found)),
        Value::String(s) => {
            if let Some(id) = parse_id(s) {
                let mut readable: Vec<&str> = path.iter().map(String::as_str).filter(|p| *p != "properties").collect();
                if readable.last() == Some(&"id") && readable.len() > 1 {
                    readable.pop();
                }
                found.push((readable.join("."), id));
            }
        }
        _ => {}
    }
}
