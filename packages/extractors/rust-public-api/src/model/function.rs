//! Function and method signatures and contracts.

use super::builder::Builder;
use super::contract::{api_contract, type_ref};
use super::generics::generics;
use super::types::ty;
use serde_json::{Value, json};

/// A function or method's signature and contract.
pub(super) fn function(name: &str, item: &Value, value: &Value, visibility: &str, kind: &str, builder: &Builder) -> (String, Value) {
    let header = &value["header"];
    let (const_, async_, unsafe_) = (header["is_const"] == true, header["is_async"] == true, header["is_unsafe"] == true);
    let abi = match &header["abi"] {
        Value::String(abi) => abi.clone(),
        Value::Object(abi) => abi.keys().next().cloned().unwrap_or_default(),
        _ => "Rust".into(),
    };
    let generics = generics(&value["generics"], builder);
    let (parameters, shown) = parameters(value, builder);
    let returns = if value["sig"]["output"].is_null() {
        "()".to_owned()
    } else {
        ty(&value["sig"]["output"], builder)
    };
    let mut prefix = String::new();
    for (flag, word) in [(const_, "const "), (async_, "async "), (unsafe_, "unsafe ")] {
        if flag {
            prefix.push_str(word);
        }
    }
    if abi != "Rust" {
        prefix.push_str(&format!("extern \"{abi}\" "));
    }
    let signature = format!(
        "{visibility}{prefix}fn {name}{}({}){}{}",
        generics.params(),
        shown.join(", "),
        if returns == "()" { String::new() } else { format!(" -> {returns}") },
        generics.clauses()
    );
    let _ = item;
    let mut signature_facts = json!({"parameters": parameters, "returns": type_ref(&returns)});
    let type_parameters = generics.type_parameters();
    if type_parameters.as_array().is_some_and(|items| !items.is_empty()) {
        signature_facts["typeParameters"] = type_parameters;
    }
    let contract = api_contract(
        if kind == "function" { "function" } else { "method" },
        kind,
        json!({"signatures": [signature_facts], "native": {"const": const_, "async": async_, "unsafe": unsafe_,
            "abi": if abi == "Rust" { Value::Null } else { json!(abi) }, "where": generics.clauses}}),
    );
    (signature, contract)
}

/// The parameters as contract facts, and as the signature shows them (`&self`, `x: T`).
fn parameters(value: &Value, builder: &Builder) -> (Vec<Value>, Vec<String>) {
    let mut parameters = Vec::new();
    let mut shown = Vec::new();
    for input in value["sig"]["inputs"].as_array().into_iter().flatten() {
        let parameter = input[0].as_str().unwrap_or("_");
        let parameter_type = &input[1];
        let text = ty(parameter_type, builder);
        shown.push(if parameter == "self" {
            match text.as_str() {
                "Self" => "self".into(),
                "&Self" => "&self".into(),
                "&mut Self" => "&mut self".into(),
                _ => format!("self: {text}"),
            }
        } else {
            format!("{parameter}: {text}")
        });
        parameters.push(json!({"name": parameter, "type": type_ref(&text), "optional": false, "variadic": false, "passing": "value"}));
    }
    (parameters, shown)
}
