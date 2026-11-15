//! Volatile data: declarations, tolerances, the tighter of both sides'
//! declarations, content equality modulo expected variation, comparison
//! validation of `varied` and `variation`, and rerun checks.

mod common;

use common::{assessed, declarations_of, varied_between};
use projections_engine::volatility::{Varied, vary};
use projections_engine::{canonicalize, normalize, validate_comparison};
use serde_json::{Value, json};

fn extraction(entities: Value, volatile: Value) -> Value {
    json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities,
        "relationships": [], "volatile": volatile})
}

fn normalized(entities: Value, volatile: Value) -> Value {
    normalize(&extraction(entities, volatile), "").unwrap()
}

fn rejected(volatile: Value) -> (String, String) {
    let failure = normalize(&extraction(json!([]), volatile), "").unwrap_err();
    (failure[0].code.clone(), failure[0].path.clone())
}

fn test(id: &str, data: Value) -> Value {
    json!({"id": id, "kind": "test", "label": id, "data": data})
}

fn item(data: Value) -> Value {
    test("t", data)
}

fn within(path: &str) -> Varied {
    Varied {
        path: path.to_owned(),
        within: true,
        ..Varied::default()
    }
}

fn beyond(path: &str) -> Varied {
    Varied {
        path: path.to_owned(),
        within: false,
        ..Varied::default()
    }
}

/// The volatile differences of one test item under declarations on both sides.
fn varied(before_volatile: Value, after_volatile: Value, before: Value, after: Value) -> Vec<Varied> {
    let declarations = declarations_of(&normalized(json!([]), before_volatile), &normalized(json!([]), after_volatile));
    varied_between(&declarations, "entities", &item(before), &item(after))
}

fn one(declaration: Value, before: Value, after: Value) -> Vec<Varied> {
    varied(json!([declaration]), json!([declaration]), before, after)
}

fn duration(tolerance: Value) -> Value {
    json!({"path": "/data/durationMs", "tolerance": tolerance})
}

