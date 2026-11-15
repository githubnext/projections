//! .NET: binary and source compatibility of assemblies.

use crate::testing::{api, classify_pair, entity, kinds, member, verdict};
use serde_json::{Value, json};

const ASM: &str = "api:Lib";

fn assembly() -> Value {
    let mut assembly = entity(ASM, "assembly", "assembly Lib", json!({}));
    assembly["data"].as_object_mut().unwrap().remove("contract");
    assembly
}

/// `facts` with `overrides`.
fn with(mut facts: Value, overrides: Value) -> Value {
    facts.as_object_mut().unwrap().extend(overrides.as_object().unwrap().clone());
    facts
}

fn class(id: &str, contract: Value) -> Value {
    let facts = with(json!({"declaration": "class", "term": "class"}), contract);
    member(id, ASM, "type", &format!("public class {id}"), facts)
}

/// A method's one signature.
fn signature(returns: &str, parameters: Value) -> Value {
    json!([{"parameters": parameters, "returns": {"text": returns}}])
}

fn method(id: &str, parent: &str, contract: Value) -> Value {
    let facts = with(
        json!({"declaration": "method", "term": "method", "signatures": signature("void", json!([]))}),
        contract,
    );
    let signature = format!("{} {id}", facts["signatures"][0]["returns"]["text"].as_str().unwrap());
    member(id, parent, "method", &signature, facts)
}

/// A parameter of type `int`.
fn int(name: &str, optional: bool) -> Value {
    json!({"name": name, "type": {"text": "int"}, "optional": optional, "variadic": false})
}

fn pair(before: Vec<Value>, after: Vec<Value>) -> Value {
    let with = |mut entities: Vec<Value>| {
        entities.insert(0, assembly());
        api("dotnet", entities)
    };
    classify_pair(&with(before), &with(after), json!({}))
}

#[test]
fn removals_break_binaries_and_sources() {
    let comparison = pair(
        vec![
            class("T:A", json!({})),
            method("M:A.Run", "T:A", json!({})),
            class("T:B", json!({})),
        ],
        vec![class("T:B", json!({}))],
    );
    assert_eq!(verdict(&comparison, "T:A").0, "breaking");
    assert_eq!(kinds(&comparison, "T:A"), ["binary", "source"]);
    assert_eq!(verdict(&comparison, "M:A.Run").2, "`Run` was removed with `A`");
}

#[test]
fn abstract_members_break_inheritable_types_only() {
    let before = vec![
        class("T:Open", json!({"abstract": true})),
        class("T:Closed", json!({"sealed": true, "native": {"sealed": true}})),
    ];
    let after = vec![
        class("T:Open", json!({"abstract": true})),
        method("M:Open.Run", "T:Open", json!({"abstract": true})),
        class("T:Closed", json!({"sealed": true, "native": {"sealed": true}})),
        method("M:Closed.Run", "T:Closed", json!({})),
    ];
    let comparison = pair(before, after);
    assert_eq!(verdict(&comparison, "M:Open.Run").1, ["CP0005"]);
    assert_eq!(verdict(&comparison, "M:Closed.Run").0, "additive");
}

#[test]
fn interface_members_without_default_implementations_break() {
    let interface = |id| class(id, json!({"declaration": "interface", "term": "interface", "abstract": true}));
    let comparison = pair(
        vec![interface("T:IStore")],
        vec![
            interface("T:IStore"),
            method("M:IStore.Get", "T:IStore", json!({"abstract": true})),
            method("M:IStore.Describe", "T:IStore", json!({"native": {"virtual": true}})),
        ],
    );
    let (level, rules, reason) = verdict(&comparison, "M:IStore.Get");
    assert_eq!((level.as_str(), rules), ("breaking", vec!["CP0006".to_owned()]));
    assert_eq!(reason, "`Get` was added to interface `IStore` without a default implementation");
    assert_eq!(verdict(&comparison, "M:IStore.Describe").0, "additive");
}

/// Base types (`extends`) and interfaces (`implements`).
fn supertypes(bases: &[&str], interfaces: &[&str]) -> Value {
    let of = |relation: &str, types: &[&str]| -> Vec<Value> { types.iter().map(|t| json!({"relation": relation, "type": t})).collect() };
    json!([of("extends", bases), of("implements", interfaces)].concat())
}

/// An enum's facts, with its underlying type.
fn enumeration(underlying: &str) -> Value {
    json!({"declaration": "enum", "term": "enum", "underlying": underlying, "sealed": true, "native": {"sealed": true}})
}

#[test]
fn type_rules_cover_sealing_hierarchy_and_enums() {
    let comparison = pair(
        vec![
            class(
                "T:A",
                json!({"supertypes": supertypes(&["Base", "Root"], &["IDisposable", "IOld"])}),
            ),
            class("T:E", enumeration("int")),
        ],
        vec![
            class(
                "T:A",
                json!({"sealed": true, "native": {"sealed": true},
                    "supertypes": supertypes(&["Root"], &["IDisposable", "INew"])}),
            ),
            class("T:E", enumeration("long")),
        ],
    );
    let (level, rules, reason) = verdict(&comparison, "T:A");
    assert_eq!(level, "breaking");
    assert_eq!(rules, ["CP0009", "CP0007", "CP0008"]);
    assert_eq!(
        reason,
        "Became `sealed`; it can no longer be inherited; No longer derives from `Base`; No longer implements `IOld`"
    );
    assert_eq!(verdict(&comparison, "T:E").1, ["CP0010"]);
}

