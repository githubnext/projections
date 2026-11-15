use super::{arity, string_list};
use crate::value::{list, object, string, to_json};
use cel::Value as Cel;
use std::collections::BTreeMap;

pub(super) fn escaped(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        if character == '`' || character == '\\' {
            out.push('\\');
        }
        out.push(character);
    }
    out
}

pub(super) fn code(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 1)?;
    match &args[0] {
        Cel::String(text) => Ok(string(&format!("`{}`", escaped(text)))),
        _ => Err("prose.code takes a string".into()),
    }
}

pub(super) fn escape(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 1)?;
    match &args[0] {
        Cel::String(text) => Ok(string(&escaped(text))),
        _ => Err("prose.escape takes a string".into()),
    }
}

pub(super) fn classify(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 2)?;
    let findings = to_json(&args[0])?;
    let levels = string_list(&args[1], "levels")?;
    let findings =
        findings
            .as_array()
            .ok_or("findings must be a list")?
            .iter()
            .fold(Vec::<serde_json::Value>::new(), |mut kept, finding| {
                if kept.last() != Some(finding) {
                    kept.push(finding.clone());
                }
                kept
            });
    if findings.is_empty() {
        return Err("findings.classify needs at least one finding".into());
    }
    let rank = |finding: &serde_json::Value| {
        let level = finding["level"].as_str().unwrap_or_default();
        levels
            .iter()
            .position(|known| known == level)
            .ok_or_else(|| format!("unknown level `{level}`; levels are {}", levels.join(", ")))
    };
    let mut top = 0;
    for finding in &findings {
        top = top.max(rank(finding)?);
    }
    let at_level: Vec<&serde_json::Value> = findings.iter().filter(|finding| rank(finding).ok() == Some(top)).collect();
    let mut reasons: Vec<&str> = Vec::new();
    for finding in &at_level {
        let reason = finding["reason"].as_str().unwrap_or_default();
        if !reasons.contains(&reason) {
            reasons.push(reason);
        }
    }
    let mut kinds: Vec<&str> = at_level
        .iter()
        .flat_map(|finding| finding["kinds"].as_array().into_iter().flatten())
        .filter_map(serde_json::Value::as_str)
        .collect();
    kinds.sort();
    kinds.dedup();
    let mut fields: BTreeMap<String, Cel> = BTreeMap::new();
    fields.insert("level".into(), string(&levels[top]));
    fields.insert("reason".into(), string(&reasons.join("; ")));
    fields.insert("findings".into(), crate::value::to_cel(&serde_json::Value::Array(findings.clone())));
    if !kinds.is_empty() {
        fields.insert("kinds".into(), list(kinds.iter().map(|kind| string(kind))));
    }
    Ok(object(fields))
}