#[test]
fn declarations_are_validated() {
    for (volatile, code, path) in [
        (json!({}), "invalid-type", "/volatile"),
        (json!([{"path": "/label"}]), "invalid-volatile-path", "/volatile/0/path"),
        (json!([{"path": "/data"}]), "invalid-volatile-path", "/volatile/0/path"),
        (json!([{"path": "data/x"}]), "invalid-volatile-path", "/volatile/0/path"),
        (json!([{"path": "/data/a~2b"}]), "invalid-volatile-path", "/volatile/0/path"),
        (json!([{"path": "/data/a~"}]), "invalid-volatile-path", "/volatile/0/path"),
        (json!([{"path": ""}]), "invalid-type", "/volatile/0/path"),
        (json!([{"path": "/data/x", "other": 1}]), "unknown-field", "/volatile/0/other"),
        (
            json!([{"path": "/data/x", "collection": "items"}]),
            "invalid-type",
            "/volatile/0/collection",
        ),
        (json!([{"path": "/data/x", "kinds": []}]), "invalid-type", "/volatile/0/kinds"),
        (
            json!([{"path": "/data/x", "kinds": ["a", "a"]}]),
            "duplicate-kind",
            "/volatile/0/kinds/1",
        ),
        (json!([{"path": "/data/x", "kinds": [" "]}]), "invalid-type", "/volatile/0/kinds/0"),
        (
            json!([{"path": "/data/x", "tolerance": {}}]),
            "invalid-tolerance",
            "/volatile/0/tolerance",
        ),
        (
            json!([{"path": "/data/x", "tolerance": {"absolute": -1}}]),
            "invalid-tolerance",
            "/volatile/0/tolerance/absolute",
        ),
        (
            json!([{"path": "/data/x", "tolerance": {"relative": "0.1"}}]),
            "invalid-tolerance",
            "/volatile/0/tolerance/relative",
        ),
        (
            json!([{"path": "/data/x", "tolerance": {"relative": null}}]),
            "invalid-tolerance",
            "/volatile/0/tolerance/relative",
        ),
        (
            json!([{"path": "/data/x", "tolerance": {"factor": 2}}]),
            "invalid-tolerance",
            "/volatile/0/tolerance/factor",
        ),
        (
            json!([{"path": "/data/x", "tolerance": {"spread": "/data/s", "factor": -2}}]),
            "invalid-tolerance",
            "/volatile/0/tolerance/factor",
        ),
        (
            json!([{"path": "/data/x", "tolerance": {"spread": "/id"}}]),
            "invalid-volatile-path",
            "/volatile/0/tolerance/spread",
        ),
        (
            json!([{"path": "/data/x", "tolerance": {"spread": "/data/*/s"}}]),
            "invalid-volatile-path",
            "/volatile/0/tolerance/spread",
        ),
        (
            json!([{"path": "/data/x", "tolerance": {"absolute": 1, "other": 1}}]),
            "unknown-field",
            "/volatile/0/tolerance/other",
        ),
        (
            json!([{"path": "/data/x"}, {"path": "/data/x", "collection": "entities"}]),
            "duplicate-volatile",
            "/volatile/1",
        ),
        (
            json!([{"path": "/data/x", "kinds": ["a", "b"]}, {"path": "/data/x", "kinds": ["b", "a"]}]),
            "duplicate-volatile",
            "/volatile/1",
        ),
    ] {
        assert_eq!(rejected(volatile.clone()), (code.to_owned(), path.to_owned()), "{volatile}");
    }
    let many: Vec<Value> = (0..257).map(|n| json!({"path": format!("/data/x{n}")})).collect();
    assert_eq!(rejected(json!(many)).0, "volatile-limit");
    let long = format!("/data/{}", "x".repeat(1100));
    assert_eq!(rejected(json!([{"path": long}])).0, "invalid-volatile-path");
    // Both limits are inclusive: 256 declarations, and pointers of 1024 bytes.
    let most: Vec<Value> = (0..256).map(|n| json!({"path": format!("/data/x{n}")})).collect();
    assert_eq!(normalized(json!([]), json!(most))["volatile"].as_array().unwrap().len(), 256);
    let longest = format!("/data/{}", "x".repeat(1018));
    assert_eq!(longest.len(), 1024);
    normalized(json!([]), json!([{"path": longest}]));
    let over = format!("{longest}x");
    assert_eq!(rejected(json!([{"path": over}])).0, "invalid-volatile-path");
    // Distinct kinds, collections and paths are distinct declarations.
    normalized(
        json!([]),
        json!([
            {"path": "/data/x"},
            {"path": "/data/x", "kinds": ["a"]},
            {"path": "/data/x", "collection": "relationships"},
            {"path": "/data/*/~0~1", "tolerance": {"spread": "/data/*/s"}},
        ]),
    );
}

#[test]
fn declarations_normalize_and_count_in_the_digest() {
    let extraction = normalized(
        json!([]),
        json!([
            {"path": "/data/b", "kinds": ["z", "a"]},
            {"path": "/data/a", "collection": "relationships"},
            {"path": "/data/a"},
        ]),
    );
    assert_eq!(
        extraction["volatile"],
        json!([
            {"collection": "entities", "path": "/data/a"},
            {"collection": "entities", "kinds": ["a", "z"], "path": "/data/b"},
            {"collection": "relationships", "path": "/data/a"},
        ])
    );
    let empty = normalized(json!([]), json!([]));
    assert!(empty.get("volatile").is_none());
    let plain = normalize(
        &json!({"protocolVersion": 0, "schema": "graph/v0", "entities": [], "relationships": []}),
        "",
    )
    .unwrap();
    assert_eq!(canonicalize(&empty).unwrap(), canonicalize(&plain).unwrap());
    let (canonical, digest) = canonicalize(&extraction).unwrap();
    assert!(canonical.contains("\"volatile\""));
    assert_ne!(digest, canonicalize(&plain).unwrap().1);
    // Volatile values stay in the digest.
    let a = normalized(json!([item(json!({"durationMs": 1}))]), json!([duration(json!({"absolute": 5}))]));
    let b = normalized(json!([item(json!({"durationMs": 2}))]), json!([duration(json!({"absolute": 5}))]));
    assert_ne!(canonicalize(&a).unwrap().1, canonicalize(&b).unwrap().1);
}

