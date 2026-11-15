//! TypeScript: assignability for callers and implementers.

use crate::testing::{api, classify_pair, entity, function_value, member, verdict};
use serde_json::{Value, json};

fn ty(text: &str) -> Value {
    fn primitive(item: &str) -> Option<&str> {
        match item {
            "string" | "number" | "boolean" | "bigint" | "symbol" | "null" | "undefined" | "void" => Some(item),
            _ if item.starts_with('"') => Some("string"),
            _ if item.parse::<f64>().is_ok() => Some("number"),
            "true" | "false" => Some("boolean"),
            _ => None,
        }
    }
    let union: Vec<Value> = text
        .split(" | ")
        .map(|item| match primitive(item) {
            Some(primitive) => json!({"text": item, "primitive": primitive}),
            None => json!({"text": item}),
        })
        .collect();
    json!({"text": text, "union": union})
}

fn parameter(name: &str, text: &str, optional: bool) -> Value {
    json!({"name": name, "type": ty(text), "optional": optional, "variadic": false})
}

fn function(id: &str, parameters: Vec<Value>, returns: &str) -> Value {
    entity(
        id,
        "export",
        id,
        json!({"declaration": "function", "term": "function", "signatures": [{"parameters": parameters, "returns": ty(returns)}]}),
    )
}

fn pair(before: Vec<Value>, after: Vec<Value>) -> Value {
    classify_pair(&api("typescript", before), &api("typescript", after), json!({}))
}

