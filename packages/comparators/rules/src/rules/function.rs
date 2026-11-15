use super::identifier;
use super::model::{Function, Param};
use super::reader::Reader;
use super::walk::calls;
use crate::types::{self, Ty};
use projections_engine::pointer;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

impl Reader<'_> {
    pub(super) fn function(&mut self, name: &str, value: &Value, path: &str) -> Option<Function> {
        if !self.only(value, &["description", "params", "returns", "variables", "body"], path) {
            return None;
        }
        let mut params = Vec::new();
        for (index, param) in value["params"].as_array().into_iter().flatten().enumerate() {
            let at = pointer(&pointer(path, "params"), &index.to_string());
            let (name, ty) = match param {
                Value::String(name) => (name.as_str(), Ty::Dyn),
                Value::Object(_) => {
                    if !self.only(param, &["name", "type", "values"], &at) {
                        continue;
                    }
                    let ty = match param.get("type").map(|ty| ty.as_str().ok_or("Expected a type")) {
                        None => Ok(Ty::Dyn),
                        Some(Ok(text)) => types::parse(text),
                        Some(Err(message)) => Err(message.to_owned()),
                    };
                    match ty {
                        Ok(ty) => (param["name"].as_str().unwrap_or_default(), ty),
                        Err(message) => {
                            self.error(&pointer(&at, "type"), &message);
                            continue;
                        }
                    }
                }
                _ => {
                    self.error(&at, "Expected a name or `{name, type}`");
                    continue;
                }
            };
            if !identifier(name) || name == "variables" {
                self.error(&at, "Expected an identifier other than `variables`");
                continue;
            }
            let values = self.values(param.get("values"), &pointer(&at, "values"));
            params.push(Param {
                name: name.to_owned(),
                ty,
                values,
            });
        }
        if value.get("params").is_some_and(|params| !params.is_array()) {
            self.error(&pointer(path, "params"), "Expected a list");
        }
        let returns = match value.get("returns").map(|ty| ty.as_str().map(types::parse)) {
            None => None,
            Some(Some(Ok(ty))) => Some(ty),
            Some(Some(Err(message))) => {
                self.error(&pointer(path, "returns"), &message);
                None
            }
            Some(None) => {
                self.error(&pointer(path, "returns"), "Expected a type");
                None
            }
        };
        let mut taken = BTreeSet::new();
        self.params = params.iter().map(|param| param.name.clone()).collect();
        let variables = self.variables(value.get("variables"), &pointer(path, "variables"), &mut taken);
        let body = self.compile(&value["body"], &pointer(path, "body"));
        self.params.clear();
        let body = body?;
        Some(Function {
            name: name.to_owned(),
            params,
            returns,
            variables,
            body,
            location: self.source.location(path),
        })
    }

    /// Functions in an order where each follows the functions it calls; a
    /// cycle is an error.
    pub(super) fn ordered(&mut self, functions: BTreeMap<String, Function>) -> Vec<Function> {
        let names: BTreeSet<String> = functions.keys().cloned().collect();
        let mut pending: BTreeMap<String, (Function, BTreeSet<String>)> = BTreeMap::new();
        for (name, function) in functions {
            let mut called = BTreeSet::new();
            calls(&function.body.parsed, &mut called);
            for variable in &function.variables {
                calls(&variable.expression.parsed, &mut called);
            }
            let needs: BTreeSet<String> = called.into_iter().filter(|called| names.contains(called)).collect();
            if needs.contains(&name) {
                self.error(&function.location.path, &format!("`{name}` calls itself; functions can't recurse"));
                continue;
            }
            pending.insert(name, (function, needs));
        }
        let mut done: BTreeSet<String> = BTreeSet::new();
        let mut result = Vec::new();
        while !pending.is_empty() {
            let ready: Vec<String> = pending
                .iter()
                .filter(|(_, (_, needs))| needs.iter().all(|name| done.contains(name) || !names.contains(name)))
                .map(|(name, _)| name.clone())
                .collect();
            if ready.is_empty() {
                let stuck: Vec<&str> = pending.keys().map(String::as_str).collect();
                self.error(
                    "/functions",
                    &format!("These functions call each other in a cycle: {}", stuck.join(", ")),
                );
                break;
            }
            for name in ready {
                let (function, _) = pending.remove(&name).unwrap();
                done.insert(name);
                result.push(function);
            }
        }
        result
    }
}
