//! A one-off migration: `api/v0` extractions with the language-shaped contract
//! facts the public API extractors wrote before the facts were normalized
//! (each ecosystem's own keys in `data.contract`) to the normalized contract
//! (`apiContract` in `packages/schemas/src/api-contract.ts`). The golden comparisons of the
//! deleted Rust comparator were recorded over the old facts; converting their
//! inputs re-checks every one against the rules, and the converted renderer
//! fixtures must equal what the extractors now write.

use serde_json::{Map, Value, json};
use std::collections::HashMap;

/// The extraction with every contract converted, by `metadata.ecosystem`.
pub fn extraction(old: &Value) -> Value {
    let mut new = old.clone();
    let ecosystem = old["metadata"]["ecosystem"].as_str().unwrap_or_default();
    let entities: HashMap<&str, &Value> = old["entities"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|entity| (entity["id"].as_str().unwrap(), entity))
        .collect();
    let parents: HashMap<&str, &Value> = old["relationships"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|relationship| relationship["kind"] == "contains")
        .filter_map(|relationship| Some((relationship["to"].as_str()?, *entities.get(relationship["from"].as_str()?)?)))
        .collect();
    for entity in new["entities"].as_array_mut().into_iter().flatten() {
        let Some(contract) = entity["data"].get("contract").cloned() else {
            continue;
        };
        let id = entity["id"].as_str().unwrap().to_owned();
        let kind = entity["kind"].as_str().unwrap_or_default().to_owned();
        let parent = parents.get(id.as_str()).copied();
        let data = entity["data"].as_object_mut().unwrap();
        let converted = match ecosystem {
            "dotnet" => dotnet((&id, &kind), &contract, data, parent),
            "typescript" => typescript(&contract, data),
            "rust" => rust(&contract),
            "go" => go(&contract),
            _ => contract,
        };
        data.insert("contract".into(), explicit(converted));
    }
    new
}

/// The contract with the facts every contract states: its `visibility`
/// (`public` unless it said otherwise) and each parameter's `passing` (by
/// `value` unless it said otherwise).
fn explicit(mut contract: Value) -> Value {
    let Some(facts) = contract.as_object_mut() else {
        return contract;
    };
    facts.entry("visibility").or_insert(json!("public"));
    for signature in facts.get_mut("signatures").and_then(Value::as_array_mut).into_iter().flatten() {
        for parameter in signature["parameters"].as_array_mut().into_iter().flatten() {
            if let Some(parameter) = parameter.as_object_mut() {
                parameter.entry("passing").or_insert(json!("value"));
            }
        }
    }
    contract
}

/// Facts without `false`, `null` and empty lists or maps, which mean the same
/// as absent ones.
fn put(out: &mut Map<String, Value>, key: &str, value: Value) {
    let empty = match &value {
        Value::Null | Value::Bool(false) => true,
        Value::Array(items) => items.is_empty(),
        Value::Object(map) => map.is_empty(),
        _ => false,
    };
    if !empty {
        out.insert(key.into(), value);
    }
}

fn text(value: &Value) -> Value {
    json!({"text": value})
}

/// Splits `text` at each `separator` outside brackets: `A<B, C>, D` at `, `.
pub fn split_top(text: &str, separator: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut start = 0;
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'(' | b'[' | b'{' | b'<' => depth += 1,
            b'>' if index > 0 && matches!(bytes[index - 1], b'-' | b'=') => {}
            b')' | b']' | b'}' | b'>' => depth -= 1,
            _ => {}
        }
        if depth == 0 && text[index..].starts_with(separator) {
            parts.push(text[start..index].to_owned());
            index += separator.len();
            start = index;
            continue;
        }
        index += 1;
    }
    parts.push(text[start..].to_owned());
    parts
}

// .NET ------------------------------------------------------------------------

fn visibility(accessibility: &Value) -> Value {
    match accessibility.as_str() {
        None | Some("public") => Value::Null,
        Some(_) => json!("protected"),
    }
}

