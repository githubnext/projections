//! Symbol graphs to `api/v0`: each public symbol of the selected modules,
//! with its declaration and contract, under its module or the type it is a
//! member of. Members a module adds to another module's types are grouped
//! under an extension of that type.

mod contract;
mod fragments;

use anyhow::{Result, ensure};
use contract::Facts;
use projections_extractor_sdk::{extraction, relationship};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// Conformances every type has implicitly, which say nothing about its API.
const IMPLICIT: [&str; 3] = ["Swift.Copyable", "Swift.Escapable", "Swift.SendableMetatype"];

/// One symbol and the module whose graph declares it.
struct Symbol<'a> {
    module: &'a str,
    value: &'a Value,
}

impl Symbol<'_> {
    fn path(&self) -> String {
        self.value["pathComponents"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(".")
    }

    fn kind(&self) -> &str {
        self.value["kind"]["identifier"].as_str().unwrap_or_default()
    }

    /// Its ID: `swift:Ledger.Entry.init(amount:kind:)`; for an extension of
    /// a type the graph doesn't have, from another module, and the extension's
    /// members, `swift:Ledger/extension LedgerCore.Amount.description`.
    /// `in_graph` says whether the type it is a member of is in the graph,
    /// as a type a module re-exports (`@_exported import`) is.
    fn id(&self, in_graph: bool) -> String {
        let extended = self.value["swiftExtension"]["extendedModule"]
            .as_str()
            .filter(|extended| *extended != self.module);
        match extended {
            Some(extended) if !in_graph => format!("swift:{}/extension {extended}.{}", self.module, self.path()),
            _ => format!("swift:{}.{}", self.module, self.path()),
        }
    }
}

/// Where a source file is, for evidence: the package's absolute directory as
/// the compiler saw it, and the same directory relative to the repository.
pub struct Sources<'a> {
    pub absolute: Option<String>,
    pub base: &'a str,
}

/// A symbol's key: the module whose graph declares it, and its precise
/// identifier. Two modules' graphs can both hold a symbol (one module
/// re-exports another), each with that module's own relationships.
type Key<'a> = (&'a str, &'a str);

pub fn api(graphs: &[Value], modules: &BTreeSet<String>, sources: &Sources) -> Result<Value> {
    let mut symbols: BTreeMap<Key, Symbol> = BTreeMap::new();
    let mut relationships: Vec<(&str, &Value)> = Vec::new();
    for graph in graphs {
        let module = graph["module"]["name"].as_str().unwrap_or_default();
        if !modules.contains(module) {
            continue;
        }
        ensure!(
            graph["metadata"]["formatVersion"]["major"] == 0,
            "Unsupported symbol graph format {}; expected 0.x",
            graph["metadata"]["formatVersion"]
        );
        for value in graph["symbols"].as_array().into_iter().flatten() {
            if let Some(usr) = value["identifier"]["precise"].as_str() {
                symbols.insert((module, usr), Symbol { module, value });
            }
        }
        relationships.extend(
            graph["relationships"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|relationship| (module, relationship)),
        );
    }
    let mut builder = Builder {
        entities: BTreeMap::new(),
        relationships: Vec::new(),
        sources,
    };
    for module in modules {
        builder.entity(
            format!("swift:{module}"),
            "module",
            module,
            format!("module {module}"),
            json!({"declaration": "module", "term": "module", "visibility": "public"}),
            None,
        );
    }
    let facts = facts(&symbols, &relationships);
    let id_of = |key: &Key| -> Option<String> {
        let symbol = symbols.get(key)?;
        let parent = facts.parents.get(key).and_then(|parent| symbols.get(parent));
        Some(symbol.id(parent.is_some_and(|parent| parent.kind() != "swift.extension")))
    };
    for (key, symbol) in &symbols {
        if facts.defaults.contains(key) {
            continue;
        }
        let id = id_of(key).unwrap_or_default();
        let parent = facts
            .parents
            .get(key)
            .and_then(id_of)
            .unwrap_or_else(|| format!("swift:{}", symbol.module));
        builder.relationships.push(relationship("contains", &parent, &id));
        let mut own = facts.of(key);
        let parent = facts.parents.get(key).and_then(|parent| symbols.get(parent));
        own.inherited = parent.map(|parent| generic_names(parent.value)).unwrap_or_default();
        own.owner = parent.map(|parent| parent.path());
        builder.symbol(id, symbol, &own);
    }
    let mut relationships = builder.relationships;
    relationships.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    relationships.dedup_by(|a, b| a["id"] == b["id"]);
    Ok(extraction(
        "api/v0",
        builder.entities.into_values().collect(),
        relationships,
        Some(json!({"ecosystem": "swift"})),
    ))
}

fn generic_names(value: &Value) -> Vec<String> {
    value["swiftGenerics"]["parameters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| p["name"].as_str().map(str::to_owned))
        .collect()
}

/// What each module's relationships say about its symbols.
struct Known<'a> {
    parents: BTreeMap<Key<'a>, Key<'a>>,
    requirements: BTreeMap<Key<'a>, bool>,
    defaulted: BTreeSet<Key<'a>>,
    /// Default implementations, which aren't separate API.
    defaults: BTreeSet<Key<'a>>,
    supertypes: BTreeMap<Key<'a>, Vec<Value>>,
}

impl Known<'_> {
    fn of(&self, key: &Key) -> Facts {
        Facts {
            requirement: self.requirements.get(key).copied(),
            defaulted: self.defaulted.contains(key),
            supertypes: self.supertypes.get(key).cloned().unwrap_or_default(),
            ..Facts::default()
        }
    }
}

