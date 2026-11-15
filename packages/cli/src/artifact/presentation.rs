//! A definition's `presentation`: the viewers' initial settings, which never change extractions.

use anyhow::{Result, ensure};
use serde_json::{Value, json};

use super::{fields, object, parse, values::safe_positive_integer};

/// A definition's `presentation`: initial viewer settings, which viewers can change.
pub(crate) fn presentation_defaults(value: &Value) -> Result<Value> {
    fields(
        value,
        &["highlighting", "changesOnly", "mode", "durationMs", "rendererOptions", "kinds"],
        "presentation",
    )?;
    let choice = |key: &str, allowed: &[&str]| -> Result<Option<Value>> {
        value
            .get(key)
            .map(|choice| {
                let choice = choice.as_str().unwrap_or_default();
                ensure!(
                    allowed.contains(&choice),
                    "presentation.{key} must be one of {}",
                    allowed.join(", ")
                );
                Ok(json!(choice))
            })
            .transpose()
    };
    let mut result = json!({});
    if let Some(highlighting) = choice("highlighting", &["animated", "on", "off"])? {
        result["highlighting"] = highlighting;
    }
    if let Some(mode) = choice("mode", &["animated", "side-by-side", "swipe", "diff"])? {
        result["mode"] = mode;
    }
    if let Some(changes_only) = value.get("changesOnly") {
        ensure!(changes_only.is_boolean(), "presentation.changesOnly must be boolean");
        result["changesOnly"] = changes_only.clone();
    }
    if let Some(duration) = value.get("durationMs") {
        let duration = safe_positive_integer(duration, 120_000.0, "presentation.durationMs")?;
        ensure!(duration >= 500.0, "presentation.durationMs must be an integer from 500 to 120000");
        result["durationMs"] = json!(duration as u64);
    }
    if let Some(options) = value.get("rendererOptions") {
        let options = object(options, "presentation.rendererOptions")?;
        ensure!(options.len() <= 32, "presentation.rendererOptions may set at most 32 controls");
        for (id, option) in options {
            let mut characters = id.chars();
            ensure!(
                id.len() <= 64
                    && characters.next().is_some_and(|c| c.is_ascii_alphanumeric())
                    && characters.all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c)),
                "presentation.rendererOptions has an invalid control ID {id:?}"
            );
            ensure!(
                option.is_string() || option.is_number() || option.is_boolean(),
                "presentation.rendererOptions.{id} must be a string, number or boolean"
            );
        }
        result["rendererOptions"] = parse(&serde_json::to_string(options)?)?;
    }
    if let Some(kinds) = value.get("kinds") {
        result["kinds"] = kind_presentation(kinds)?;
    }
    Ok(result)
}

/// The colors a kind may take (`packages/schemas/src/constants.ts`, `kindColors`): meanings, then the categorical hues.
const KIND_COLORS: &[&str] = &[
    "danger", "warning", "success", "info", "neutral", "blue", "teal", "pink", "lime", "purple", "cyan", "indigo", "sky", "orange",
    "green", "red", "violet", "emerald", "rose", "amber", "citron",
];

/// `presentation.kinds`: per extraction kind, an optional color and summary noun.
fn kind_presentation(value: &Value) -> Result<Value> {
    let kinds = object(value, "presentation.kinds")?;
    ensure!(kinds.len() <= 64, "presentation.kinds may name at most 64 kinds");
    for (kind, entry) in kinds {
        ensure!(
            !kind.is_empty() && kind.chars().count() <= 256,
            "presentation.kinds has an invalid kind {kind:?}"
        );
        let label = format!("presentation.kinds.{kind}");
        fields(entry, &["color", "noun"], &label)?;
        if let Some(color) = entry.get("color") {
            ensure!(
                color.as_str().is_some_and(|color| KIND_COLORS.contains(&color)),
                "{label}.color must be one of {}",
                KIND_COLORS.join(", ")
            );
        }
        if let Some(noun) = entry.get("noun") {
            fields(noun, &["singular", "plural"], &format!("{label}.noun"))?;
            for form in ["singular", "plural"] {
                ensure!(
                    noun.get(form)
                        .and_then(Value::as_str)
                        .is_some_and(|text| !text.trim().is_empty() && text.chars().count() <= 64),
                    "{label}.noun.{form} must be text of 1 to 64 characters"
                );
            }
        }
    }
    parse(&serde_json::to_string(kinds)?)
}
