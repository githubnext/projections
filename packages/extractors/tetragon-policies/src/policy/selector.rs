//! A selector's data: its macros expanded, its conditions, binaries and
//! actions, and the effect those actions have under the policy's mode.

use super::actions::{action_terms, effect};
use super::conditions::condition;
use super::fields::{FILTERS, KNOWN_ACTIONS, LIST_FIELDS, MAX_ACTIONS};
use super::values::{code, flag, list, object, scalars, text};
use super::{Mode, Policy};
use crate::terms::Terms;
use anyhow::{Context, Result, ensure};
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

impl Policy<'_> {
    /// Appends each named macro's filters to the selector's own.
    pub(super) fn expand_macros(&self, selector: &Map<String, Value>, path: &str) -> Result<Map<String, Value>> {
        let mut expanded = selector.clone();
        for name in scalars(selector.get("macros"), &format!("{path}.macros"))? {
            let declared = self
                .macros
                .get(&name)
                .with_context(|| format!("{path} uses undefined selector macro {name}"))?;
            for (field, value) in declared {
                if FILTERS.contains(&field.as_str()) || LIST_FIELDS.contains(&field.as_str()) {
                    let mut items = list(expanded.get(field), field)?.to_vec();
                    items.extend(list(Some(value), field)?.iter().cloned());
                    expanded.insert(field.clone(), Value::Array(items));
                } else if !expanded.contains_key(field) {
                    expanded.insert(field.clone(), value.clone());
                }
            }
        }
        Ok(expanded)
    }

    pub(super) fn selector(
        &self,
        selector: &Map<String, Value>,
        path: &str,
        args: &[Value],
        data_args: &[Value],
        item: &Map<String, Value>,
        limitations: &mut BTreeSet<String>,
    ) -> Result<Value> {
        let mut conditions = vec![];
        for field in FILTERS {
            for (index, filter) in list(selector.get(*field), field)?.iter().enumerate() {
                let filter_path = format!("{path}.{field}[{index}]");
                let filter = object(filter, &filter_path)?;
                conditions.push(condition(field, filter, &filter_path, args, data_args, item)?);
            }
        }
        if let Some(cel) = selector.get("matchCEL").filter(|v| !v.is_null()) {
            let expression = text(cel.get("expr"), &format!("{path}.matchCEL.expr"))?;
            let terms = Terms::new().text("CEL ").code(expression);
            conditions.push(json!({"filter":"matchCEL","expression":expression,"display":terms.prose(),"opaque":true}));
            limitations.insert(format!(
                "{} is shown as text; its meaning isn't interpreted.",
                code(&format!("{path}.matchCEL"))
            ));
        }
        let mut binaries = vec![];
        for (field, parent) in [("matchBinaries", false), ("matchParentBinaries", true)] {
            for (index, binary) in list(selector.get(field), field)?.iter().enumerate() {
                let follow = flag(
                    binary.get("followChildren"),
                    false,
                    &format!("{path}.{field}[{index}].followChildren"),
                )?;
                binaries.push(json!({
                    "operator":binary["operator"],"values":scalars(binary.get("values"), field)?,
                    "followChildren":follow,"parent":parent
                }));
            }
        }
        let mut actions = vec![];
        for (field, phase) in [("matchActions", "call"), ("matchReturnActions", "return")] {
            let declared = list(selector.get(field), field)?;
            ensure!(
                declared.len() <= MAX_ACTIONS,
                "{path}.{field} has {} actions; Tetragon allows at most {MAX_ACTIONS}",
                declared.len()
            );
            for (index, action) in declared.iter().enumerate() {
                let action_path = format!("{path}.{field}[{index}]");
                let action = object(action, &action_path)?;
                let name = text(action.get("action"), &format!("{action_path}.action"))?;
                if !KNOWN_ACTIONS.contains(&name) {
                    limitations.insert(format!(
                        "{} uses action {}, which Projections doesn't know; its effect is unknown.",
                        code(&action_path),
                        code(name)
                    ));
                }
                let mut entry = action.clone();
                entry.insert("phase".into(), json!(phase));
                let terms = action_terms(name, action);
                entry.insert("display".into(), json!(terms.prose()));
                actions.push(Value::Object(entry));
            }
        }
        let names: Vec<&str> = actions.iter().filter_map(|action| action["action"].as_str()).collect();
        let effect = effect(&names);
        let enforcement = match (effect, self.mode) {
            ("enforce", Mode::Enforce) => "active",
            ("enforce", Mode::Monitor) => "elided",
            _ => "none",
        };
        let macros = scalars(selector.get("macros"), "macros")?;
        let mut data = json!({
            "conditions":conditions,"binaries":binaries,"actions":actions,
            "effect":effect,"enforcement":enforcement,
        });
        if !macros.is_empty() {
            data["macros"] = json!(macros);
        }
        Ok(data)
    }
}