fn dotnet_parameters(parameters: &Value, attributes: Option<&Value>) -> Value {
    Value::Array(
        parameters
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
            .map(|(index, p)| {
                let mut out = Map::new();
                out.insert("name".into(), p["name"].clone());
                out.insert("type".into(), text(&p["type"]));
                out.insert("optional".into(), json!(p["optional"] == true));
                out.insert("variadic".into(), json!(p["params"] == true));
                put(&mut out, "default", p.get("default").cloned().unwrap_or_default());
                if let Some(kind) = p["refKind"].as_str().filter(|kind| *kind != "none") {
                    out.insert("passing".into(), json!(kind));
                }
                put(&mut out, "attributes", attributes.map(|all| all[index].clone()).unwrap_or_default());
                Value::Object(out)
            })
            .collect(),
    )
}

fn dotnet((id, kind): (&str, &str), c: &Value, data: &mut Map<String, Value>, parent: Option<&Value>) -> Value {
    let mut out = Map::new();
    let attributes = data.remove("attributes");
    let return_attributes = data.remove("returnAttributes");
    let parameter_attributes = data.remove("parameterAttributes");
    if let Some(type_kind) = c["typeKind"].as_str() {
        let declaration = match type_kind {
            "class" | "record class" => "class",
            "struct" | "record struct" => "struct",
            "interface" => "interface",
            "enum" => "enum",
            _ => "type",
        };
        out.insert("declaration".into(), json!(declaration));
        out.insert("term".into(), json!(type_kind));
        put(&mut out, "visibility", visibility(&c["accessibility"]));
        put(&mut out, "static", c["static"].clone());
        put(&mut out, "abstract", c["abstract"].clone());
        put(&mut out, "sealed", c["effectivelySealed"].clone());
        put(&mut out, "underlying", c.get("enumUnderlyingType").cloned().unwrap_or_default());
        put(&mut out, "attributes", attributes.unwrap_or_default());
        put(&mut out, "typeParameters", c.get("typeParameters").cloned().unwrap_or_default());
        let supertypes: Vec<Value> = c["baseTypes"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|t| json!({"relation": "extends", "type": t}))
            .chain(
                c["interfaces"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|t| json!({"relation": "implements", "type": t})),
            )
            .collect();
        put(&mut out, "supertypes", json!(supertypes));
        let mut native = Map::new();
        put(&mut native, "sealed", c["sealed"].clone());
        put(&mut out, "native", Value::Object(native));
        return Value::Object(out);
    }
    let kind = member_kind((id, kind), c, parent);
    out.insert("declaration".into(), json!(kind.0));
    out.insert("term".into(), json!(kind.1));
    put(&mut out, "visibility", visibility(&c["accessibility"]));
    put(&mut out, "static", c["static"].clone());
    put(&mut out, "abstract", c["abstract"].clone());
    put(&mut out, "readonly", c.get("readonly").cloned().unwrap_or_default());
    put(&mut out, "required", c.get("required").cloned().unwrap_or_default());
    put(&mut out, "attributes", attributes.unwrap_or_default());
    match kind.0 {
        "method" | "constructor" => {
            let mut signature = Map::new();
            signature.insert(
                "parameters".into(),
                dotnet_parameters(&c["parameters"], parameter_attributes.as_ref()),
            );
            signature.insert("returns".into(), text(&c["type"]));
            put(&mut signature, "returnAttributes", return_attributes.unwrap_or_default());
            put(
                &mut signature,
                "typeParameters",
                c.get("typeParameters").cloned().unwrap_or_default(),
            );
            out.insert("signatures".into(), json!([signature]));
        }
        "property" => {
            out.insert("type".into(), text(&c["type"]));
            if let Some(parameters) = c.get("parameters") {
                out.insert(
                    "signatures".into(),
                    json!([{"parameters": dotnet_parameters(parameters, parameter_attributes.as_ref()), "returns": text(&c["type"])}]),
                );
            }
            let accessors = &c["accessors"];
            let mut access = Map::new();
            for (old, new) in [("get", "read"), ("set", "write"), ("init", "init")] {
                if let Some(value) = accessors.get(old) {
                    access.insert(new.into(), visibility(value).as_str().map_or(json!("public"), |v| json!(v)));
                }
            }
            out.insert("access".into(), Value::Object(access));
        }
        _ => {
            put(&mut out, "type", c.get("type").map(text).unwrap_or_default());
            put(&mut out, "value", c.get("value").cloned().unwrap_or_default());
        }
    }
    let mut native = Map::new();
    for key in ["virtual", "override", "sealed"] {
        put(&mut native, key, c[key].clone());
    }
    put(&mut out, "native", Value::Object(native));
    Value::Object(out)
}