#[test]
fn tolerances_bound_numeric_differences() {
    let check = |tolerance: Value, before: Value, after: Value| -> Vec<Varied> {
        one(duration(tolerance), json!({"durationMs": before}), json!({"durationMs": after}))
    };
    let path = "/data/durationMs";
    // Equal values never vary.
    assert_eq!(check(json!({"absolute": 0}), json!(5), json!(5.0)), vec![]);
    // Absolute.
    assert_eq!(check(json!({"absolute": 50}), json!(100), json!(150)), vec![within(path)]);
    assert_eq!(check(json!({"absolute": 50}), json!(100), json!(151)), vec![beyond(path)]);
    assert_eq!(check(json!({"absolute": 0}), json!(1), json!(2)), vec![beyond(path)]);
    // Relative to the larger magnitude.
    assert_eq!(check(json!({"relative": 0.5}), json!(100), json!(200)), vec![within(path)]);
    assert_eq!(check(json!({"relative": 0.5}), json!(200), json!(100)), vec![within(path)]);
    assert_eq!(check(json!({"relative": 0.49}), json!(100), json!(200)), vec![beyond(path)]);
    // Zero: a relative bound of zero magnitude allows nothing.
    assert_eq!(check(json!({"relative": 10}), json!(0), json!(0)), vec![]);
    assert_eq!(check(json!({"relative": 1}), json!(0), json!(3)), vec![within(path)]);
    assert_eq!(check(json!({"relative": 0.99}), json!(0), json!(3)), vec![beyond(path)]);
    // Sign changes: the difference spans zero.
    assert_eq!(check(json!({"relative": 1}), json!(-1), json!(1)), vec![beyond(path)]);
    assert_eq!(check(json!({"relative": 2}), json!(-1), json!(1)), vec![within(path)]);
    assert_eq!(check(json!({"absolute": 2}), json!(-1), json!(1)), vec![within(path)]);
    // Any bound holds: the larger of absolute and relative.
    let both = json!({"absolute": 50, "relative": 0.2});
    assert_eq!(check(both.clone(), json!(10), json!(55)), vec![within(path)]);
    assert_eq!(check(both.clone(), json!(1000), json!(1200)), vec![within(path)]);
    assert_eq!(check(both.clone(), json!(1000), json!(1300)), vec![beyond(path)]);
    // Tolerances apply to numbers only.
    assert_eq!(check(both.clone(), json!("1"), json!("2")), vec![beyond(path)]);
    assert_eq!(check(both.clone(), json!(1), json!("1")), vec![beyond(path)]);
    assert_eq!(one(duration(both.clone()), json!({}), json!({"durationMs": 1})), vec![beyond(path)]);
    // Without a tolerance any difference of any value is expected.
    let any = json!({"path": "/data/durationMs"});
    assert_eq!(
        one(any.clone(), json!({"durationMs": {"a": 1}}), json!({"durationMs": [1]})),
        vec![within(path)]
    );
    assert_eq!(one(any.clone(), json!({"durationMs": 1}), json!({})), vec![within(path)]);
    assert_eq!(one(any, json!({}), json!({})), vec![]);
}

