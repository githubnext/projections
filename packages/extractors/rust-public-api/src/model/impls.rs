//! Implementations: inherent methods and associated constants, and trait implementations.

use super::builder::Builder;
use super::contract::{api_contract, type_ref};
use super::function::function;
use super::generics::generics;
use super::rustdoc::{inner, key, public};
use super::types::{path, ty};
use anyhow::Result;
use serde_json::{Value, json};

/// Auto traits whose implementations are part of a type's API.
const AUTO_TRAITS: [&str; 5] = ["Send", "Sync", "Unpin", "UnwindSafe", "RefUnwindSafe"];

/// Compiler-internal marker traits that derives implement.
const INTERNAL_TRAITS: [&str; 3] = ["StructuralPartialEq", "Freeze", "UnsafeUnpin"];

impl Builder<'_> {
    /// Inherent methods and associated constants, and trait implementations.
    pub(super) fn impls(&mut self, parent: &str, name: &str, value: &Value) -> Result<()> {
        for implementation in value["impls"].as_array().into_iter().flatten() {
            let implementation = key(implementation)?;
            let Some(item) = self.item(&implementation) else {
                continue;
            };
            let Some(("impl", block)) = inner(item) else {
                continue;
            };
            if !block["blanket_impl"].is_null() {
                continue;
            }
            if block["trait"].is_null() {
                self.inherent(parent, block)?;
            } else {
                self.trait_impl(parent, item, block);
            }
        }
        let _ = name;
        Ok(())
    }

    fn inherent(&mut self, parent: &str, block: &Value) -> Result<()> {
        for member in block["items"].as_array().into_iter().flatten() {
            let member = key(member)?;
            let Some(member) = self.item(&member) else {
                continue;
            };
            if !public(member) {
                continue;
            }
            let member_name = member["name"].as_str().unwrap_or_default();
            let id = format!("{parent}::{member_name}");
            match inner(member) {
                Some(("function", function_value)) => {
                    let (signature, contract) = function(member_name, member, function_value, "pub ", "method", self);
                    self.entity(&id, "method", member_name, signature, contract, member);
                }
                Some(("assoc_const", associated)) => {
                    let const_type = ty(&associated["type"], self);
                    let shown = associated["value"].as_str().unwrap_or("_");
                    self.entity(
                        &id,
                        "constant",
                        member_name,
                        format!("pub const {member_name}: {const_type} = {shown}"),
                        api_contract("constant", "constant", json!({"type": type_ref(&const_type), "value": shown})),
                        member,
                    );
                }
                _ => continue,
            }
            self.contains(parent, &id);
        }
        Ok(())
    }

    fn trait_impl(&mut self, parent: &str, item: &Value, block: &Value) {
        let trait_path = &block["trait"];
        let trait_name = trait_path["path"].as_str().unwrap_or_default();
        let last = trait_name.rsplit("::").next().unwrap_or(trait_name);
        let synthetic = block["is_synthetic"] == true;
        if INTERNAL_TRAITS.contains(&last) || (synthetic && !AUTO_TRAITS.contains(&last)) {
            return;
        }
        let negative = block["is_negative"] == true;
        // A synthetic `!Send` only restates that the `Send` implementation is gone.
        if negative && synthetic {
            return;
        }
        let implemented = format!("{}{}", if negative { "!" } else { "" }, path(trait_path, self));
        let generics = generics(&block["generics"], self);
        let for_type = ty(&block["for"], self);
        let id = format!("{parent}: {implemented}");
        let signature = format!(
            "{}impl{} {implemented} for {for_type}{}",
            if block["is_unsafe"] == true { "unsafe " } else { "" },
            generics.params(),
            generics.clauses()
        );
        let contract = api_contract(
            "implementation",
            "impl",
            json!({"type": type_ref(&for_type), "supertypes": [{"relation": "implements", "type": implemented}],
                "typeParameters": generics.type_parameters(),
                "native": {"synthetic": synthetic, "where": generics.clauses}}),
        );
        let label = format!("impl {implemented}");
        self.entity(&id, "impl", &label, signature, contract, item);
        self.contains(parent, &id);
    }
}