/// A .NET member's declaration and term, from its entity kind.
fn member_kind((id, kind): (&str, &str), c: &Value, parent: Option<&Value>) -> (&'static str, &'static str) {
    match kind {
        "method" if id.contains(".#ctor") => ("constructor", "constructor"),
        "method" => ("method", "method"),
        "property" => ("property", "property"),
        "event" => ("event", "event"),
        _ if parent.is_some_and(|p| p["data"]["contract"]["typeKind"] == "enum") => ("variant", "enum member"),
        _ if c.get("value").is_some() => ("constant", "const"),
        _ => ("field", "field"),
    }
}

// TypeScript ------------------------------------------------------------------

/// `<A extends X = Y, B>` as generic parameters.
fn typescript_type_parameters(text: &str) -> Value {
    let Some(inner) = text.strip_prefix('<').and_then(|t| t.strip_suffix('>')) else {
        return json!([]);
    };
    Value::Array(
        split_top(inner, ", ")
            .into_iter()
            .map(|parameter| {
                let (head, default) = match split_top(&parameter, " = ").as_slice() {
                    [head, default] => (head.clone(), Some(default.clone())),
                    _ => (parameter.clone(), None),
                };
                let (name, constraint) = match head.split_once(" extends ") {
                    Some((name, constraint)) => (name.to_owned(), Some(constraint.to_owned())),
                    None => (head.clone(), None),
                };
                let mut out = json!({"name": name, "constraints": constraint.into_iter().collect::<Vec<_>>()});
                if let Some(default) = default {
                    out["default"] = json!(default);
                }
                out
            })
            .collect(),
    )
}

fn typescript_signature(s: &Value) -> Value {
    let mut out = Map::new();
    out.insert(
        "parameters".into(),
        Value::Array(
            s["parameters"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|p| json!({"name": p["name"], "type": p["type"], "optional": p["optional"] == true, "variadic": p["rest"] == true}))
                .collect(),
        ),
    );
    out.insert("returns".into(), s["returns"].clone());
    put(
        &mut out,
        "typeParameters",
        typescript_type_parameters(s["typeParameters"].as_str().unwrap_or_default()),
    );
    Value::Object(out)
}

fn typescript(c: &Value, data: &mut Map<String, Value>) -> Value {
    let mut out = Map::new();
    let declaration = c["declaration"].as_str().unwrap_or_default();
    out.insert(
        "declaration".into(),
        json!(if declaration == "namespace" { "module" } else { declaration }),
    );
    out.insert("term".into(), json!(declaration));
    if c["protected"] == true {
        out.insert("visibility".into(), json!("protected"));
    }
    for key in ["static", "abstract", "readonly", "optional"] {
        put(&mut out, key, c[key].clone());
    }
    put(&mut out, "type", c.get("type").cloned().unwrap_or_default());
    if let Some(signatures) = c["signatures"].as_array() {
        out.insert(
            "signatures".into(),
            Value::Array(signatures.iter().map(typescript_signature).collect()),
        );
    }
    if let Some(key) = c["key"].as_str() {
        out.insert(
            "signatures".into(),
            json!([{"parameters": [{"name": "key", "type": {"text": key, "union": [{"text": key}]}, "optional": false, "variadic": false}], "returns": c["type"]}]),
        );
    }
    let supertypes: Vec<Value> = c["heritage"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|clause| clause.as_str()?.split_once(' '))
        .map(|(relation, t)| json!({"relation": relation, "type": t}))
        .collect();
    put(&mut out, "supertypes", json!(supertypes));
    let mut native = Map::new();
    for key in ["nominalBrand", "staticNominalBrand"] {
        put(&mut native, key, data.remove(key).unwrap_or_default());
    }
    put(&mut out, "native", Value::Object(native));
    Value::Object(out)
}