#[test]
fn spreads_bound_differences_by_the_runs_combined_spread() {
    let mean = |mean: f64, stdev: Value| json!({"meanMs": mean, "stdevMs": stdev});
    let declaration = json!({"path": "/data/meanMs", "tolerance": {"spread": "/data/stdevMs", "factor": 2}});
    let path = "/data/meanMs";
    // 2 × √(3² + 4²) = 10.
    assert_eq!(
        one(declaration.clone(), mean(100.0, json!(3)), mean(110.0, json!(4))),
        vec![within(path)]
    );
    assert_eq!(
        one(declaration.clone(), mean(100.0, json!(3)), mean(110.5, json!(4))),
        vec![beyond(path)]
    );
    // The factor defaults to one.
    let unit = json!({"path": "/data/meanMs", "tolerance": {"spread": "/data/stdevMs"}});
    assert_eq!(one(unit.clone(), mean(100.0, json!(3)), mean(105.0, json!(4))), vec![within(path)]);
    assert_eq!(one(unit, mean(100.0, json!(3)), mean(105.1, json!(4))), vec![beyond(path)]);
    // A spread missing on one side, or not a nonnegative number, can't hold.
    let missing = one(declaration.clone(), json!({"meanMs": 100}), mean(100.1, json!(4)));
    assert_eq!(missing.len(), 1);
    assert!(!missing[0].within);
    assert_eq!(
        missing[0].reason.as_deref(),
        Some("Spread /data/stdevMs is not a finite nonnegative number before")
    );
    let negative = one(declaration.clone(), mean(100.0, json!(3)), mean(100.1, json!(-4)));
    assert_eq!(
        negative[0].reason.as_deref(),
        Some("Spread /data/stdevMs is not a finite nonnegative number after")
    );
    let text = one(declaration, mean(100.0, json!("3")), mean(100.1, json!(4)));
    assert!(!text[0].within && text[0].reason.is_some());
    // With absolute too, any bound that holds is enough; the reason only
    // explains a difference beyond tolerance.
    let both = json!({"path": "/data/meanMs", "tolerance": {"absolute": 1, "spread": "/data/stdevMs", "factor": 2}});
    assert_eq!(
        one(both.clone(), json!({"meanMs": 100}), json!({"meanMs": 101})),
        vec![within(path)]
    );
    let unavailable = one(both.clone(), json!({"meanMs": 100}), json!({"meanMs": 102}));
    assert!(!unavailable[0].within && unavailable[0].reason.is_some());
    assert_eq!(one(both.clone(), mean(100.0, json!(3)), mean(109.0, json!(4))), vec![within(path)]);
    assert_eq!(one(both, mean(100.0, json!(0)), mean(102.0, json!(0))), vec![beyond(path)]);
    // A spread's * segments take the keys the path's matched.
    let benchmarks = json!({"path": "/data/benchmarks/*/meanMs", "tolerance": {"spread": "/data/benchmarks/*/stdevMs"}});
    assert_eq!(
        one(
            benchmarks,
            json!({"benchmarks": {"parse": mean(10.0, json!(1)), "load": mean(20.0, json!(0))}}),
            json!({"benchmarks": {"parse": mean(11.0, json!(1)), "load": mean(21.0, json!(0))}}),
        ),
        vec![beyond("/data/benchmarks/load/meanMs"), within("/data/benchmarks/parse/meanMs")]
    );
}

#[test]
fn wildcards_match_any_key_or_index() {
    let samples = json!({"path": "/data/samples/*/count"});
    assert_eq!(
        one(
            samples.clone(),
            json!({"samples": [{"count": 1}, {"count": 2}, {"count": 3}]}),
            json!({"samples": [{"count": 1}, {"count": 5}]}),
        ),
        vec![within("/data/samples/1/count"), within("/data/samples/2/count")]
    );
    assert_eq!(
        one(
            samples,
            json!({"samples": {"a": {"count": 1}, "b/c": {"count": 1}}}),
            json!({"samples": {"a": {"count": 1}, "b/c": {"count": 2}, "d~": {"count": 0}}}),
        ),
        vec![within("/data/samples/b~1c/count"), within("/data/samples/d~0/count")]
    );
    // Escaped keys address themselves; paths sort by UTF-16 code units.
    assert_eq!(
        one(
            json!({"path": "/data/*"}),
            json!({"\u{e000}": 1, "\u{1f600}": 1, "a/b": 1}),
            json!({"\u{e000}": 2, "\u{1f600}": 2, "a/b": 2}),
        ),
        vec![within("/data/a~1b"), within("/data/\u{1f600}"), within("/data/\u{e000}")]
    );
    // Array indexes are canonical: no leading zeros.
    assert_eq!(
        one(json!({"path": "/data/list/01"}), json!({"list": [1, 2]}), json!({"list": [3, 4]})),
        vec![]
    );
}

#[test]
fn kinds_and_collections_select_items() {
    let declarations = declarations_of(
        &normalized(json!([]), json!([{"path": "/data/x", "kinds": ["test"]}])),
        &normalized(json!([]), json!([{"path": "/data/y", "collection": "relationships"}])),
    );
    let a = json!({"id": "a", "kind": "suite", "label": "", "data": {"x": 1, "y": 1}});
    let b = json!({"id": "a", "kind": "suite", "label": "", "data": {"x": 2, "y": 2}});
    assert_eq!(varied_between(&declarations, "entities", &a, &b), vec![]);
    assert_eq!(varied_between(&declarations, "relationships", &a, &b), vec![within("/data/y")]);
    let a = item(json!({"x": 1}));
    let b = item(json!({"x": 2}));
    assert_eq!(varied_between(&declarations, "entities", &a, &b), vec![within("/data/x")]);
}

