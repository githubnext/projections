//! Generated values: volatile values judged by the basis an extractor records
//! beside them, in declarations, items, matched pairs, comparison validation
//! and rerun checks.

mod common;

use common::{assessed, declarations_of, varied_between};
use projections_engine::volatility::{Varied, regenerated_because, vary};
use projections_engine::{canonicalize, normalize, validate_comparison};
use serde_json::{Value, json};

const SUMMARY: &str = "/data/summary";

fn declaration() -> Value {
    json!({"kinds": ["class"], "path": SUMMARY, "generated": true, "basis": "/data/summaryBasis"})
}

fn extraction(entities: Value, volatile: Value) -> Value {
    json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities,
        "relationships": [], "volatile": volatile})
}

fn class(id: &str, summary: &str, basis: Value) -> Value {
    json!({"id": id, "kind": "class", "label": id,
        "data": {"summary": summary, "summaryBasis": basis}})
}

fn basis(input: &str, model: &str) -> Value {
    json!({"input": input, "prompt": "sha256:p", "model": model})
}

fn rejected(entities: Value, volatile: Value) -> (String, String) {
    let failure = normalize(&extraction(entities, volatile), "").unwrap_err();
    (failure[0].code.clone(), failure[0].path.clone())
}

fn differences(before: Value, after: Value) -> Vec<Varied> {
    let declarations = declarations_of(
        &normalize(&extraction(json!([]), json!([declaration()])), "").unwrap(),
        &normalize(&extraction(json!([]), json!([declaration()])), "").unwrap(),
    );
    varied_between(&declarations, "entities", &before, &after)
}

fn generated(within: bool, because: &[&str], reason: Option<&str>) -> Varied {
    Varied {
        path: SUMMARY.to_owned(),
        within,
        reason: reason.map(str::to_owned),
        generated: true,
        because: because.iter().map(|part| (*part).to_owned()).collect(),
    }
}

#[test]
fn declarations_are_validated() {
    for (volatile, code, path) in [
        (
            json!([{"path": SUMMARY, "generated": false, "basis": "/data/b"}]),
            "invalid-type",
            "/volatile/0/generated",
        ),
        (json!([{"path": SUMMARY, "generated": true}]), "invalid-generated", "/volatile/0"),
        (
            json!([{"path": SUMMARY, "basis": "/data/b"}]),
            "invalid-generated",
            "/volatile/0/basis",
        ),
        (
            json!([{"path": SUMMARY, "generated": true, "basis": "/label"}]),
            "invalid-volatile-path",
            "/volatile/0/basis",
        ),
        (
            json!([{"path": SUMMARY, "generated": true, "basis": "/data/*/b"}]),
            "invalid-volatile-path",
            "/volatile/0/basis",
        ),
        (
            json!([{"path": SUMMARY, "generated": true, "basis": "/data/b",
                "tolerance": {"absolute": 1}}]),
            "invalid-tolerance",
            "/volatile/0/tolerance",
        ),
        (
            json!([{"path": SUMMARY, "generated": true, "basis": "/data/summary/basis"}]),
            "volatile-basis",
            "/volatile/0/basis",
        ),
        (
            json!([
                {"path": SUMMARY, "generated": true, "basis": "/data/b/inner"},
                {"path": "/data/b"},
            ]),
            "volatile-basis",
            "/volatile/0/basis",
        ),
        (
            json!([
                {"path": "/data/*/x"},
                {"kinds": ["class"], "path": SUMMARY, "generated": true, "basis": "/data/b/x"},
            ]),
            "volatile-basis",
            "/volatile/1/basis",
        ),
    ] {
        assert_eq!(
            rejected(json!([]), volatile.clone()),
            (code.to_owned(), path.to_owned()),
            "{volatile}"
        );
    }
}

