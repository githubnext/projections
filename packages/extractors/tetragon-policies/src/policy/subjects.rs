//! The subjects a selector names: the binaries it matches or excludes and the
//! workloads it is limited to.

use super::values::{flag, list, object, rest, scalars, text};
use super::{Model, Policy};
use crate::scope::Workloads;
use anyhow::{Result, bail};
use projections_extractor_sdk::{key, percent};
use serde_json::{Map, Value, json};

impl Policy<'_> {
    pub(super) fn selector_subjects(&self, model: &mut Model, selector: &Map<String, Value>, selector_path: &str, id: &str) -> Result<()> {
        for (field, parent) in [("matchBinaries", false), ("matchParentBinaries", true)] {
            for (filter_index, binary) in list(selector.get(field), field)?.iter().enumerate() {
                let filter_path = format!("{selector_path}.{field}[{filter_index}]");
                let operator = text(binary.get("operator"), &format!("{filter_path}.operator"))?;
                let (negated, matching) = match operator {
                    "In" => (false, "exact"),
                    "NotIn" => (true, "exact"),
                    "Prefix" => (false, "prefix"),
                    "NotPrefix" => (true, "prefix"),
                    "Postfix" => (false, "suffix"),
                    "NotPostfix" => (true, "suffix"),
                    other => bail!("{filter_path}.operator {other} is not a binary operator"),
                };
                for value in scalars(binary.get("values"), &format!("{filter_path}.values"))? {
                    let subject = key(&["subject", "binary", matching, &value]);
                    model.subjects.entry(subject.clone()).or_insert_with(
                        || json!({"id":subject,"kind":"subject","label":value,"data":{"subjectKind":"binary","match":matching}}),
                    );
                    let role = if parent { "parent" } else { "self" };
                    model.relationships.push(json!({
                        "id":format!("binary:{}/{role}/{matching}/{}", rest(id), percent(&value)),
                        "kind":if negated {"excludes"} else {"matches"},"from":id,"to":subject,
                        "data":{"operator":operator,"parent":parent,"followChildren":flag(binary.get("followChildren"), false)},
                        "confidence":"authoritative"
                    }));
                }
            }
        }
        if let Some(workloads) = selector.get("matchWorkloads").filter(|v| !v.is_null()) {
            let workloads = Workloads::from(
                object(workloads, &format!("{selector_path}.matchWorkloads"))?,
                &format!("{selector_path}.matchWorkloads"),
                self.namespace.clone(),
            )?;
            let subject = key(&["subject", "workloads", &workloads.text()]);
            model
                .subjects
                .entry(subject.clone())
                .or_insert_with(|| json!({"id":subject,"kind":"subject","label":workloads.text(),"data":workloads.data()}));
            model.relationships.push(json!({
                "id":format!("applies-to:{id}"),"kind":"applies-to","from":id,"to":subject,
                "confidence":"authoritative"
            }));
        }
        Ok(())
    }
}