#[test]
fn the_tighter_tolerance_of_both_sides_wins() {
    let path = "/data/durationMs";
    let data = |value: f64| json!({"durationMs": value});
    let check = |before: Value, after: Value, value: f64| varied(json!([before]), json!([after]), data(0.0), data(value));
    // The smaller absolute bound.
    assert_eq!(
        check(duration(json!({"absolute": 10})), duration(json!({"absolute": 5})), 7.0),
        vec![beyond(path)]
    );
    assert_eq!(
        check(duration(json!({"absolute": 5})), duration(json!({"absolute": 10})), 7.0),
        vec![beyond(path)]
    );
    assert_eq!(
        check(duration(json!({"absolute": 5})), duration(json!({"absolute": 10})), 5.0),
        vec![within(path)]
    );
    // No tolerance is the loosest: the other side's applies.
    assert_eq!(
        check(json!({"path": path}), duration(json!({"absolute": 5})), 7.0),
        vec![beyond(path)]
    );
    assert_eq!(
        check(duration(json!({"absolute": 5})), json!({"path": path}), 7.0),
        vec![beyond(path)]
    );
    // Declared by one side only, the path is still volatile.
    assert_eq!(
        varied(json!([]), json!([duration(json!({"absolute": 10}))]), data(0.0), data(7.0)),
        vec![within(path)]
    );
    // A bound only one side declares doesn't apply.
    assert_eq!(
        check(
            duration(json!({"absolute": 50})),
            duration(json!({"absolute": 50, "relative": 10})),
            60.0
        ),
        vec![beyond(path)]
    );
    assert_eq!(
        check(duration(json!({"absolute": 50})), duration(json!({"relative": 10})), 1.0),
        vec![beyond(path)]
    );
    // Within one side, overlapping declarations combine the same way.
    assert_eq!(
        varied(
            json!([{"path": "/data/*"}, duration(json!({"absolute": 1}))]),
            json!([]),
            data(0.0),
            data(2.0)
        ),
        vec![beyond(path)]
    );
    // Spreads: the smaller factor of the same spread; different spreads must both hold, whichever side declared which.
    let spread = |path: &str, factor: f64| json!({"path": "/data/meanMs", "tolerance": {"spread": path, "factor": factor}});
    let runs = |mean: f64| json!({"meanMs": mean, "a": 1, "b": 10});
    let check = |before: Value, after: Value, mean: f64| varied(json!([before]), json!([after]), runs(0.0), runs(mean));
    // √2 × factor for spread a, 10√2 × factor for spread b.
    assert!(check(spread("/data/a", 1.0), spread("/data/a", 3.0), 1.0)[0].within);
    assert!(!check(spread("/data/a", 1.0), spread("/data/a", 3.0), 3.0)[0].within);
    assert!(!check(spread("/data/a", 3.0), spread("/data/a", 1.0), 3.0)[0].within);
    assert!(!check(spread("/data/a", 1.0), spread("/data/b", 1.0), 14.0)[0].within);
    assert!(!check(spread("/data/b", 1.0), spread("/data/a", 1.0), 14.0)[0].within);
    assert!(check(spread("/data/a", 1.0), spread("/data/b", 1.0), 1.0)[0].within);
    assert!(check(spread("/data/b", 1.0), spread("/data/a", 1.0), 1.0)[0].within);
}

#[test]
fn content_is_compared_modulo_variation_within_tolerance() {
    let declarations = declarations_of(
        &normalized(json!([]), json!([duration(json!({"absolute": 50}))])),
        &normalized(json!([]), json!([duration(json!({"absolute": 50}))])),
    );
    let run = |duration: i64, status: &str| item(json!({"durationMs": duration, "status": status}));
    let assess = |a: Value, b: Value| assessed(&declarations, &a, &b);
    let same = assess(run(100, "passed"), run(100, "passed"));
    assert!(same.unchanged() && same.varied.is_empty() && same.residual.is_empty());
    let jitter = assess(run(100, "passed"), run(140, "passed"));
    assert!(jitter.unchanged());
    assert_eq!(jitter.varied, vec![within("/data/durationMs")]);
    let slower = assess(run(100, "passed"), run(200, "passed"));
    assert!(!slower.unchanged());
    assert_eq!(slower.varied, vec![beyond("/data/durationMs")]);
    assert!(slower.residual.is_empty());
    let failed = assess(run(100, "passed"), run(100, "failed"));
    assert!(!failed.unchanged());
    assert_eq!(failed.residual, vec!["/data/status"]);
    let relabelled = assess(run(100, "passed"), {
        let mut item = run(120, "passed");
        item["label"] = json!("renamed");
        item
    });
    assert!(!relabelled.unchanged());
    assert_eq!(relabelled.varied, vec![within("/data/durationMs")]);
    assert_eq!(relabelled.residual, vec!["/label"]);
    // Structure around a volatile value is not volatile.
    let declarations = declarations_of(
        &normalized(json!([]), json!([{"path": "/data/samples/*/count"}])),
        &normalized(json!([]), json!([])),
    );
    let grown = assessed(
        &declarations,
        &item(json!({"samples": [{"count": 1}]})),
        &item(json!({"samples": [{"count": 1}, {"count": 2}]})),
    );
    assert!(!grown.unchanged());
    assert_eq!(grown.residual, vec!["/data/samples"]);
    let counted = assessed(
        &declarations,
        &item(json!({"samples": [{"count": 1, "name": "a"}]})),
        &item(json!({"samples": [{"count": 9, "name": "a"}]})),
    );
    assert!(counted.unchanged());
}