#[test]
fn a_basis_in_another_scope_may_be_volatile_elsewhere() {
    let volatile = json!([
        declaration(),
        {"kinds": ["test"], "path": "/data/summaryBasis"},
        {"collection": "relationships", "path": "/data/summaryBasis"},
    ]);
    let normalized = normalize(&extraction(json!([]), volatile), "").unwrap();
    assert_eq!(
        normalized["volatile"][0],
        json!({"collection": "entities", "kinds": ["class"], "path": SUMMARY,
            "generated": true, "basis": "/data/summaryBasis"})
    );
}

#[test]
fn bases_are_validated_in_items() {
    let good = basis("sha256:a", "m@1");
    for (entity, code, path) in [
        (
            json!({"id": "a", "kind": "class", "label": "a", "data": {"summary": "x"}}),
            "missing-basis",
            "/entities/0/data/summary",
        ),
        (
            json!({"id": "a", "kind": "class", "label": "a", "data": {"summaryBasis": good}}),
            "orphan-basis",
            "/entities/0/data/summaryBasis",
        ),
        (class("a", "x", json!("sha256:a")), "invalid-basis", "/entities/0/data/summaryBasis"),
        (class("a", "x", json!({})), "invalid-basis", "/entities/0/data/summaryBasis"),
        (
            class("a", "x", json!({"input": ""})),
            "invalid-basis",
            "/entities/0/data/summaryBasis/input",
        ),
        (
            class("a", "x", json!({"input": 1})),
            "invalid-basis",
            "/entities/0/data/summaryBasis/input",
        ),
        (
            class("a", "x", json!({"input": "x".repeat(257)})),
            "invalid-basis",
            "/entities/0/data/summaryBasis/input",
        ),
        (
            class("a", "x", json!({"9lives": "x"})),
            "invalid-basis",
            "/entities/0/data/summaryBasis/9lives",
        ),
        (
            class("a", "x", Value::Object((0..17).map(|n| (format!("p{n}"), json!("x"))).collect())),
            "invalid-basis",
            "/entities/0/data/summaryBasis",
        ),
    ] {
        assert_eq!(
            rejected(json!([entity]), json!([declaration()])),
            (code.to_owned(), path.to_owned()),
            "{entity}"
        );
    }
    // Another kind isn't covered, and an item with neither is fine.
    let other = json!({"id": "t", "kind": "test", "label": "t", "data": {"summary": "x"}});
    let none = json!({"id": "n", "kind": "class", "label": "n"});
    assert!(normalize(&extraction(json!([other, none]), json!([declaration()])), "").is_ok());
}

#[test]
fn wildcard_bases_follow_their_paths() {
    let volatile = json!([{"path": "/data/methods/*/summary", "generated": true,
        "basis": "/data/methods/*/basis"}]);
    let entity = json!({"id": "a", "kind": "class", "label": "a", "data": {"methods": {
        "run": {"summary": "Runs.", "basis": {"input": "sha256:r"}},
        "stop": {"summary": "Stops."},
    }}});
    assert_eq!(
        rejected(json!([entity]), volatile.clone()),
        ("missing-basis".to_owned(), "/entities/0/data/methods/stop/summary".to_owned())
    );
    let before = json!({"id": "a", "kind": "class", "label": "a", "data": {"methods": [
        {"summary": "Runs.", "basis": {"input": "sha256:r"}},
        {"summary": "Stops.", "basis": {"input": "sha256:s"}},
    ]}});
    let after = json!({"id": "a", "kind": "class", "label": "a", "data": {"methods": [
        {"summary": "It runs.", "basis": {"input": "sha256:r"}},
        {"summary": "It stops.", "basis": {"input": "sha256:t"}},
    ]}});
    let declarations = declarations_of(
        &normalize(&extraction(json!([before.clone()]), volatile.clone()), "").unwrap(),
        &normalize(&extraction(json!([after.clone()]), volatile), "").unwrap(),
    );
    let assessment = assessed(&declarations, &before, &after);
    assert_eq!(
        assessment.varied,
        vec![
            Varied {
                path: "/data/methods/0/summary".to_owned(),
                within: true,
                generated: true,
                ..Varied::default()
            },
            Varied {
                path: "/data/methods/1/summary".to_owned(),
                within: false,
                generated: true,
                because: vec!["input".to_owned()],
                ..Varied::default()
            },
        ]
    );
    assert!(assessment.residual.is_empty());
}

