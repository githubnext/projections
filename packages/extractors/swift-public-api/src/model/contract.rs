//! The language-neutral contract of one symbol.

use super::fragments::{self, Shown};
use serde_json::{Map, Value, json};

/// The `api/v0` declaration and the entity kind for a symbol graph kind.
pub(crate) fn declaration(identifier: &str) -> Option<(&'static str, &'static str)> {
    Some(match identifier {
        "swift.class" => ("class", "class"),
        "swift.struct" => ("struct", "struct"),
        "swift.enum" => ("enum", "enum"),
        "swift.protocol" => ("interface", "protocol"),
        "swift.typealias" => ("alias", "typealias"),
        "swift.associatedtype" => ("associated-type", "associatedtype"),
        "swift.func" => ("function", "function"),
        "swift.func.op" => ("function", "operator"),
        "swift.method" | "swift.type.method" => ("method", "method"),
        "swift.init" => ("constructor", "init"),
        "swift.property" | "swift.type.property" => ("property", "property"),
        "swift.var" => ("variable", "variable"),
        "swift.enum.case" => ("variant", "case"),
        "swift.subscript" | "swift.type.subscript" => ("index", "subscript"),
        "swift.macro" => ("macro", "macro"),
        _ => return None,
    })
}

/// What the symbol's relationships say about it.
#[derive(Default)]
pub(crate) struct Facts {
    /// A protocol requirement, and whether it is `@objc optional`.
    pub requirement: Option<bool>,
    /// A protocol extension implements it by default.
    pub defaulted: bool,
    /// What it derives from or conforms to.
    pub supertypes: Vec<Value>,
    /// The generic parameters its parent declares, which aren't its own.
    pub inherited: Vec<String>,
    /// The type a constructor creates.
    pub owner: Option<String>,
}

pub(crate) fn contract(symbol: &Value, facts: &Facts) -> Option<Value> {
    let identifier = symbol["kind"]["identifier"].as_str()?;
    let (declaration, _) = declaration(identifier)?;
    let declared = &symbol["declarationFragments"];
    let mut contract = Map::new();
    contract.insert("declaration".into(), json!(declaration));
    contract.insert("term".into(), json!(identifier.trim_start_matches("swift.")));
    contract.insert("visibility".into(), json!("public"));
    let open = symbol["accessLevel"] == "open";
    let mut flag = |name: &str, value: bool| {
        if value {
            contract.insert(name.into(), json!(true));
        }
    };
    flag("static", identifier.starts_with("swift.type.") || identifier == "swift.func.op");
    flag("abstract", facts.requirement.is_some() && !facts.defaulted);
    flag("optional", facts.requirement == Some(true));
    flag("sealed", identifier == "swift.class" && !open);
    // A stored `var` shows no accessor block and can be assigned; a computed or
    // protocol property shows `{ get }` when it can't be.
    let accessors = fragments::text(declared).split_once(" {").map(|(_, block)| block.to_owned());
    let getter_only = accessors.is_some_and(|block| block.contains("get") && !block.contains("set"));
    let readonly = matches!(declaration, "property" | "variable") && (fragments::has_keyword(declared, "let") || getter_only);
    flag("readonly", readonly);
    let typed = match declaration {
        "property" | "variable" | "associated-type" => fragments::declared_type(declared),
        "alias" => fragments::aliased(declared),
        _ => None,
    };
    if let Some(typed) = typed {
        contract.insert("type".into(), json!({"text": typed}));
    }
    let attributes = attributes(symbol);
    if !attributes.is_empty() {
        contract.insert("attributes".into(), json!(attributes));
    }
    let type_parameters = type_parameters(symbol, &facts.inherited);
    if matches!(declaration, "function" | "method" | "constructor" | "index") {
        contract.insert("signatures".into(), json!([signature(symbol, facts, &type_parameters)]));
    } else if !type_parameters.is_empty() {
        contract.insert("typeParameters".into(), json!(type_parameters));
    }
    if !facts.supertypes.is_empty() {
        contract.insert("supertypes".into(), json!(facts.supertypes));
    }
    let native = native(symbol, open);
    if !native.is_empty() {
        contract.insert("native".into(), Value::Object(native));
    }
    Some(Value::Object(contract))
}