fn results(duration: i64, status: &str) -> Value {
    normalized(
        json!([
            test("t:a", json!({"durationMs": duration, "status": status})),
            test("t:b", json!({"durationMs": 1}))
        ]),
        json!([{"kinds": ["test"], "path": "/data/durationMs", "tolerance": {"absolute": 50}}]),
    )
}

fn validate_code(before: &Value, after: &Value, comparison: Value) -> Option<(String, String)> {
    validate_comparison(before, after, &comparison)
        .err()
        .map(|failure| (failure[0].code.clone(), failure[0].path.clone()))
}

fn pair(status: &str, varied: Value) -> Value {
    json!({"id": "t:a", "collection": "entities", "before": ["t:a"], "after": ["t:a"],
        "status": status, "correspondence": "exact", "varied": varied})
}

#[test]
fn comparisons_list_variation_and_keep_it_out_of_steps() {
    let before = results(100, "passed");
    let jitter = results(130, "passed");
    let noise = pair("unchanged", json!([{"path": "/data/durationMs", "within": true}]));
    let valid = json!({"protocolVersion": 0, "changes": [noise.clone()], "steps": [],
        "variation": {"within": 1, "beyond": 0}});
    assert_eq!(validate_code(&before, &jitter, valid.clone()), None);
    // Hiding variation within tolerance is hiding a change.
    assert_eq!(
        validate_code(&before, &jitter, json!({"protocolVersion": 0, "changes": [], "steps": []})),
        Some(("hidden-change".to_owned(), "/comparison/changes".to_owned()))
    );
    // A wrong judgement, a missing or extra path, or a missing varied.
    for varied in [
        json!([{"path": "/data/durationMs", "within": false}]),
        json!([{"path": "/data/durationMs", "within": true, "reason": "x"}]),
        json!([{"path": "/data/status", "within": true}]),
        json!([{"path": "/data/durationMs", "within": true}, {"path": "/data/status", "within": true}]),
    ] {
        let mut comparison = valid.clone();
        comparison["changes"][0]["varied"] = varied;
        assert_eq!(validate_code(&before, &jitter, comparison).unwrap().0, "inconsistent-variation");
    }
    let mut comparison = valid.clone();
    comparison["changes"][0].as_object_mut().unwrap().remove("varied");
    comparison.as_object_mut().unwrap().remove("variation");
    comparison["steps"] = json!([{"changes": ["t:a"]}]);
    assert_eq!(
        validate_code(&before, &jitter, comparison),
        Some(("inconsistent-variation".to_owned(), "/comparison/changes/0/varied".to_owned()))
    );
    // Within-only differences are unchanged, not modified.
    let mut comparison = valid.clone();
    comparison["changes"][0]["status"] = json!("modified");
    comparison["steps"] = json!([{"changes": ["t:a"]}]);
    comparison["variation"] = json!({"within": 0, "beyond": 0});
    assert_eq!(validate_code(&before, &jitter, comparison).unwrap().0, "inconsistent-status");
    // Expected variation belongs to no step.
    let mut comparison = valid.clone();
    comparison["steps"] = json!([{"changes": ["t:a"]}]);
    assert_eq!(
        validate_code(&before, &jitter, comparison),
        Some(("variation-in-step".to_owned(), "/comparison/steps/0/changes/0".to_owned()))
    );
    let mut comparison = valid.clone();
    comparison["order"] = json!({"reverse": "explicit"});
    comparison["reverseSteps"] = json!([{"changes": ["t:a"]}]);
    assert_eq!(validate_code(&before, &jitter, comparison).unwrap().0, "variation-in-step");
    // The variation summary is required, exact, and only present with varied.
    let mut comparison = valid.clone();
    comparison.as_object_mut().unwrap().remove("variation");
    assert_eq!(validate_code(&before, &jitter, comparison).unwrap().0, "missing-variation");
    for counts in [
        json!({"within": 0, "beyond": 0}),
        json!({"within": 1, "beyond": 1}),
        json!({"within": 1}),
    ] {
        let mut comparison = valid.clone();
        comparison["variation"] = counts;
        assert_eq!(validate_code(&before, &jitter, comparison).unwrap().0, "inconsistent-variation");
    }
    let mut comparison = valid.clone();
    comparison["variation"]["other"] = json!(0);
    assert_eq!(validate_code(&before, &jitter, comparison).unwrap().0, "unknown-field");
    assert_eq!(
        validate_code(
            &before,
            &before,
            json!({"protocolVersion": 0, "changes": [], "steps": [], "variation": {"within": 0, "beyond": 0}})
        )
        .unwrap()
        .0,
        "unexpected-variation"
    );
    // Malformed varied.
    for (varied, code) in [
        (json!([]), "invalid-type"),
        (json!({}), "invalid-type"),
        (json!([{"path": "/data/durationMs"}]), "invalid-type"),
        (json!([{"path": "/data/durationMs", "within": true, "other": 1}]), "unknown-field"),
        (
            json!([{"path": "/data/x", "within": true}, {"path": "/data/durationMs", "within": true}]),
            "invalid-varied",
        ),
        (
            json!([{"path": "/data/x", "within": true}, {"path": "/data/x", "within": true}]),
            "invalid-varied",
        ),
    ] {
        let mut comparison = valid.clone();
        comparison["changes"][0]["varied"] = varied;
        assert_eq!(validate_code(&before, &jitter, comparison).unwrap().0, code);
    }
}