#[test]
fn equal_bases_make_rewording_expected() {
    let before = class("a", "Validates orders.", basis("sha256:a", "m@1"));
    let after = class("a", "Checks orders.", basis("sha256:a", "m@1"));
    assert_eq!(differences(before.clone(), after.clone()), vec![generated(true, &[], None)]);
    assert!(differences(before.clone(), before).is_empty());
}

#[test]
fn different_bases_name_the_parts_that_moved() {
    let before = class("a", "Validates orders.", basis("sha256:a", "m@1"));
    assert_eq!(
        differences(before.clone(), class("a", "Checks orders.", basis("sha256:b", "m@2"))),
        vec![generated(false, &["input", "model"], None)]
    );
    // The same wording from a moved basis is still a change.
    assert_eq!(
        differences(before.clone(), class("a", "Validates orders.", basis("sha256:a", "m@2"))),
        vec![generated(false, &["model"], None)]
    );
    // A part on one side only moved.
    let extra = json!({"input": "sha256:a", "prompt": "sha256:p", "model": "m@1", "context": "c"});
    assert_eq!(
        differences(before, class("a", "Validates orders.", extra)),
        vec![generated(false, &["context"], None)]
    );
}

#[test]
fn a_value_on_one_side_only_is_beyond() {
    let bare = json!({"id": "a", "kind": "class", "label": "a"});
    let summarized = class("a", "Validates orders.", basis("sha256:a", "m@1"));
    assert_eq!(
        differences(bare.clone(), summarized.clone()),
        vec![generated(false, &[], Some("Generated only after"))]
    );
    assert_eq!(
        differences(summarized, bare),
        vec![generated(false, &[], Some("Generated only before"))]
    );
}

#[test]
fn a_basis_is_judged_only_through_its_value() {
    let before = class("a", "Validates orders.", basis("sha256:a", "m@1"));
    let after = class("a", "Checks orders.", basis("sha256:a", "m@1"));
    let declarations = declarations_of(
        &normalize(&extraction(json!([]), json!([declaration()])), "").unwrap(),
        // The after side declares the basis plainly volatile in another scope;
        // the generated declaration still owns it for classes.
        &normalize(
            &extraction(json!([]), json!([declaration(), {"kinds": ["test"], "path": "/data/summaryBasis"}])),
            "",
        )
        .unwrap(),
    );
    let assessment = assessed(&declarations, &before, &after);
    assert_eq!(assessment.varied, vec![generated(true, &[], None)]);
    assert!(assessment.residual.is_empty() && assessment.unchanged());

    let moved = class("a", "Checks orders.", basis("sha256:b", "m@1"));
    let assessment = assessed(&declarations, &before, &moved);
    assert!(assessment.residual.is_empty() && !assessment.unchanged());
}

#[test]
fn a_generated_declaration_is_tighter_than_a_plain_one() {
    let plain = json!({"kinds": ["class"], "path": SUMMARY});
    let declarations = declarations_of(
        &normalize(&extraction(json!([]), json!([plain])), "").unwrap(),
        &normalize(&extraction(json!([]), json!([declaration()])), "").unwrap(),
    );
    let before = class("a", "Validates orders.", basis("sha256:a", "m@1"));
    let after = class("a", "Checks orders.", basis("sha256:b", "m@1"));
    assert_eq!(
        varied_between(&declarations, "entities", &before, &after),
        vec![generated(false, &["input"], None)]
    );
}