/// Attributes the declaration shows, and its availability as `@available(…)`.
fn attributes(symbol: &Value) -> Vec<String> {
    let mut attributes = fragments::attributes(&symbol["declarationFragments"]);
    for availability in symbol["availability"].as_array().into_iter().flatten() {
        let domain = availability["domain"].as_str().unwrap_or("*");
        let mut parts = vec![domain.to_owned()];
        for (field, word) in [
            ("introduced", "introduced"),
            ("deprecated", "deprecated"),
            ("obsoleted", "obsoleted"),
        ] {
            if let Some(version) = availability[field].as_object() {
                let numbers = ["major", "minor", "patch"]
                    .iter()
                    .filter_map(|part| version.get(*part)?.as_u64())
                    .map(|n| n.to_string())
                    .collect::<Vec<_>>();
                parts.push(format!("{word}: {}", numbers.join(".")));
            }
        }
        if availability["isUnconditionallyDeprecated"] == true {
            parts.push("deprecated".into());
        }
        if availability["isUnconditionallyUnavailable"] == true {
            parts.push("unavailable".into());
        }
        for field in ["message", "renamed"] {
            if let Some(text) = availability[field].as_str() {
                parts.push(format!("{field}: {text:?}"));
            }
        }
        attributes.push(format!("@available({})", parts.join(", ")));
    }
    attributes
}

/// The symbol's own generic parameters, each with its conformance and
/// superclass constraints.
fn type_parameters(symbol: &Value, inherited: &[String]) -> Vec<Value> {
    let generics = &symbol["swiftGenerics"];
    generics["parameters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|parameter| parameter["name"].as_str())
        .filter(|name| !inherited.iter().any(|other| other == name))
        .map(|name| {
            let constraints: Vec<&str> = generics["constraints"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|constraint| constraint["lhs"] == name && constraint["kind"] != "sameType")
                .filter_map(|constraint| constraint["rhs"].as_str())
                .collect();
            json!({"name": name, "constraints": constraints})
        })
        .collect()
}

fn signature(symbol: &Value, facts: &Facts, type_parameters: &[Value]) -> Value {
    let function = &symbol["functionSignature"];
    let shown = fragments::parameters(&symbol["declarationFragments"]);
    let parameters: Vec<Value> = function["parameters"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(at, parameter)| {
            let Shown { default, variadic, inout } = shown.get(at).cloned().unwrap_or_default();
            let typed = fragments::text(&parameter["declarationFragments"]);
            let typed = typed.split_once(": ").map_or(typed.as_str(), |(_, typed)| typed).trim().to_owned();
            let mut value = json!({
                "name": parameter["name"], "type": {"text": typed}, "optional": default.is_some(),
                "variadic": variadic, "passing": if inout { "ref" } else { "value" }
            });
            if let Some(default) = default {
                value["default"] = json!(default);
            }
            value
        })
        .collect();
    let returns = match (&facts.owner, symbol["kind"]["identifier"].as_str()) {
        (Some(owner), Some("swift.init")) => owner.clone(),
        _ => match fragments::text(&function["returns"]) {
            text if text.is_empty() || text == "()" => "Void".into(),
            text => text,
        },
    };
    let mut signature = json!({"parameters": parameters, "returns": {"text": returns}});
    if !type_parameters.is_empty() {
        signature["typeParameters"] = json!(type_parameters);
    }
    signature
}

/// Facts only Swift's rules read: `open`, effects, mutation and constraints.
fn native(symbol: &Value, open: bool) -> Map<String, Value> {
    let declared = &symbol["declarationFragments"];
    let mut native = Map::new();
    if open && symbol["kind"]["identifier"] != "swift.class" {
        native.insert("open".into(), json!(true));
    }
    for keyword in [
        "async",
        "throws",
        "rethrows",
        "mutating",
        "final",
        "indirect",
        "convenience",
        "required",
        "nonisolated",
    ] {
        if fragments::has_keyword(declared, keyword) {
            native.insert(keyword.into(), json!(true));
        }
    }
    let constraints: Vec<String> = symbol["swiftGenerics"]["constraints"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(symbol["swiftExtension"]["constraints"].as_array().into_iter().flatten())
        .filter(|constraint| constraint["kind"] == "sameType")
        .filter_map(|constraint| Some(format!("{} == {}", constraint["lhs"].as_str()?, constraint["rhs"].as_str()?)))
        .collect();
    if !constraints.is_empty() {
        native.insert("where".into(), json!(constraints));
    }
    native
}
