//! What a policy's spec declares for its selectors to use: its options (and
//! the mode they set), named lists, selector macros and states.

use super::values::{list, object, scalar, scalars, text};
use super::{List, Mode};
use anyhow::{Result, bail, ensure};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub(super) fn options(spec: &Map<String, Value>, label: &str) -> Result<BTreeMap<String, String>> {
    let mut options = BTreeMap::new();
    for (index, option) in list(spec.get("options"), "spec.options")?.iter().enumerate() {
        let option = object(option, &format!("{label} spec.options[{index}]"))?;
        let option_name = text(option.get("name"), &format!("{label} spec.options[{index}].name"))?;
        let option_value = option.get("value").map(|v| scalar(v, "option value")).transpose()?;
        options.insert(option_name.to_owned(), option_value.unwrap_or_default());
    }
    Ok(options)
}

/// The policy's mode and where it was set.
pub(super) fn mode(options: &BTreeMap<String, String>, label: &str) -> Result<(Mode, &'static str)> {
    Ok(match options.get("policy-mode").map(String::as_str) {
        None => (Mode::Enforce, "default"),
        Some("enforce") => (Mode::Enforce, "spec.options"),
        Some("monitor") => (Mode::Monitor, "spec.options"),
        Some(other) => bail!("{label} policy-mode {other:?} is not enforce or monitor"),
    })
}

pub(super) fn lists(spec: &Map<String, Value>, label: &str) -> Result<BTreeMap<String, List>> {
    let mut lists = BTreeMap::new();
    for (index, item) in list(spec.get("lists"), "spec.lists")?.iter().enumerate() {
        let path = format!("{label} spec.lists[{index}]");
        let item = object(item, &path)?;
        let list_name = text(item.get("name"), &format!("{path}.name"))?;
        let list_type = item.get("type").and_then(Value::as_str).map(str::to_owned);
        let values = scalars(item.get("values"), &format!("{path}.values"))?;
        let pattern = item.get("pattern").and_then(Value::as_str).map(str::to_owned);
        ensure!(
            lists.insert(list_name.to_owned(), (list_type, values, pattern)).is_none(),
            "{label} declares list {list_name} more than once"
        );
    }
    Ok(lists)
}

pub(super) fn macros(spec: &Map<String, Value>, label: &str) -> Result<BTreeMap<String, Map<String, Value>>> {
    let mut macros = BTreeMap::new();
    if let Some(declared) = spec.get("selectorsMacros").filter(|v| !v.is_null()) {
        for (macro_name, selector) in object(declared, &format!("{label} spec.selectorsMacros"))? {
            macros.insert(
                macro_name.clone(),
                object(selector, &format!("{label} spec.selectorsMacros.{macro_name}"))?.clone(),
            );
        }
    }
    Ok(macros)
}

pub(super) fn states(spec: &Map<String, Value>) -> Result<Vec<String>> {
    Ok(list(spec.get("state"), "spec.state")?
        .iter()
        .filter_map(|state| state["name"].as_str().map(str::to_owned))
        .collect())
}