#[test]
fn every_sides_basis_counts() {
    let declarations = declarations_of(
        &normalize(&extraction(json!([]), json!([declaration()])), "").unwrap(),
        &normalize(&extraction(json!([]), json!([other_declaration()])), "").unwrap(),
    );
    let item = |summary: &str, other: &str| {
        json!({"id": "a", "kind": "class", "label": "a", "data": {"summary": summary,
            "summaryBasis": {"input": "sha256:x"}, "other": {"input": other}}})
    };
    assert_eq!(
        varied_between(&declarations, "entities", &item("A.", "sha256:1"), &item("B.", "sha256:1")),
        vec![generated(true, &[], None)]
    );
    assert_eq!(
        varied_between(&declarations, "entities", &item("A.", "sha256:1"), &item("B.", "sha256:2")),
        vec![generated(false, &["input"], None)]
    );
    // The before side's basis moving counts as much as the after side's.
    let moved_before = |summary: &str, basis: &str| {
        json!({"id": "a", "kind": "class", "label": "a", "data": {"summary": summary,
            "summaryBasis": {"input": basis}, "other": {"input": "sha256:1"}}})
    };
    assert_eq!(
        varied_between(
            &declarations,
            "entities",
            &moved_before("A.", "sha256:x"),
            &moved_before("B.", "sha256:y")
        ),
        vec![generated(false, &["input"], None)]
    );
    let reversed = declarations_of(
        &normalize(&extraction(json!([]), json!([other_declaration()])), "").unwrap(),
        &normalize(&extraction(json!([]), json!([declaration()])), "").unwrap(),
    );
    assert_eq!(
        varied_between(
            &reversed,
            "entities",
            &moved_before("A.", "sha256:x"),
            &moved_before("B.", "sha256:y")
        ),
        vec![generated(false, &["input"], None)]
    );
}

fn other_declaration() -> Value {
    json!({"kinds": ["class"], "path": SUMMARY, "generated": true, "basis": "/data/other"})
}

#[test]
fn regeneration_reads_as_a_sentence() {
    let words = |parts: &[&str]| regenerated_because(&parts.iter().map(|p| (*p).to_owned()).collect::<Vec<_>>());
    assert_eq!(words(&[]), "Regenerated from the same inputs");
    assert_eq!(words(&["input"]), "Regenerated because the input changed");
    assert_eq!(words(&["input", "prompt"]), "Regenerated because the input and the prompt changed");
    assert_eq!(
        words(&["context", "model", "prompt"]),
        "Regenerated because `context`, the model and the prompt changed"
    );
}

#[test]
fn extractions_without_generated_values_keep_their_bytes() {
    let plain = extraction(
        json!([{"id": "t", "kind": "test", "label": "t", "data": {"ms": 1}}]),
        json!([{"path": "/data/ms"}]),
    );
    let normalized = normalize(&plain, "").unwrap();
    assert_eq!(normalized["volatile"], json!([{"collection": "entities", "path": "/data/ms"}]));
    let bytes = canonicalize(&normalized).unwrap().0;
    assert!(!bytes.contains("generated") && !bytes.contains("basis"));
}

fn comparison(varied: Value, status: &str) -> Value {
    json!({"protocolVersion": 0, "changes": [
        {"id": "a", "collection": "entities", "before": ["a"], "after": ["a"],
         "status": status, "correspondence": "exact", "varied": varied}],
        "steps": if status == "modified" { json!([{"changes": ["a"]}]) } else { json!([]) },
        "variation": if status == "modified" { json!({"within": 0, "beyond": 1}) }
            else { json!({"within": 1, "beyond": 0}) }})
}