fn facts<'a>(symbols: &BTreeMap<Key<'a>, Symbol<'a>>, relationships: &[(&'a str, &'a Value)]) -> Known<'a> {
    let mut known = Known {
        parents: BTreeMap::new(),
        requirements: BTreeMap::new(),
        defaulted: BTreeSet::new(),
        defaults: BTreeSet::new(),
        supertypes: BTreeMap::new(),
    };
    for (module, relationship) in relationships {
        let (Some(source), Some(target)) = (relationship["source"].as_str(), relationship["target"].as_str()) else {
            continue;
        };
        let (source, target) = ((*module, source), (*module, target));
        match relationship["kind"].as_str().unwrap_or_default() {
            "memberOf" => {
                known.parents.insert(source, target);
            }
            kind @ ("requirementOf" | "optionalRequirementOf") => {
                known.parents.insert(source, target);
                known.requirements.insert(source, kind == "optionalRequirementOf");
            }
            "defaultImplementationOf" => {
                known.defaulted.insert(target);
                known.defaults.insert(source);
            }
            kind @ ("conformsTo" | "inheritsFrom") => {
                let name = symbols.get(&target).map(|symbol| format!("{}.{}", symbol.module, symbol.path()));
                let Some(name) = name.or_else(|| relationship["targetFallback"].as_str().map(str::to_owned)) else {
                    continue;
                };
                if IMPLICIT.contains(&name.as_str()) {
                    continue;
                }
                let protocol = symbols.get(&source).is_some_and(|symbol| symbol.kind() == "swift.protocol");
                let relation = if kind == "inheritsFrom" || protocol {
                    "extends"
                } else {
                    "implements"
                };
                known
                    .supertypes
                    .entry(source)
                    .or_default()
                    .push(json!({"relation": relation, "type": name}));
            }
            _ => {}
        }
    }
    for supertypes in known.supertypes.values_mut() {
        supertypes.sort_by_key(|supertype| supertype["type"].as_str().map(str::to_owned));
        supertypes.dedup();
    }
    known
}

struct Builder<'a> {
    entities: BTreeMap<String, Value>,
    relationships: Vec<Value>,
    sources: &'a Sources<'a>,
}

impl Builder<'_> {
    fn entity(&mut self, id: String, kind: &str, label: &str, signature: String, contract: Value, evidence: Option<Value>) {
        let mut entity = json!({"id": id, "kind": kind, "label": label, "data": {"signature": signature, "contract": contract}, "confidence": "authoritative"});
        if let Some(evidence) = evidence {
            entity["evidence"] = evidence;
        }
        self.entities.insert(id, entity);
    }

    /// A symbol's entity; an overload with the same path adds its signature
    /// to the entity already there, and an extension block's conformances to
    /// the extension already there.
    fn symbol(&mut self, id: String, symbol: &Symbol, facts: &Facts) {
        let declaration = fragments::text(&symbol.value["declarationFragments"]);
        if symbol.kind() == "swift.extension" {
            return self.extension(id, symbol, facts);
        }
        let Some(contract) = contract::contract(symbol.value, facts) else {
            return;
        };
        if let Some(existing) = self.entities.get_mut(&id) {
            let signature = format!("{}\n{declaration}", existing["data"]["signature"].as_str().unwrap_or_default());
            existing["data"]["signature"] = json!(signature);
            if let (Some(signatures), Some(more)) = (
                existing["data"]["contract"]["signatures"].as_array_mut(),
                contract["signatures"].as_array(),
            ) {
                signatures.extend(more.iter().cloned());
            }
            return;
        }
        let (_, kind) = contract::declaration(symbol.kind()).unwrap_or(("function", "function"));
        let label = symbol.value["names"]["title"].as_str().unwrap_or_default().to_owned();
        let evidence = self.evidence(symbol.value);
        self.entity(id, kind, &label, declaration, contract, evidence);
    }

    fn extension(&mut self, id: String, symbol: &Symbol, facts: &Facts) {
        let extended = format!(
            "{}.{}",
            symbol.value["swiftExtension"]["extendedModule"].as_str().unwrap_or_default(),
            symbol.path()
        );
        let existing = self.entities.entry(id.clone()).or_insert_with(|| {
            json!({"id": id, "kind": "extension", "label": format!("extension {extended}"), "confidence": "authoritative", "data": {
                "signature": format!("extension {extended}"),
                "contract": {"declaration": "implementation", "term": "extension", "visibility": "public", "type": {"text": extended}}
            }})
        });
        let contract = &mut existing["data"]["contract"];
        let mut supertypes: Vec<Value> = contract["supertypes"].as_array().cloned().unwrap_or_default();
        supertypes.extend(facts.supertypes.iter().cloned());
        supertypes.sort_by_key(|supertype| supertype["type"].as_str().map(str::to_owned));
        supertypes.dedup();
        if !supertypes.is_empty() {
            contract["supertypes"] = json!(supertypes);
            let conformances: Vec<&str> = supertypes.iter().filter_map(|supertype| supertype["type"].as_str()).collect();
            existing["data"]["signature"] = json!(format!("extension {extended}: {}", conformances.join(", ")));
        }
    }

    fn evidence(&self, symbol: &Value) -> Option<Value> {
        let uri = symbol["location"]["uri"].as_str()?;
        let absolute = self.sources.absolute.as_deref()?;
        let relative = uri.strip_prefix("file://")?.strip_prefix(absolute)?.strip_prefix('/')?;
        let source = if self.sources.base.is_empty() || self.sources.base == "." {
            relative.to_owned()
        } else {
            format!("{}/{relative}", self.sources.base)
        };
        let line = symbol["location"]["position"]["line"].as_u64()? + 1;
        Some(json!([{"kind": "source", "source": source, "location": {"line": line}}]))
    }
}
