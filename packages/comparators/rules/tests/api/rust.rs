//! Rust: semver compatibility of crates.

use crate::testing::{api, classify_pair, entity, member, verdict};
use serde_json::{Value, json};

fn pair(before: Vec<Value>, after: Vec<Value>) -> Value {
    classify_pair(&api("rust", before), &api("rust", after), json!({}))
}

/// Parameters from `(name, type)` pairs.
fn parameters(pairs: &[(&str, &str)]) -> Value {
    json!(
        pairs
            .iter()
            .map(|(name, t)| json!({"name": name, "type": {"text": t}, "optional": false, "variadic": false}))
            .collect::<Vec<_>>()
    )
}

fn function(id: &str, parent: &str, parameters: Value, returns: &str, extra: Value) -> Value {
    let mut contract = json!({"declaration": "method", "term": "method",
        "signatures": [{"parameters": parameters, "returns": {"text": returns}}]});
    for (key, value) in extra.as_object().unwrap() {
        match key.as_str() {
            "typeParameters" => contract["signatures"][0][key] = value.clone(),
            _ => contract[key] = value.clone(),
        }
    }
    member(id, parent, "method", id, contract)
}

fn structure(id: &str) -> Value {
    entity(id, "struct", id, json!({"declaration": "struct", "term": "struct"}))
}

#[test]
fn exhaustive_enums_and_structs_break_when_they_grow() {
    let enumeration = |non_exhaustive| {
        entity(
            "rust:c::E",
            "enum",
            "pub enum E",
            json!({"declaration": "enum", "term": "enum", "nonExhaustive": non_exhaustive}),
        )
    };
    let structure = |id: &str, private: bool| {
        entity(
            id,
            "struct",
            id,
            json!({"declaration": "struct", "term": "struct", "hiddenMembers": private, "native": {"shape": "plain"}}),
        )
    };
    let variant = |id: &str, parent: &str| {
        member(
            id,
            parent,
            "variant",
            id,
            json!({"declaration": "variant", "term": "variant", "native": {"shape": "unit"}}),
        )
    };
    let field = |id: &str, parent: &str| {
        member(
            id,
            parent,
            "field",
            id,
            json!({"declaration": "field", "term": "field", "type": {"text": "u32"}}),
        )
    };
    let comparison = pair(
        vec![
            enumeration(false),
            structure("rust:c::Open", false),
            structure("rust:c::Closed", true),
        ],
        vec![
            enumeration(false),
            variant("rust:c::E::New", "rust:c::E"),
            structure("rust:c::Open", false),
            field("rust:c::Open.extra", "rust:c::Open"),
            structure("rust:c::Closed", true),
            field("rust:c::Closed.extra", "rust:c::Closed"),
        ],
    );
    assert_eq!(verdict(&comparison, "rust:c::E::New").1, ["enum-variant-new"]);
    assert_eq!(
        verdict(&comparison, "rust:c::Open.extra").1,
        ["struct-add-public-field-when-no-private"]
    );
    assert_eq!(verdict(&comparison, "rust:c::Closed.extra").0, "additive");
}

#[test]
fn trait_items_break_unsealed_traits_without_defaults() {
    let tr = |sealed| {
        entity(
            "rust:c::T",
            "trait",
            "pub trait T",
            json!({"declaration": "interface", "term": "trait", "sealed": sealed, "native": {"dynCompatible": true}}),
        )
    };
    let item = |id: &str, default: bool| {
        function(
            id,
            "rust:c::T",
            json!([]),
            "()",
            json!({"term": "trait-method", "abstract": !default}),
        )
    };
    let comparison = pair(
        vec![tr(false)],
        vec![tr(false), item("rust:c::T::a", false), item("rust:c::T::b", true)],
    );
    assert_eq!(verdict(&comparison, "rust:c::T::a").1, ["trait-new-item-no-default"]);
    assert_eq!(verdict(&comparison, "rust:c::T::a").0, "breaking");
    assert_eq!(verdict(&comparison, "rust:c::T::b").1, ["trait-new-default-item"]);
    let comparison = pair(vec![tr(true)], vec![tr(true), item("rust:c::T::a", false)]);
    assert_eq!(verdict(&comparison, "rust:c::T::a").0, "additive");
}

#[test]
fn functions_break_on_arity_types_const_and_unsafe() {
    let ty = structure("rust:c::S");
    let self_and_n = parameters(&[("self", "&Self"), ("n", "u32")]);
    let generic = json!({"typeParameters": [{"name": "F", "constraints": ["Fn(u32)"]}]});
    let comparison = pair(
        vec![
            ty.clone(),
            function("rust:c::S::check", "rust:c::S", self_and_n.clone(), "bool", json!({})),
            function("rust:c::S::size", "rust:c::S", json!([]), "u32", json!({"native": {"const": true}})),
            function("rust:c::S::get", "rust:c::S", self_and_n.clone(), "u32", json!({})),
            function("rust:c::S::map", "rust:c::S", parameters(&[("f", "F")]), "u32", generic.clone()),
        ],
        vec![
            ty,
            function(
                "rust:c::S::check",
                "rust:c::S",
                parameters(&[("self", "&Self"), ("n", "u32"), ("key", "&str")]),
                "bool",
                json!({}),
            ),
            function("rust:c::S::size", "rust:c::S", json!([]), "u32", json!({})),
            function(
                "rust:c::S::get",
                "rust:c::S",
                parameters(&[("self", "&Self"), ("n", "u64")]),
                "u32",
                json!({"native": {"unsafe": true}}),
            ),
            function("rust:c::S::map", "rust:c::S", parameters(&[("f", "F")]), "u64", generic),
        ],
    );
    assert_eq!(
        verdict(&comparison, "rust:c::S::check"),
        (
            "breaking".into(),
            vec!["fn-change-arity".into()],
            "Parameter `key` was added; every call fails".into()
        )
    );
    assert_eq!(verdict(&comparison, "rust:c::S::size").1, ["const-fn-removed"]);
    assert_eq!(verdict(&comparison, "rust:c::S::get").1, ["type-changed", "fn-safe-unsafe"]);
    assert_eq!(verdict(&comparison, "rust:c::S::map").0, "unknown");
}

#[test]
fn lost_auto_trait_impls_break_and_constant_values_are_undecided() {
    let ty = structure("rust:c::S");
    let send = member(
        "rust:c::S: Send",
        "rust:c::S",
        "impl",
        "impl Send for S",
        json!({"declaration": "implementation", "term": "impl", "type": {"text": "S"},
            "supertypes": [{"relation": "implements", "type": "Send"}], "native": {"synthetic": true}}),
    );
    let constant = |value: &str| {
        entity(
            "rust:c::MAX",
            "constant",
            "MAX",
            json!({"declaration": "constant", "term": "constant", "type": {"text": "u32"}, "value": value}),
        )
    };
    let comparison = pair(vec![ty.clone(), send, constant("10u32")], vec![ty, constant("20u32")]);
    assert_eq!(verdict(&comparison, "rust:c::S: Send").2, "`S` no longer implements `Send`");
    assert_eq!(verdict(&comparison, "rust:c::MAX").1, ["constant-value"]);
}
