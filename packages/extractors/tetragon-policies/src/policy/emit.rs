//! A probe's entities and relationships: the probe, its hook, its selectors and
//! the binaries and workloads each selector matches.

use super::fields::{MAX_SELECTORS, SELECTOR_FIELDS};
use super::values::{evidence, list, locate, object, rest, unmodelled, yaml_value};
use super::{Model, Policy, Probe, Site, Summary};
use anyhow::{Result, ensure};
use projections_extractor_sdk::percent;
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

impl Policy<'_> {
    pub(super) fn emit(
        &self,
        model: &mut Model,
        probe: Probe,
        ordinal: usize,
        item: &Map<String, Value>,
        path: &str,
        summary: &mut Summary,
    ) -> Result<()> {
        let mut probe_id = format!("probe:{}/{}", rest(self.policy), rest(&probe.hook));
        if ordinal > 1 {
            probe_id.push_str(&percent(&format!("#{ordinal}")));
        }
        model.hooks.entry(probe.hook.clone()).or_insert_with(
            || json!({"id":probe.hook,"kind":"hook","label":probe.hook_label,"data":probe.hook_data,"confidence":"derived"}),
        );
        model.entities.push(json!({
            "id":probe_id,"kind":"probe","label":probe.hook_label,"confidence":"authoritative","data":probe.data,
            "evidence":evidence(self.document, probe.line),
        }));
        model.relationships.push(
            json!({"id":format!("declares:{probe_id}"),"kind":"declares","from":self.policy,"to":probe_id,"confidence":"authoritative"}),
        );
        model.relationships.push(
            json!({"id":format!("attaches:{probe_id}"),"kind":"attaches","from":probe_id,"to":probe.hook,"confidence":"authoritative"}),
        );
        summary.probes += 1;

        let selectors = list(item.get("selectors"), &format!("{path}.selectors"))?;
        ensure!(
            selectors.len() <= MAX_SELECTORS,
            "{path} has {} selectors; Tetragon allows at most {MAX_SELECTORS}",
            selectors.len()
        );
        let args = list(item.get("args"), "args")?;
        let data_args = list(item.get("data"), "data")?;
        let implicit = Map::new();
        let declared: Vec<(&Map<String, Value>, bool)> = if selectors.is_empty() {
            vec![(&implicit, true)]
        } else {
            selectors
                .iter()
                .enumerate()
                .map(|(index, selector)| Ok((object(selector, &format!("{path}.selectors[{index}]"))?, false)))
                .collect::<Result<_>>()?
        };
        let mut labels = BTreeSet::new();
        for (index, (selector, is_implicit)) in declared.into_iter().enumerate() {
            let selector_path = format!("{path}.selectors[{index}]");
            let label = selector.get("label").and_then(Value::as_str).filter(|l| !l.is_empty());
            if let Some(label) = label {
                ensure!(labels.insert(label.to_owned()), "{path} has two selectors labelled {label}");
            }
            let local = match (is_implicit, label) {
                (true, _) => "*".to_owned(),
                (false, Some(label)) => label.to_owned(),
                (false, None) => format!("#{}", index + 1),
            };
            let id = format!("selector:{}/{}", rest(&probe_id), percent(&local));
            let extra = unmodelled(selector, SELECTOR_FIELDS, &selector_path, &mut model.limitations);
            let selector = self.expand_macros(selector, &selector_path)?;
            let mut data = self.selector(&selector, &selector_path, args, data_args, item, &mut model.limitations)?;
            data["ordinal"] = json!(index + 1);
            if is_implicit {
                data["implicit"] = json!(true);
            }
            if let Some(label) = label {
                data["label"] = json!(label);
            }
            if let Some(extra) = extra {
                data["unmodelled"] = extra;
            }
            model.sites.push(Site {
                selector: id.clone(),
                hook: probe.hook.clone(),
                actions: data["actions"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|action| action["action"].as_str().map(str::to_owned))
                    .collect(),
            });
            match data["effect"].as_str() {
                Some("enforce") => summary.enforcing += 1,
                Some("observe" | "respond") => summary.observing += 1,
                Some("unknown") => summary.unknown += 1,
                _ => {}
            }
            summary.selectors += 1;
            let display = if is_implicit {
                "every call".to_owned()
            } else {
                label.map(str::to_owned).unwrap_or_else(|| format!("selector {}", index + 1))
            };
            let line = label.and_then(|label| locate(self.document, &format!(r#"^\s*-?\s*label:\s*["']?{}["']?\s*$"#, yaml_value(label))));
            model.entities.push(json!({
                "id":id,"kind":"selector","label":display,"confidence":"authoritative","data":data,
                "evidence":evidence(self.document, line),
            }));
            model.relationships.push(json!({
                "id":format!("filters:{id}"),"kind":"filters","from":probe_id,"to":id,
                "data":{"ordinal":index + 1},"confidence":"authoritative"
            }));
            self.selector_subjects(model, &selector, &selector_path, &id)?;
        }
        Ok(())
    }
}