#[test]
fn member_rules_cover_types_names_virtuality_and_values() {
    let field = |id: &str, value: i64, parent: &str| {
        let (declaration, term) = if parent == "T:E" {
            ("variant", "enum member")
        } else {
            ("constant", "const")
        };
        member(
            id,
            parent,
            "field",
            "",
            json!({"declaration": declaration, "term": term, "type": {"text": "int"}, "value": value.to_string()}),
        )
    };
    let comparison = pair(
        vec![
            class("T:A", json!({})),
            method("M:A.Get", "T:A", json!({"signatures": signature("string", json!([]))})),
            method(
                "M:A.Run(System.Int32)",
                "T:A",
                json!({"native": {"virtual": true}, "signatures": signature("void", json!([int("count", false)]))}),
            ),
            method("M:A.Hidden", "T:A", json!({})),
            class("T:E", json!({"declaration": "enum", "term": "enum", "sealed": true})),
            field("F:E.One", 1, "T:E"),
            field("F:A.Limit", 10, "T:A"),
        ],
        vec![
            class("T:A", json!({})),
            method(
                "M:A.Get",
                "T:A",
                json!({"signatures": signature("System.Threading.Tasks.Task<string>", json!([]))}),
            ),
            method(
                "M:A.Run(System.Int32)",
                "T:A",
                json!({"signatures": signature("void", json!([with(int("times", true), json!({"default": "1"}))]))}),
            ),
            method("M:A.Hidden", "T:A", json!({"visibility": "protected"})),
            class("T:E", json!({"declaration": "enum", "term": "enum", "sealed": true})),
            field("F:E.One", 2, "T:E"),
            field("F:A.Limit", 20, "T:A"),
        ],
    );
    assert_eq!(
        verdict(&comparison, "M:A.Get"),
        (
            "breaking".into(),
            vec!["CP0002".into()],
            "Return type changed from `string` to `System.Threading.Tasks.Task<string>`".into()
        )
    );
    let (_, rules, _) = verdict(&comparison, "M:A.Run(System.Int32)");
    assert_eq!(rules, ["CP0017", "CP0012"]);
    assert_eq!(kinds(&comparison, "M:A.Run(System.Int32)"), ["binary", "source"]);
    assert_eq!(verdict(&comparison, "M:A.Hidden").1, ["CP0019"]);
    assert_eq!(verdict(&comparison, "F:E.One").1, ["CP0011"]);
    assert_eq!(kinds(&comparison, "F:E.One"), ["binary"]);
    assert_eq!(verdict(&comparison, "F:A.Limit").1, ["constant-value"]);
}

#[test]
fn strict_mode_only_changes_and_annotations_are_compatible() {
    let comparison = pair(
        vec![
            class("T:A", json!({})),
            method("M:A.Run", "T:A", json!({"visibility": "protected"})),
            method("M:A.Name", "T:A", json!({"signatures": signature("string", json!([]))})),
        ],
        vec![
            class("T:A", json!({})),
            method("M:A.Run", "T:A", json!({"native": {"virtual": true}})),
            {
                let mut annotated = method("M:A.Name", "T:A", json!({"signatures": signature("string", json!([]))}));
                annotated["data"]["signature"] = json!("string? M:A.Name");
                annotated
            },
        ],
    );
    assert_eq!(verdict(&comparison, "M:A.Run").1, ["CP0020", "CP0013"]);
    assert_eq!(verdict(&comparison, "M:A.Run").0, "compatible");
    assert_eq!(
        verdict(&comparison, "M:A.Name"),
        (
            "compatible".into(),
            vec!["annotations".into()],
            "Only nullable annotations or formatting changed".into()
        )
    );
}

#[test]
fn attributes_accessors_and_constraints() {
    let property = |access: Value, attributes: Value| {
        member(
            "P:A.Name",
            "T:A",
            "property",
            "string Name",
            json!({"declaration": "property", "term": "property", "type": {"text": "string"},
                "access": access, "attributes": attributes}),
        )
    };
    let generic = |constraints: Value| {
        method(
            "M:A.Make``1",
            "T:A",
            json!({"signatures": [{"parameters": [], "returns": {"text": "void"},
                "typeParameters": [{"name": "T", "constraints": constraints}]}]}),
        )
    };
    let comparison = pair(
        vec![
            class("T:A", json!({})),
            property(
                json!({"read": "public", "write": "public"}),
                json!(["System.ObsoleteAttribute(\"old\")", "Lib.TagAttribute"]),
            ),
            generic(json!(["class"])),
        ],
        vec![
            class("T:A", json!({})),
            property(
                json!({"read": "public", "init": "public"}),
                json!(["System.ObsoleteAttribute(\"new\")"]),
            ),
            generic(json!(["class", "new()"])),
        ],
    );
    let (level, rules, _) = verdict(&comparison, "P:A.Name");
    assert_eq!(level, "breaking");
    assert_eq!(rules, ["accessor", "CP0015", "CP0014"]);
    let (_, rules, reason) = verdict(&comparison, "M:A.Make``1");
    assert_eq!(rules, ["CP0021"]);
    assert_eq!(reason, "Type parameter `T` gained the constraint `new()`");
}
