//! Single-entity items: functions, constants, statics, type aliases and macros.

use super::builder::{Builder, Declaration};
use super::contract::{api_contract, type_ref};
use super::function::function;
use super::generics::generics;
use super::types::ty;
use serde_json::json;

impl Builder<'_> {
    pub(super) fn function_item(&mut self, d: &Declaration) {
        let (signature, contract) = function(d.name, d.item, d.value, "pub ", "function", self);
        self.entity(d.id, "function", d.name, signature, contract, d.item);
        self.contains(d.parent, d.id);
    }

    pub(super) fn constant(&mut self, d: &Declaration) {
        let (name, value) = (d.name, d.value);
        let constant_type = ty(&value["type"], self);
        let constant = &value["const"];
        let shown = constant["expr"].as_str().unwrap_or("_");
        let constant_value = constant["value"].as_str().unwrap_or(shown);
        self.entity(
            d.id,
            "constant",
            name,
            format!("pub const {name}: {constant_type} = {shown}"),
            api_contract(
                "constant",
                "constant",
                json!({"type": type_ref(&constant_type), "value": constant_value}),
            ),
            d.item,
        );
        self.contains(d.parent, d.id);
    }

    pub(super) fn static_item(&mut self, d: &Declaration) {
        let (name, value) = (d.name, d.value);
        let static_type = ty(&value["type"], self);
        let mutable = value["is_mutable"] == true;
        self.entity(
            d.id,
            "static",
            name,
            format!("pub static {}{name}: {static_type}", if mutable { "mut " } else { "" }),
            api_contract("variable", "static", json!({"type": type_ref(&static_type), "readonly": !mutable})),
            d.item,
        );
        self.contains(d.parent, d.id);
    }

    pub(super) fn type_alias(&mut self, d: &Declaration) {
        let (name, value) = (d.name, d.value);
        let generics = generics(&value["generics"], self);
        let aliased = ty(&value["type"], self);
        self.entity(
            d.id,
            "type",
            name,
            format!("pub type {name}{}{} = {aliased}", generics.params(), generics.clauses()),
            api_contract(
                "alias",
                "type-alias",
                json!({"type": type_ref(&aliased), "typeParameters": generics.type_parameters(),
                    "native": {"where": generics.clauses}}),
            ),
            d.item,
        );
        self.contains(d.parent, d.id);
    }

    pub(super) fn macro_item(&mut self, d: &Declaration, kind: &str) {
        let name = d.name;
        let signature = if kind == "macro" {
            format!("macro_rules! {name}")
        } else {
            format!("proc_macro {name}")
        };
        self.entity(d.id, "macro", name, signature, api_contract("macro", "macro", json!({})), d.item);
        self.contains(d.parent, d.id);
    }
}
