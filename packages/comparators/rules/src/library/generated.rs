use super::{arity, string_list};
use crate::value::{list, string, to_json};
use cel::Value as Cel;
use projections_engine::utf16_cmp;
use std::collections::HashMap;

pub(super) fn generated_because(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 1)?;
    let change = to_json(&args[0])?;
    let mut parts: Vec<&str> = change["varied"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|varied| varied["generated"] == true)
        .flat_map(|varied| varied["because"].as_array().into_iter().flatten())
        .filter_map(serde_json::Value::as_str)
        .collect();
    parts.sort_by(|a, b| utf16_cmp(a, b));
    parts.dedup();
    Ok(list(parts.into_iter().map(string)))
}

/// `generated.only`, given whether each one-to-one change (by collection and
/// ID) differs outside its volatile values.
pub fn generated_only(residual: &HashMap<(String, String), bool>, args: &[Cel]) -> Result<Cel, String> {
    arity(args, 2)?;
    let change = to_json(&args[0])?;
    let parts = string_list(&args[1], "parts")?;
    let text = |key: &str| change[key].as_str().unwrap_or_default().to_owned();
    if !matches!(text("correspondence").as_str(), "exact" | "declared") {
        return Ok(Cel::Bool(false));
    }
    let Some(differs) = residual.get(&(text("collection"), text("id"))) else {
        return Ok(Cel::Bool(false));
    };
    let varied: Vec<&serde_json::Value> = change["varied"].as_array().into_iter().flatten().collect();
    let moved = |entry: &serde_json::Value| {
        entry["generated"] == true
            && entry["within"] == false
            && entry.get("reason").is_none_or(serde_json::Value::is_null)
            && entry["because"].as_array().is_some_and(|because| !because.is_empty())
    };
    let only = !differs
        && varied.iter().any(|entry| moved(entry))
        && varied.iter().all(|entry| {
            entry["within"] == true
                || (moved(entry)
                    && entry["because"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .all(|part| part.as_str().is_some_and(|part| parts.iter().any(|p| p == part))))
        });
    Ok(Cel::Bool(only))
}
