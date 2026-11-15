//! Module addresses, their sources and the module entities that contain resources.

use projections_extractor_sdk::relationship;
use regex::Regex;
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub(crate) fn module_parent(module: &str) -> Option<&str> {
    let (parent, _) = module.rsplit_once(".module.")?;
    Some(parent)
}

/// `module.a[0].module.b` for `module.a[0].module.b.aws_x.y`.
pub(crate) fn module_of(address: &str) -> Option<&str> {
    let mut end = None;
    let mut cursor = 0;
    let bytes = address.as_bytes();
    while address[cursor..].starts_with("module.") {
        let mut i = cursor + "module.".len();
        let mut depth = 0;
        let mut quoted = false;
        while i < bytes.len() {
            match bytes[i] {
                b'"' if depth > 0 => quoted = !quoted,
                b'[' if !quoted => depth += 1,
                b']' if !quoted => depth -= 1,
                b'.' if depth == 0 && !quoted => break,
                _ => {}
            }
            i += 1;
        }
        end = Some(i);
        if i >= bytes.len() {
            break;
        }
        cursor = i + 1;
    }
    end.map(|e| &address[..e])
}

pub(crate) fn module_sources(configuration: Option<&Value>) -> BTreeMap<String, String> {
    fn walk(module: &Value, prefix: &str, out: &mut BTreeMap<String, String>) {
        if let Some(calls) = module["module_calls"].as_object() {
            for (name, call) in calls {
                let address = format!("{prefix}module.{name}");
                if let Some(source) = call["source"].as_str() {
                    out.insert(address.clone(), source.to_owned());
                }
                walk(&call["module"], &format!("{address}."), out);
            }
        }
    }
    let mut out = BTreeMap::new();
    if let Some(root) = configuration.map(|c| &c["root_module"]) {
        walk(root, "", &mut out);
    }
    out
}

pub(crate) fn ensure_module(
    address: &str,
    sources: &BTreeMap<String, String>,
    entities: &mut BTreeMap<String, Value>,
    edges: &mut Vec<Value>,
) {
    if entities.contains_key(address) {
        return;
    }
    let name = address.rsplit_once("module.").map_or(address, |(_, n)| n);
    let mut data = json!({"address":address});
    if let Some(source) = sources.get(&strip_indexes(address)) {
        data["source"] = json!(source);
    }
    entities.insert(
        address.to_owned(),
        json!({"id":address,"kind":"module","label":name,"data":data,"confidence":"authoritative"}),
    );
    if let Some(parent) = module_parent(address) {
        ensure_module(parent, sources, entities, edges);
        edges.push(relationship("contains", parent, address));
    }
}

pub(crate) fn strip_indexes(address: &str) -> String {
    static PATTERN: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    PATTERN
        .get_or_init(|| Regex::new(r#"\[(?:[^\]"\\]|\\.|"(?:[^"\\]|\\.)*")*\]"#).unwrap())
        .replace_all(address, "")
        .into_owned()
}