#[test]
fn comparisons_carry_generated_and_because() {
    let before = extraction(
        json!([class("a", "Validates orders.", basis("sha256:a", "m@1"))]),
        json!([declaration()]),
    );
    let reworded = extraction(
        json!([class("a", "Checks orders.", basis("sha256:a", "m@1"))]),
        json!([declaration()]),
    );
    let moved = extraction(
        json!([class("a", "Checks orders.", basis("sha256:b", "m@1"))]),
        json!([declaration()]),
    );
    let within = comparison(json!([{"path": SUMMARY, "within": true, "generated": true}]), "unchanged");
    validate_comparison(&before, &reworded, &within).unwrap();
    let changed = comparison(
        json!([{"path": SUMMARY, "within": false, "generated": true, "because": ["input"]}]),
        "modified",
    );
    validate_comparison(&before, &moved, &changed).unwrap();
    // Leaving out generated or because is inconsistent.
    for (after, wrong, status) in [
        (&reworded, json!([{"path": SUMMARY, "within": true}]), "unchanged"),
        (&moved, json!([{"path": SUMMARY, "within": false, "generated": true}]), "modified"),
        (
            &moved,
            json!([{"path": SUMMARY, "within": false, "generated": true, "because": ["model"]}]),
            "modified",
        ),
    ] {
        let failure = validate_comparison(&before, after, &comparison(wrong, status)).unwrap_err();
        assert_eq!(failure[0].code, "inconsistent-variation");
    }
    for (wrong, code) in [
        (json!([{"path": SUMMARY, "within": true, "generated": false}]), "invalid-type"),
        (
            json!([{"path": SUMMARY, "within": false, "generated": true, "because": []}]),
            "invalid-type",
        ),
    ] {
        let failure = validate_comparison(&before, &moved, &comparison(wrong, "modified")).unwrap_err();
        assert_eq!(failure[0].code, code);
    }
}

#[test]
fn reruns_that_reword_from_equal_bases_are_reproducible() {
    let run = |summary: &str, model: &str| extraction(json!([class("a", summary, basis("sha256:a", model))]), json!([declaration()]));
    let variation = vary(&run("A.", "m@1"), &run("B.", "m@1")).unwrap();
    assert!(variation.reproducible() && !variation.equal);
    assert_eq!(
        variation.to_json()["within"],
        json!([{"collection": "entities", "id": "a", "path": SUMMARY, "generated": true}])
    );
    let variation = vary(&run("A.", "m@1"), &run("B.", "m@2")).unwrap();
    assert!(!variation.reproducible());
    assert_eq!(
        variation.to_json()["beyond"],
        json!([{"collection": "entities", "id": "a", "path": SUMMARY, "generated": true,
            "because": ["model"], "reason": "Regenerated because the model changed"}])
    );
}