// Rust ------------------------------------------------------------------------

/// A generic parameter from its name, how Rust shows it (`T: Clone + Send`,
/// `'a: 'b`, `const N: usize`) and its default.
fn rust_type_parameter(p: &Value) -> Value {
    let name = p["name"].as_str().unwrap_or_default();
    let shown = p["bounds"].as_str().unwrap_or(name);
    let mut out = json!({"name": name, "constraints": []});
    if let Some(rest) = shown.strip_prefix("const ") {
        out["type"] = json!(rest.split_once(": ").map_or("", |(_, t)| t));
    } else if let Some(bounds) = shown.strip_prefix(&format!("{name}: ")) {
        out["constraints"] = json!(split_top(bounds, " + "));
    }
    if let Some(default) = p.get("default") {
        out["default"] = default.clone();
    }
    out
}

fn rust_bounds(text: &Value) -> Value {
    match text.as_str() {
        Some(text) if !text.is_empty() => json!(split_top(text, " + ")),
        _ => json!([]),
    }
}

fn rust(c: &Value) -> Value {
    let mut out = Map::new();
    let item = c["item"].as_str().unwrap_or_default();
    let declaration = match item {
        "crate" => "package",
        "trait" => "interface",
        "trait-method" => "method",
        "associated-const" => "constant",
        "static" => "variable",
        "type-alias" => "alias",
        "impl" => "implementation",
        other => other,
    };
    out.insert("declaration".into(), json!(declaration));
    out.insert("term".into(), json!(item));
    let mut native = Map::new();
    let type_parameters = Value::Array(
        c["generics"]["params"]
            .as_array()
            .into_iter()
            .flatten()
            .map(rust_type_parameter)
            .collect(),
    );
    put(&mut native, "where", c["generics"]["where"].clone());
    put(&mut out, "nonExhaustive", c["nonExhaustive"].clone());
    put(
        &mut out,
        "hiddenMembers",
        json!(c["privateFields"] == true || c["privateVariants"] == true),
    );
    put(&mut native, "shape", c.get("shape").cloned().unwrap_or_default());
    put(&mut native, "repr", c["repr"].clone());
    put(
        &mut out,
        "value",
        c.get("discriminant").or(c.get("value")).cloned().unwrap_or_default(),
    );
    match item {
        "function" | "method" | "trait-method" => {
            let mut signature = Map::new();
            signature.insert(
                "parameters".into(),
                Value::Array(
                    c["parameters"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|p| json!({"name": p["name"], "type": text(&p["type"]), "optional": false, "variadic": false}))
                        .collect(),
                ),
            );
            signature.insert("returns".into(), text(&c["returns"]));
            put(&mut signature, "typeParameters", type_parameters);
            out.insert("signatures".into(), json!([signature]));
            for key in ["const", "async", "unsafe"] {
                put(&mut native, key, c[key].clone());
            }
            if c["abi"] != "Rust" {
                put(&mut native, "abi", c["abi"].clone());
            }
        }
        _ => put(&mut out, "typeParameters", type_parameters),
    }
    if matches!(item, "trait-method" | "associated-type" | "associated-const") {
        put(&mut out, "abstract", json!(c["default"] != true));
    }
    match item {
        "field" | "constant" | "associated-const" | "type-alias" => put(&mut out, "type", c.get("type").map(text).unwrap_or_default()),
        "static" => {
            put(&mut out, "type", text(&c["type"]));
            put(&mut out, "readonly", json!(c["mutable"] != true));
        }
        "trait" => {
            put(&mut out, "sealed", c["sealed"].clone());
            put(&mut native, "unsafe", c["unsafe"].clone());
            put(&mut native, "dynCompatible", c["dynCompatible"].clone());
            let supertraits: Vec<Value> = rust_bounds(&c["bounds"])
                .as_array()
                .unwrap()
                .iter()
                .map(|bound| json!({"relation": "extends", "type": bound}))
                .collect();
            put(&mut out, "supertypes", json!(supertraits));
        }
        "associated-type" => put(&mut out, "constraints", rust_bounds(&c["bounds"])),
        "impl" => {
            put(&mut out, "type", text(&c["for"]));
            put(&mut out, "supertypes", json!([{"relation": "implements", "type": c["trait"]}]));
            put(&mut native, "synthetic", c["synthetic"].clone());
        }
        "re-export" => put(&mut out, "source", c["source"].clone()),
        _ => {}
    }
    put(&mut out, "native", Value::Object(native));
    Value::Object(out)
}

