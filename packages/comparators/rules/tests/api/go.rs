//! Go: the Go 1 compatibility promise.

use crate::testing::{api, classify_pair, entity, member, verdict};
use serde_json::{Value, json};

fn pair(before: Vec<Value>, after: Vec<Value>) -> Value {
    classify_pair(&api("go", before), &api("go", after), json!({}))
}

/// A comparable type declaration, with `extra` facts.
fn ty(id: &str, declaration: &str, extra: Value) -> Value {
    let mut contract = json!({"declaration": declaration, "term": "type", "native": {"comparable": true}});
    contract.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    entity(id, "type", id, contract)
}

/// A defined type over a signed integer of `bits`.
fn signed(id: &str, bits: u64) -> Value {
    let name = format!("int{bits}");
    ty(
        id,
        "type",
        json!({"underlying": name, "native": {"comparable": true, "underlying": name,
            "numeric": {"family": "signed", "size32": bits / 8, "size64": bits / 8}}}),
    )
}

/// A method in an interface (`receiver` is `interface`), or a method set.
fn method(id: &str, parent: &str, receiver: &str, signature: &str) -> Value {
    let mut contract = json!({"declaration": "method", "term": "method", "type": {"text": signature}});
    if receiver == "interface" {
        contract["abstract"] = json!(true);
    } else {
        contract["native"] = json!({"receiver": receiver});
    }
    member(id, parent, "method", id, contract)
}

fn value(term: &str, declaration: &str, type_text: &str) -> Value {
    json!({"declaration": declaration, "term": term, "type": {"text": type_text}})
}

fn with_value(mut facts: Value, value: &str) -> Value {
    facts["value"] = json!(value);
    facts
}

#[test]
fn interface_methods_break_implementers_unless_unexported_methods_seal_them() {
    let open = ty("go:p.Store", "interface", json!({}));
    let sealed = ty("go:p.Sealed", "interface", json!({"sealed": true}));
    let comparison = pair(
        vec![open.clone(), sealed.clone()],
        vec![
            open,
            method("go:p.Store.Delete", "go:p.Store", "interface", "func(string) error"),
            sealed,
            method("go:p.Sealed.Delete", "go:p.Sealed", "interface", "func(string) error"),
        ],
    );
    assert_eq!(verdict(&comparison, "go:p.Store.Delete").0, "breaking");
    assert_eq!(verdict(&comparison, "go:p.Sealed.Delete").0, "additive");
}

#[test]
fn method_sets_types_values_and_comparability() {
    let comparison = pair(
        vec![
            ty(
                "go:p.T",
                "struct",
                json!({"supertypes": [{"relation": "implements", "type": "Store"}]}),
            ),
            method("go:p.T.Len", "go:p.T", "value", "func() int"),
            method("go:p.T.Reset", "go:p.T", "pointer", "func()"),
            entity(
                "go:p.Max",
                "constant",
                "Max",
                with_value(value("const", "constant", "untyped int"), "1000"),
            ),
            entity("go:p.New", "function", "New", value("func", "function", "func(Store) *T")),
            signed("go:p.Amount", 32),
            signed("go:p.Small", 64),
        ],
        vec![
            ty("go:p.T", "struct", json!({"native": {}})),
            method("go:p.T.Len", "go:p.T", "pointer", "func() int"),
            method("go:p.T.Reset", "go:p.T", "value", "func()"),
            entity(
                "go:p.Max",
                "constant",
                "Max",
                with_value(value("const", "constant", "untyped int"), "5000"),
            ),
            entity(
                "go:p.New",
                "function",
                "New",
                value("func", "function", "func(Store, ...Option) *T"),
            ),
            signed("go:p.Amount", 64),
            signed("go:p.Small", 32),
        ],
    );
    assert_eq!(verdict(&comparison, "go:p.T").1, ["comparable", "implements"]);
    assert_eq!(verdict(&comparison, "go:p.T.Len").1, ["method-set"]);
    assert_eq!(verdict(&comparison, "go:p.T.Reset").0, "additive");
    assert_eq!(verdict(&comparison, "go:p.Max").2, "Its value changed from `1000` to `5000`");
    assert_eq!(verdict(&comparison, "go:p.New").1, ["type"]);
    assert_eq!(verdict(&comparison, "go:p.Amount").0, "compatible");
    assert_eq!(verdict(&comparison, "go:p.Small").0, "breaking");
}

#[test]
fn a_function_may_become_a_variable_of_its_type() {
    let comparison = pair(
        vec![entity("go:p.Now", "function", "Now", value("func", "function", "func() int"))],
        vec![entity("go:p.Now", "variable", "Now", value("var", "variable", "func() int"))],
    );
    assert_eq!(verdict(&comparison, "go:p.Now").0, "compatible");
}