#[test]
fn generated_values_are_listed_with_their_keys() {
    use projections_engine::volatility::{Generated, basis_digest, generated_values, sha256};
    assert_eq!(
        sha256(b""),
        "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    let cart_basis = basis("sha256:a", "m@1");
    assert_eq!(
        basis_digest(&cart_basis).unwrap(),
        sha256(br#"{"input":"sha256:a","model":"m@1","prompt":"sha256:p"}"#)
    );
    let methods = json!({"path": "/data/methods/*/summary", "generated": true,
        "basis": "/data/methods/*/basis"});
    let relationship = json!({"collection": "relationships", "path": "/data/note",
        "generated": true, "basis": "/data/noteBasis"});
    let extraction = normalize(
        &json!({"protocolVersion": 0, "schema": "graph/v0",
            "volatile": [declaration(), methods, relationship, {"path": "/data/ms"}],
            "entities": [
                class("cart", "Holds a cart.", cart_basis.clone()),
                {"id": "orders", "kind": "service", "label": "orders", "data": {
                    "summary": "not a class", "methods": [
                        {"summary": "Places.", "basis": {"input": "sha256:o"}}]}},
                {"id": "plain", "kind": "service", "label": "plain", "data": {"methods": "none"}},
            ],
            "relationships": [{"id": "uses", "kind": "uses", "from": "orders", "to": "cart",
                "data": {"note": {"text": "Calls the cart."}, "noteBasis": {"input": "sha256:n"}}}]}),
        "",
    )
    .unwrap();
    let digest = |value: Value| basis_digest(&value).unwrap();
    assert_eq!(
        generated_values(&extraction),
        vec![
            Generated {
                collection: "entities",
                id: "cart".to_owned(),
                declared: SUMMARY.to_owned(),
                path: SUMMARY.to_owned(),
                basis: digest(cart_basis),
                value: json!("Holds a cart."),
            },
            Generated {
                collection: "entities",
                id: "orders".to_owned(),
                declared: "/data/methods/*/summary".to_owned(),
                path: "/data/methods/0/summary".to_owned(),
                basis: digest(json!({"input": "sha256:o"})),
                value: json!("Places."),
            },
            Generated {
                collection: "relationships",
                id: "uses".to_owned(),
                declared: "/data/note".to_owned(),
                path: "/data/note".to_owned(),
                basis: digest(json!({"input": "sha256:n"})),
                value: json!({"text": "Calls the cart."}),
            },
        ]
    );
    // Without generated declarations there are none.
    let plain = normalize(&extraction_without_generated(), "").unwrap();
    assert!(generated_values(&plain).is_empty());
}

fn extraction_without_generated() -> Value {
    json!({"protocolVersion": 0, "schema": "graph/v0", "relationships": [],
        "volatile": [{"path": "/data/ms"}],
        "entities": [{"id": "t", "kind": "test", "label": "t", "data": {"ms": 1}}]})
}

#[test]
fn a_varied_entry_serializes_every_field_it_has() {
    let entry = Varied {
        path: SUMMARY.to_owned(),
        within: false,
        reason: Some("Generated only after".to_owned()),
        generated: true,
        because: vec!["input".to_owned()],
    };
    assert_eq!(
        entry.to_json(),
        json!({"path": SUMMARY, "within": false, "reason": "Generated only after",
            "generated": true, "because": ["input"]})
    );
}

#[test]
fn what_differs_outside_generated_values_is_residual() {
    let declarations = declarations_of(
        &normalize(&extraction(json!([]), json!([declaration()])), "").unwrap(),
        &normalize(&extraction(json!([]), json!([declaration()])), "").unwrap(),
    );
    let before = json!({"id": "a", "kind": "class", "label": "a",
        "data": {"summary": "A.", "summaryBasis": {"input": "sha256:a"}, "meta": {"x": 1}}});
    let mut after = before.clone();
    after["data"]["summary"] = json!("B.");
    after["data"]["meta"]["y"] = json!(2);
    after["confidence"] = json!("derived");
    let assessment = assessed(&declarations, &before, &after);
    assert_eq!(assessment.varied, vec![generated(true, &[], None)]);
    assert_eq!(assessment.residual, vec!["/confidence", "/data/meta"]);
    assert!(!assessment.unchanged());
}

#[test]
fn declarations_at_one_path_sort_by_their_kinds() {
    let normalized = normalize(
        &extraction(
            json!([]),
            json!([
                {"kinds": ["b"], "path": "/data/x"},
                {"kinds": ["a", "c"], "path": "/data/x"},
                {"kinds": ["a"], "path": "/data/x"},
                {"path": "/data/x"},
            ]),
        ),
        "",
    )
    .unwrap();
    let kinds: Vec<Value> = normalized["volatile"]
        .as_array()
        .unwrap()
        .iter()
        .map(|declaration| declaration.get("kinds").cloned().unwrap_or(Value::Null))
        .collect();
    assert_eq!(kinds, vec![json!(null), json!(["a"]), json!(["a", "c"]), json!(["b"])]);
}

#[test]
fn basis_part_names_take_underscores_and_hyphens_and_up_to_sixteen_parts() {
    let named = json!({"few-shot": "sha256:f", "context_v2": "sha256:c"});
    let sixteen = Value::Object((0..16).map(|n| (format!("p{n}"), json!("x"))).collect());
    for basis in [named, sixteen] {
        let entity = class("a", "x", basis.clone());
        assert!(
            normalize(&extraction(json!([entity]), json!([declaration()])), "").is_ok(),
            "{basis}"
        );
    }
}

#[test]
fn a_volatile_basis_names_the_declaration_it_overlaps() {
    let message = |volatile: Value| normalize(&extraction(json!([]), volatile), "").unwrap_err()[0].message.clone();
    assert!(message(json!([{"path": SUMMARY, "generated": true, "basis": "/data/summary/basis"}])).ends_with("overlaps its own path"));
    assert!(
        message(json!([
            {"path": SUMMARY, "generated": true, "basis": "/data/b"},
            {"path": "/data/b"},
        ]))
        .ends_with("overlaps the path of /volatile/1")
    );
}