// Go --------------------------------------------------------------------------

/// `[K comparable, V any]` as generic parameters.
fn go_type_parameters(text: &str) -> Value {
    let Some(inner) = text.strip_prefix('[').and_then(|t| t.strip_suffix(']')) else {
        return json!([]);
    };
    Value::Array(
        split_top(inner, ", ")
            .into_iter()
            .map(|parameter| {
                let (name, constraint) = parameter.split_once(' ').unwrap_or((&parameter, ""));
                json!({"name": name, "constraints": [constraint]})
            })
            .collect(),
    )
}

fn go(c: &Value) -> Value {
    let mut out = Map::new();
    let object = c["object"].as_str().unwrap_or_default();
    let underlying = c["underlying"].as_str().unwrap_or_default();
    let declaration = match object {
        "const" => "constant",
        "var" => "variable",
        "func" => "function",
        "type" if c["alias"] == true => "alias",
        "type" if underlying == "struct" => "struct",
        "type" if underlying == "interface" => "interface",
        other => other,
    };
    out.insert("declaration".into(), json!(declaration));
    out.insert("term".into(), json!(object));
    let mut native = Map::new();
    match (object, declaration) {
        ("type", "alias") => {
            out.insert("type".into(), text(&c["underlyingType"]));
        }
        ("type", _) => {
            put(&mut native, "comparable", c["comparable"].clone());
            put(
                &mut out,
                "typeParameters",
                go_type_parameters(c["typeParams"].as_str().unwrap_or_default()),
            );
            put(&mut out, "sealed", c["unexportedMethods"].clone());
            if declaration == "type" {
                put(&mut native, "underlying", c["underlying"].clone());
            }
            put(&mut out, "underlying", c.get("underlyingType").cloned().unwrap_or_default());
            put(&mut native, "numeric", c.get("numeric").cloned().unwrap_or_default());
            put(&mut native, "channel", c.get("channel").cloned().unwrap_or_default());
            let implements: Vec<Value> = c["implements"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|t| json!({"relation": "implements", "type": t}))
                .collect();
            put(&mut out, "supertypes", json!(implements));
        }
        _ => {
            put(&mut out, "type", c.get("type").map(text).unwrap_or_default());
            put(&mut out, "value", c.get("value").cloned().unwrap_or_default());
            match c["receiver"].as_str() {
                Some("interface") => {
                    out.insert("abstract".into(), json!(true));
                }
                Some(receiver) => {
                    native.insert("receiver".into(), json!(receiver));
                }
                None => {}
            }
            put(&mut native, "promoted", c["promoted"].clone());
            put(&mut native, "embedded", c["embedded"].clone());
        }
    }
    put(&mut out, "native", Value::Object(native));
    Value::Object(out)
}