#[test]
fn modified_changes_carry_variation_beyond_tolerance() {
    let before = results(100, "passed");
    let slower = results(300, "passed");
    let beyond = pair("modified", json!([{"path": "/data/durationMs", "within": false}]));
    assert_eq!(
        validate_code(
            &before,
            &slower,
            json!({"protocolVersion": 0, "changes": [beyond.clone()], "steps": [{"changes": ["t:a"]}],
                "variation": {"within": 0, "beyond": 1}})
        ),
        None
    );
    // Steps still hold every modified change.
    assert_eq!(
        validate_code(
            &before,
            &slower,
            json!({"protocolVersion": 0, "changes": [beyond], "steps": [],
                "variation": {"within": 0, "beyond": 1}})
        )
        .unwrap()
        .0,
        "step-coverage"
    );
    // A status change is modified, with variation within beside it.
    let failed = results(120, "failed");
    let modified = pair("modified", json!([{"path": "/data/durationMs", "within": true}]));
    assert_eq!(
        validate_code(
            &before,
            &failed,
            json!({"protocolVersion": 0, "changes": [modified], "steps": [{"changes": ["t:a"]}],
                "variation": {"within": 0, "beyond": 0}})
        ),
        None
    );
}

#[test]
fn renames_and_splits_and_merges() {
    let declared = |id: &str, previous: &[&str], duration: i64| {
        let mut entity = test(id, json!({"durationMs": duration}));
        entity["label"] = json!("test");
        if !previous.is_empty() {
            entity["previousIds"] = json!(previous);
        }
        entity
    };
    let volatile = json!([{"path": "/data/durationMs"}]);
    let before = normalized(json!([declared("t:a", &[], 1), declared("t:b", &[], 1)]), volatile.clone());
    let renamed = normalized(json!([declared("t:c", &["t:a"], 2), declared("t:b", &[], 1)]), volatile.clone());
    // A rename with variation within is an unchanged declared change, in a step.
    let rename = json!({"id": "t:c", "collection": "entities", "before": ["t:a"], "after": ["t:c"],
        "status": "unchanged", "correspondence": "declared",
        "varied": [{"path": "/data/durationMs", "within": true}]});
    assert_eq!(
        validate_code(
            &before,
            &renamed,
            json!({"protocolVersion": 0, "changes": [rename], "steps": [{"changes": ["t:c"]}],
                "variation": {"within": 1, "beyond": 0}})
        ),
        None
    );
    // Splits and merges have no varied.
    let split = normalized(
        json!([declared("t:c", &["t:a"], 2), declared("t:d", &["t:a"], 2), declared("t:b", &[], 1)]),
        volatile,
    );
    let change = json!({"id": "t:c", "collection": "entities", "before": ["t:a"], "after": ["t:c", "t:d"],
        "status": "modified", "correspondence": "split",
        "varied": [{"path": "/data/durationMs", "within": true}]});
    assert_eq!(
        validate_code(
            &before,
            &split,
            json!({"protocolVersion": 0, "changes": [change], "steps": [{"changes": ["t:c"]}],
                "variation": {"within": 0, "beyond": 0}})
        ),
        Some(("unexpected-varied".to_owned(), "/comparison/changes/0/varied".to_owned()))
    );
    let merge = json!({"id": "t:a", "collection": "entities", "before": ["t:c", "t:d"], "after": ["t:a"],
        "status": "modified", "correspondence": "merge",
        "varied": [{"path": "/data/durationMs", "within": true}]});
    assert_eq!(
        validate_code(
            &split,
            &before,
            json!({"protocolVersion": 0, "changes": [merge], "steps": [{"changes": ["t:a"]}]})
        )
        .unwrap()
        .0,
        "unexpected-varied"
    );
}

