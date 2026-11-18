//! One scenario: its renderer, its extraction or before and after, and its
//! comparator, compared when the loader compares.

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::path::Path;

use super::{
    MAX_EXTRACTION_BYTES, MAX_RULES_BYTES,
    loader::Loader,
    read::{bounded_text, json_text, lexical, local_path, read},
};
use crate::artifact::{self, fields, identifier, object};

#[derive(Clone)]
pub(super) struct Rules {
    pub(super) bytes: Vec<u8>,
    pub(super) digest: String,
}

impl Loader<'_> {
    pub(super) fn scenario(
        &mut self,
        scenario: &Value,
        directory: &Path,
        default_renderer: Option<&Value>,
        label: &str,
        entry: &mut Value,
    ) -> Result<()> {
        fields(
            scenario,
            &[
                "id",
                "title",
                "group",
                "description",
                "renderer",
                "before",
                "after",
                "extraction",
                "comparator",
                "presentation",
            ],
            label,
        )?;
        entry["title"] = json!(bounded_text(&scenario["title"], &format!("{label}.title"), 1000)?);
        if let Some(group) = scenario.get("group") {
            entry["group"] = json!(bounded_text(group, &format!("{label}.group"), 1000)?);
        }
        if let Some(description) = scenario.get("description") {
            entry["description"] = json!(bounded_text(description, &format!("{label}.description"), 4096)?);
        }
        entry["renderer"] = match scenario.get("renderer") {
            Some(renderer) => self.scenario_renderer(renderer, directory, &format!("{label}.renderer"))?,
            None => default_renderer
                .cloned()
                .with_context(|| format!("{label} has no renderer and the document names none"))?,
        };
        if let Some(presentation) = scenario.get("presentation") {
            entry["presentation"] = artifact::presentation_defaults(presentation)?;
        }
        let comparison = match (scenario.get("extraction"), scenario.get("before"), scenario.get("after")) {
            (Some(extraction), None, None) => {
                ensure!(scenario.get("comparator").is_none(), "{label}.comparator requires before and after");
                let extraction = self.extraction(extraction, directory, &format!("{label}.extraction"))?;
                entry["subject"] = json!({"mode": "extraction", "extraction": extraction});
                return Ok(());
            }
            (None, Some(before), Some(after)) => {
                let before = self.extraction(before, directory, &format!("{label}.before"))?;
                let after = self.extraction(after, directory, &format!("{label}.after"))?;
                ensure!(
                    before["schema"] == after["schema"],
                    "{label}: before and after must share one domain schema"
                );
                (before, after)
            }
            (Some(_), _, _) => bail!("{label} has either extraction or before and after, not both"),
            _ => bail!("{label} requires extraction, or before and after"),
        };
        let (comparator, rules) = self.comparator(scenario.get("comparator"), directory, label)?;
        if self.compare {
            let (before, after) = &comparison;
            match rules {
                Some((path, rules)) => {
                    artifact::run_custom_comparator(path, &rules.bytes, before, after, &comparator["options"])?;
                }
                None => {
                    artifact::default_comparison(before, after, &comparator["options"])?;
                }
            }
        }
        entry["subject"] = json!({"mode": "comparison", "before": comparison.0, "after": comparison.1});
        entry["comparator"] = comparator;
        Ok(())
    }

    /// A renderer name, or `{"bundle": <dir>}` resolved to `{"bundle": <key>}`.
    pub(super) fn scenario_renderer(&mut self, value: &Value, directory: &Path, label: &str) -> Result<Value> {
        if value.is_string() {
            return Ok(json!(identifier(value, label)?));
        }
        fields(value, &["bundle"], label)?;
        let bundle = local_path(&value["bundle"], &format!("{label}.bundle"))?;
        Ok(json!({"bundle": self.scenario_bundle(&directory.join(bundle))}))
    }

    fn extraction(&mut self, value: &Value, directory: &Path, label: &str) -> Result<Value> {
        if value.is_object() {
            return projections_engine::normalize(value, "")
                .map_err(failure)
                .with_context(|| format!("{label} is not a valid extraction"));
        }
        ensure!(value.is_string(), "{label} must be an extraction object or a relative path to one");
        let written = local_path(value, label)?;
        let path = lexical(&directory.join(written));
        self.watched.push(path.clone());
        self.extractions
            .entry(path.clone())
            .or_insert_with(|| read_extraction(&path).map_err(|failure| format!("{failure:#}")))
            .clone()
            .map_err(|failure| anyhow::anyhow!("{label} {written}: {failure}"))
    }

    /// The scenario's comparator response and, for a comparator file, its path and bytes.
    fn comparator<'v>(&mut self, value: Option<&'v Value>, directory: &Path, label: &str) -> Result<(Value, Option<(&'v str, Rules)>)> {
        let label = format!("{label}.comparator");
        let Some(comparator) = value else {
            return Ok((json!({"default": true, "options": {}}), None));
        };
        // A string or an object with `file` is a comparator file; an object
        // without `file` is the default comparator.
        let (file, options) = if comparator.is_string() {
            (Some(comparator), None)
        } else {
            object(comparator, &label)?;
            ensure!(
                comparator.get("rules").is_none(),
                "{label}.rules was renamed: name the comparator file directly, `\"comparator\": \"<path>.comparator.yaml\"`, or `{{\"file\": \"<path>.comparator.yaml\", \"options\": {{...}}}}`; comparator files end in `.comparator.yaml`. See {}",
                artifact::COMPARATOR_DOCS
            );
            (comparator.get("file"), comparator.get("options"))
        };
        let Some(file) = file else {
            fields(comparator, &["options"], &label)?;
            let options = comparator.get("options").cloned().unwrap_or_else(|| json!({}));
            artifact::default_comparator_options(&options).with_context(|| format!("{label}.options are invalid"))?;
            return Ok((json!({"default": true, "options": options}), None));
        };
        let file_label = if comparator.is_string() {
            label.clone()
        } else {
            fields(comparator, &["file", "options"], &label)?;
            format!("{label}.file")
        };
        let written = local_path(file, &file_label)?;
        ensure!(
            projections_comparator_runtime::is_comparator_file(written),
            "{file_label} must name a comparator file, ending in `.comparator.yaml` or `.comparator.yml`"
        );
        let options = match options {
            Some(options) => {
                let options = artifact::parse(&serde_json::to_string(options)?)?;
                object(&options, &format!("{label}.options"))?;
                options
            }
            None => json!({}),
        };
        let path = lexical(&directory.join(written));
        self.watched.push(path.clone());
        let rules = self
            .rules
            .entry(path.clone())
            .or_insert_with(|| read_rules(&path, written).map_err(|failure| format!("{failure:#}")))
            .clone()
            .map_err(|failure| anyhow::anyhow!("{file_label} {written}: {failure}"))?;
        Ok((
            json!({
                "rules": artifact::base64(&rules.bytes), "id": written,
                "digest": rules.digest, "options": options,
            }),
            Some((written, rules)),
        ))
    }
}

/// A raw extraction, or a saved `projections.extraction` document's extraction.
fn read_extraction(path: &Path) -> Result<Value> {
    let value = json_text(&read(path, MAX_EXTRACTION_BYTES)?, "Extraction file")?;
    match value.get("format") {
        Some(format) if format == "projections.extraction" => Ok(artifact::validate_extraction(&value)?["extraction"].clone()),
        Some(_) => bail!("Unsupported document format; expected an extraction or a projections.extraction document"),
        None => projections_engine::normalize(&value, "").map_err(failure),
    }
}

fn read_rules(path: &Path, written: &str) -> Result<Rules> {
    let bytes = read(path, MAX_RULES_BYTES)?;
    let loaded = artifact::load_comparator(written, &bytes)?;
    Ok(Rules {
        digest: loaded.digest().to_owned(),
        bytes,
    })
}

fn failure(failure: projections_engine::Failure) -> anyhow::Error {
    anyhow::anyhow!("{}", failure.iter().map(ToString::to_string).collect::<Vec<_>>().join("; "))
}
