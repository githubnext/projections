//! Traits and their methods, associated types and associated constants.

use super::builder::{Builder, Declaration};
use super::contract::{api_contract, type_ref};
use super::function::function;
use super::generics::{bound_list, generics};
use super::rustdoc::{inner, key};
use super::types::ty;
use anyhow::Result;
use serde_json::{Value, json};

impl Builder<'_> {
    pub(super) fn r#trait(&mut self, d: &Declaration) -> Result<()> {
        let (id, name, item, value) = (d.id, d.name, d.item, d.value);
        let generics = generics(&value["generics"], self);
        let supertraits = bound_list(&value["bounds"], self);
        let sealed = self.sealed(value);
        let unsafe_ = value["is_unsafe"] == true;
        let signature = format!(
            "pub {}trait {name}{}{}{}",
            if unsafe_ { "unsafe " } else { "" },
            generics.params(),
            if supertraits.is_empty() {
                String::new()
            } else {
                format!(": {}", supertraits.join(" + "))
            },
            generics.clauses()
        );
        let contract = api_contract(
            "interface",
            "trait",
            json!({"sealed": sealed, "typeParameters": generics.type_parameters(),
                "supertypes": supertraits.iter().map(|bound| json!({"relation": "extends", "type": bound})).collect::<Vec<_>>(),
                "native": {"unsafe": unsafe_, "dynCompatible": value["is_dyn_compatible"] != false, "where": generics.clauses}}),
        );
        self.entity(id, "trait", name, signature, contract, item);
        self.contains(d.parent, id);
        for child in value["items"].as_array().into_iter().flatten() {
            let child = key(child)?;
            let Some(child) = self.item(&child) else {
                continue;
            };
            let child_name = child["name"].as_str().unwrap_or_default();
            let child_id = format!("{id}::{child_name}");
            if self.member(&child_id, child_name, child) {
                self.contains(id, &child_id);
            }
        }
        Ok(())
    }

    /// A supertrait outside the public API can't be implemented downstream, so neither can this trait.
    fn sealed(&self, value: &Value) -> bool {
        value["bounds"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|bound| bound["trait_bound"]["trait"]["id"].as_u64())
            .any(|bound| {
                let bound = bound.to_string();
                self.local(&json!(bound)) && !self.reachable.contains(&bound)
            })
    }

    /// Emits a trait's method, associated type or associated constant; false for other members.
    fn member(&mut self, child_id: &str, child_name: &str, child: &Value) -> bool {
        match inner(child) {
            Some(("function", function_value)) => {
                let (mut signature, mut contract) = function(child_name, child, function_value, "", "trait-method", self);
                let default = function_value["has_body"] == true;
                if !default {
                    contract["abstract"] = json!(true);
                }
                signature.push_str(if default { " { … }" } else { ";" });
                self.entity(child_id, "method", child_name, signature, contract, child);
            }
            Some(("assoc_type", associated)) => {
                let default = associated["type"].is_object();
                let item_bounds = bound_list(&associated["bounds"], self);
                let mut signature = format!("type {child_name}");
                if !item_bounds.is_empty() {
                    signature.push_str(&format!(": {}", item_bounds.join(" + ")));
                }
                if default {
                    signature.push_str(&format!(" = {}", ty(&associated["type"], self)));
                }
                self.entity(
                    child_id,
                    "type",
                    child_name,
                    signature,
                    api_contract(
                        "associated-type",
                        "associated-type",
                        json!({"abstract": !default, "constraints": item_bounds}),
                    ),
                    child,
                );
            }
            Some(("assoc_const", associated)) => {
                let default = !associated["value"].is_null();
                let const_type = ty(&associated["type"], self);
                self.entity(
                    child_id,
                    "constant",
                    child_name,
                    format!("const {child_name}: {const_type}"),
                    api_contract(
                        "constant",
                        "associated-const",
                        json!({"type": type_ref(&const_type), "abstract": !default}),
                    ),
                    child,
                );
            }
            _ => return false,
        }
        true
    }
}