/// The rules' `typescriptAssignable`.
fn assignable(source: &Value, target: &Value) -> String {
    function_value(&format!("typescriptAssignable({source}, {target})"))
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn assignability_over_constituents() {
    assert_eq!(assignable(&ty("\"a\""), &ty("string")), "yes");
    assert_eq!(assignable(&ty("\"a\" | \"b\""), &ty("\"a\" | \"b\" | \"c\"")), "yes");
    assert_eq!(assignable(&ty("string | number"), &ty("string")), "no");
    assert_eq!(assignable(&ty("string"), &ty("unknown")), "yes");
    assert_eq!(assignable(&ty("Options"), &ty("Settings")), "undecided");
    assert_eq!(assignable(&ty("number"), &ty("string | Buffer")), "undecided");
    assert_eq!(assignable(&ty("undefined"), &ty("void")), "yes");
    assert_eq!(assignable(&ty("string"), &ty("\"a\"")), "no");
}

#[test]
fn function_signatures_for_callers() {
    let comparison = pair(
        vec![
            function("parse", vec![parameter("text", "string", false)], "Node"),
            function(
                "load",
                vec![parameter("path", "string", false), parameter("encoding", "string", true)],
                "string",
            ),
            function("format", vec![parameter("value", "string | number", false)], "string | undefined"),
            function("stringify", vec![parameter("value", "string", false)], "string"),
        ],
        vec![
            function(
                "parse",
                vec![parameter("text", "string", false), parameter("options", "ParseOptions", true)],
                "Node",
            ),
            function("load", vec![parameter("path", "string", false)], "string"),
            function("format", vec![parameter("value", "string", false)], "string"),
            function("stringify", vec![parameter("value", "string | number", false)], "string | null"),
        ],
    );
    assert_eq!(
        verdict(&comparison, "parse"),
        (
            "additive".into(),
            vec!["parameter-added".into()],
            "Optional parameter `options` was added".into()
        )
    );
    assert_eq!(verdict(&comparison, "load").1, ["parameter-removed"]);
    let (level, rules, reason) = verdict(&comparison, "format");
    assert_eq!(level, "breaking");
    assert_eq!(rules, ["parameter-narrowed"]);
    assert_eq!(reason, "Parameter `value` no longer accepts `string | number` (now `string`)");
    let (level, rules, _) = verdict(&comparison, "stringify");
    assert_eq!((level.as_str(), rules), ("breaking", vec!["return-widened".to_owned()]));
}

#[test]
fn required_parameters_and_overloads() {
    let overloads = |count: usize| {
        let signatures: Vec<Value> = (0..count)
            .map(|index| json!({"parameters": [parameter("value", ["string", "number"][index], false)], "returns": ty("void")}))
            .collect();
        entity(
            "on",
            "export",
            "on",
            json!({"declaration": "function", "term": "function", "signatures": signatures}),
        )
    };
    let comparison = pair(
        vec![function("connect", vec![parameter("url", "string", false)], "void"), overloads(1)],
        vec![
            function(
                "connect",
                vec![parameter("url", "string", false), parameter("token", "string", false)],
                "void",
            ),
            overloads(2),
        ],
    );
    assert_eq!(verdict(&comparison, "connect").2, "Parameter `token` is now required");
    assert_eq!(
        verdict(&comparison, "on"),
        ("additive".into(), vec!["overloads".into()], "Gained an overload".into())
    );
}

#[test]
fn interface_and_class_members() {
    let interface = |id: &str| entity(id, "type", id, json!({"declaration": "interface", "term": "interface"}));
    let class = |id: &str| entity(id, "export", id, json!({"declaration": "class", "term": "class"}));
    let property = |id: &str, parent: &str, text: &str, optional: bool, readonly: bool| {
        member(
            id,
            parent,
            "member",
            id,
            json!({"declaration": "property", "term": "property", "type": ty(text), "optional": optional, "readonly": readonly}),
        )
    };
    let comparison = pair(
        vec![
            interface("Options"),
            property("Options.retries", "Options", "number", true, false),
            property("Options.mode", "Options", "\"fast\" | \"safe\"", false, false),
            property("Options.delay", "Options", "number", false, false),
            class("Client"),
            property("Client.url", "Client", "string", false, true),
        ],
        vec![
            interface("Options"),
            property("Options.retries", "Options", "number", true, false),
            property("Options.mode", "Options", "\"fast\" | \"safe\" | \"auto\"", false, false),
            property("Options.delay", "Options", "number | undefined", true, false),
            property("Options.timeout", "Options", "number", false, false),
            property("Options.signal", "Options", "AbortSignal", true, false),
            class("Client"),
            property("Client.url", "Client", "\"https://a\"", false, true),
            property("Client.headers", "Client", "Headers", false, true),
        ],
    );
    assert_eq!(verdict(&comparison, "Options.timeout").1, ["member-added"]);
    assert_eq!(verdict(&comparison, "Options.timeout").0, "breaking");
    assert_eq!(verdict(&comparison, "Options.signal").0, "additive");
    assert_eq!(verdict(&comparison, "Options.mode").0, "breaking");
    assert_eq!(verdict(&comparison, "Client.headers").0, "additive");
    assert_eq!(
        verdict(&comparison, "Options.delay"),
        (
            "breaking".into(),
            vec!["optionality".into()],
            "Became optional; code reading it must handle `undefined`".into()
        )
    );
    assert_eq!(verdict(&comparison, "Client.url").0, "compatible");
}

#[test]
fn aliases_widen_additively_and_narrow_breakingly() {
    let alias = |id: &str, text: &str| entity(id, "type", id, json!({"declaration": "alias", "term": "alias", "type": ty(text)}));
    let comparison = pair(
        vec![
            alias("Mode", "\"a\" | \"b\""),
            alias("Level", "\"low\" | \"high\""),
            alias("Shape", "Circle | Square"),
        ],
        vec![
            alias("Mode", "\"a\" | \"b\" | \"c\""),
            alias("Level", "\"low\""),
            alias("Shape", "Circle | Polygon"),
        ],
    );
    assert_eq!(verdict(&comparison, "Mode").1, ["alias-widened"]);
    assert_eq!(verdict(&comparison, "Level").1, ["alias-narrowed"]);
    assert_eq!(verdict(&comparison, "Shape").0, "unknown");
}