#[test]
fn reruns_are_reproducible_when_nothing_varies_beyond_tolerance() {
    let first = results(100, "passed");
    let same = vary(&first, &first).unwrap();
    assert!(same.equal && same.reproducible() && same.within.is_empty());
    let jitter = vary(&first, &results(130, "passed")).unwrap();
    assert!(!jitter.equal && jitter.reproducible());
    assert_eq!(
        jitter.to_json(),
        json!({"equal": false, "within": [{"collection": "entities", "id": "t:a", "path": "/data/durationMs"}], "beyond": []})
    );
    let mut flaky = results(300, "failed");
    flaky["entities"][1]["label"] = json!("B");
    flaky["entities"].as_array_mut().unwrap().push(test("t:c", json!({})));
    let mut fewer = first.clone();
    fewer["entities"].as_array_mut().unwrap().push(test("t:0", json!({})));
    let result = vary(&fewer, &flaky).unwrap();
    assert!(!result.reproducible());
    assert_eq!(
        result.to_json()["beyond"],
        json!([
            {"collection": "entities", "id": "t:0", "path": "", "reason": "Only in the first run"},
            {"collection": "entities", "id": "t:a", "path": "/data/durationMs", "reason": "Beyond the declared tolerance"},
            {"collection": "entities", "id": "t:a", "path": "/data/status", "reason": "Not declared volatile"},
            {"collection": "entities", "id": "t:b", "path": "/label", "reason": "Not declared volatile"},
            {"collection": "entities", "id": "t:c", "path": "", "reason": "Only in the second run"},
        ])
    );
    // Different declarations or schemas are differences of their own.
    let undeclared = normalized(
        json!([
            test("t:a", json!({"durationMs": 100, "status": "passed"})),
            test("t:b", json!({"durationMs": 1}))
        ]),
        json!([]),
    );
    let result = vary(&first, &undeclared).unwrap();
    assert_eq!(
        result.to_json()["beyond"],
        json!([{"path": "/volatile", "reason": "The runs' volatile differ"}])
    );
    let mut other = first.clone();
    other["schema"] = json!("dag/v0");
    assert_eq!(vary(&first, &other).unwrap().beyond[0].path, "/schema");
    // Inputs are validated.
    let failure = vary(&json!({}), &first).unwrap_err();
    assert_eq!(failure[0].path, "/before/protocolVersion");
}

#[test]
fn the_request_api_varies_extractions() {
    let request = json!({"version": 0, "operation": "vary", "before": results(100, "passed"), "after": results(140, "passed")});
    let response = projections_engine::handle(serde_json::to_string(&request).unwrap().as_bytes());
    assert_eq!(response["ok"], true);
    assert_eq!(response["result"]["within"][0]["path"], "/data/durationMs");
    let request = json!({"version": 0, "operation": "vary", "before": results(100, "passed"), "after": results(140, "passed"), "extra": 1});
    let response = projections_engine::handle(serde_json::to_string(&request).unwrap().as_bytes());
    assert_eq!(response["diagnostics"][0]["code"], "unknown-field");
}
