//! Walking the crate's public modules and emitting entities and containment.

use super::contract::api_contract;
use super::rustdoc::{inner, key, public};
use anyhow::Result;
use projections_extractor_sdk::relationship;
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub(super) struct Builder<'a> {
    pub(super) index: &'a Map<String, Value>,
    pub(super) paths: Option<&'a Map<String, Value>>,
    pub(super) base: &'a str,
    /// Local items reachable through public paths, for sealed-trait detection.
    pub(super) reachable: BTreeSet<String>,
    pub(super) entities: BTreeMap<String, Value>,
    pub(super) relationships: Vec<Value>,
    /// The entity ID each item was first emitted as; later paths re-export it.
    pub(super) emitted: BTreeMap<String, String>,
}

/// An item being emitted: its entity ID, its parent's, its name, the item and its inner value.
pub(super) struct Declaration<'d> {
    pub(super) id: &'d str,
    pub(super) parent: &'d str,
    pub(super) name: &'d str,
    pub(super) item: &'d Value,
    pub(super) value: &'d Value,
}

impl<'a> Builder<'a> {
    pub(super) fn item(&self, id: &str) -> Option<&'a Value> {
        self.index.get(id)
    }

    pub(super) fn local(&self, id: &Value) -> bool {
        key(id).ok().and_then(|id| self.item(&id)).is_some_and(|item| item["crate_id"] == 0)
    }

    /// Marks every public item reachable from a module.
    pub(super) fn reach(&mut self, id: &str, visiting: &mut BTreeSet<String>) {
        if !visiting.insert(id.to_owned()) {
            return;
        }
        let Some(item) = self.item(id) else {
            return;
        };
        self.reachable.insert(id.to_owned());
        if let Some(("module", module)) = inner(item) {
            for child in module["items"].as_array().into_iter().flatten() {
                let Ok(child) = key(child) else { continue };
                let Some(child_item) = self.item(&child) else {
                    continue;
                };
                match inner(child_item) {
                    Some(("use", target)) if public(child_item) => {
                        if let Ok(target) = key(&target["id"]) {
                            self.reach(&target, visiting);
                        }
                    }
                    _ if public(child_item) => self.reach(&child, visiting),
                    _ => {}
                }
            }
        }
    }

    fn evidence(&self, item: &Value) -> Option<Value> {
        let file = item["span"]["filename"].as_str()?;
        let line = item["span"]["begin"][0].as_u64()?;
        if file.starts_with('/') || file.contains("..") {
            return None;
        }
        let source = if self.base == "." {
            file.to_owned()
        } else {
            format!("{}/{file}", self.base)
        };
        Some(json!([{"kind": "source", "source": source, "location": {"line": line}}]))
    }

    pub(super) fn entity(&mut self, id: &str, kind: &str, label: &str, signature: String, contract: Value, item: &Value) {
        let mut entity = json!({"id": id, "kind": kind, "label": label,
            "data": {"signature": signature, "contract": contract}, "confidence": "authoritative"});
        if let Some(evidence) = self.evidence(item) {
            entity["evidence"] = evidence;
        }
        self.entities.insert(id.to_owned(), entity);
    }

    pub(super) fn contains(&mut self, parent: &str, child: &str) {
        self.relationships.push(relationship("contains", parent, child));
    }

    /// A re-export entity at `parent`, of `source`.
    fn re_export(&mut self, id: &str, parent: &str, name: &str, source: &str, item: &Value) {
        self.entity(
            id,
            "re-export",
            name,
            format!("pub use {source};"),
            api_contract("re-export", "re-export", json!({"source": source})),
            item,
        );
        self.contains(parent, id);
    }

    pub(super) fn module(&mut self, module: &Value, parent: &str, path: &str, visiting: &mut BTreeSet<String>) -> Result<()> {
        let Some(("module", inner)) = self::inner(module) else {
            return Ok(());
        };
        for child in inner["items"].as_array().into_iter().flatten() {
            let child = key(child)?;
            let Some(item) = self.item(&child) else {
                continue;
            };
            if !public(item) {
                continue;
            }
            if let Some(("use", target)) = self::inner(item) {
                self.import(item, target, parent, path, visiting)?;
                continue;
            }
            let name = item["name"].as_str().unwrap_or_default().to_owned();
            self.declare(&child, item, &name, parent, path, visiting)?;
        }
        Ok(())
    }

    /// A public `use`: a glob's items, a local item, or a re-export of an external one.
    fn import(&mut self, item: &Value, target: &Value, parent: &str, path: &str, visiting: &mut BTreeSet<String>) -> Result<()> {
        let name = target["name"].as_str().unwrap_or_default();
        let source = target["source"].as_str().unwrap_or(name);
        let target_id = key(&target["id"]).ok();
        if target["is_glob"] == true {
            if let Some(target_item) = target_id.as_deref().and_then(|id| self.item(id)) {
                if visiting.insert(target_id.clone().unwrap()) {
                    self.module(target_item, parent, path, visiting)?;
                }
            }
            return Ok(());
        }
        match target_id.as_deref().and_then(|id| self.item(id)) {
            Some(target_item) if target_item["crate_id"] == 0 => {
                let id = target_id.unwrap();
                self.declare(&id, target_item, name, parent, path, visiting)?;
            }
            _ => {
                let id = format!("rust:{path}::{name}");
                self.re_export(&id, parent, name, source, item);
            }
        }
        Ok(())
    }

    /// Emits an item at `path::name`, or a re-export when another path already has it.
    fn declare(
        &mut self,
        item_id: &str,
        item: &Value,
        name: &str,
        parent: &str,
        path: &str,
        visiting: &mut BTreeSet<String>,
    ) -> Result<()> {
        let full = format!("{path}::{name}");
        let id = format!("rust:{full}");
        if let Some(first) = self.emitted.get(item_id).cloned() {
            if first != id {
                let target = first.trim_start_matches("rust:").to_owned();
                self.re_export(&id, parent, name, &target, item);
            }
            return Ok(());
        }
        self.emitted.insert(item_id.to_owned(), id.clone());
        let Some((kind, value)) = inner(item) else {
            return Ok(());
        };
        let declaration = Declaration {
            id: &id,
            parent,
            name,
            item,
            value,
        };
        match kind {
            "module" => {
                self.entity(
                    &id,
                    "module",
                    name,
                    format!("pub mod {name}"),
                    api_contract("module", "module", json!({})),
                    item,
                );
                self.contains(parent, &id);
                if visiting.insert(item_id.to_owned()) {
                    self.module(item, &id, &full, visiting)?;
                }
            }
            "struct" | "union" => self.structure(&declaration, kind)?,
            "enum" => self.enumeration(&declaration)?,
            "trait" => self.r#trait(&declaration)?,
            "function" => self.function_item(&declaration),
            "constant" => self.constant(&declaration),
            "static" => self.static_item(&declaration),
            "type_alias" => self.type_alias(&declaration),
            "macro" | "proc_macro" => self.macro_item(&declaration, kind),
            _ => {}
        }
        Ok(())
    }
}
