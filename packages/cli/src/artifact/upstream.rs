//! A custom extractor's `upstream`: built-in extractions of the same revision
//! the command receives, by name.

use anyhow::{Result, ensure};
use serde_json::{Map, Value, json};

use super::values::{fields, identifier, object, parse};

/// The most built-in extractions one command may build on.
const MAX_UPSTREAM: usize = 8;

/// `extractor.upstream`, validated: 1-8 names, each a built-in extractor with
/// optional inputs. Each runs as the projection `<id>.<name>`.
pub(super) fn normalized_upstream(value: &Value, id: &str) -> Result<Value> {
    let entries = object(value, "extractor.upstream")?;
    ensure!(
        (1..=MAX_UPSTREAM).contains(&entries.len()),
        "extractor.upstream names 1-{MAX_UPSTREAM} built-in extractors"
    );
    let mut normalized = Map::new();
    for (name, entry) in entries {
        identifier(&json!(name), "extractor.upstream name")?;
        ensure!(
            id.len() + 1 + name.len() <= 100,
            "extractor.upstream name {name} is too long: the upstream extraction's ID, {id}.{name}, must fit in 100 characters"
        );
        let label = format!("extractor.upstream.{name}");
        fields(entry, &["extractor", "inputs"], &label)?;
        let extractor = identifier(&entry["extractor"], &format!("{label}.extractor"))?;
        ensure!(
            projections_extractor_catalog::exists(extractor),
            "{label}.extractor must name a built-in extractor, not {extractor}; upstream extractions come only from built-ins"
        );
        let mut upstream = json!({"extractor": extractor});
        if let Some(inputs) = entry.get("inputs") {
            let inputs = parse(&serde_json::to_string(inputs)?)?;
            object(&inputs, &format!("{label}.inputs"))?;
            upstream["inputs"] = inputs;
        }
        normalized.insert(name.clone(), upstream);
    }
    Ok(Value::Object(normalized))
}
