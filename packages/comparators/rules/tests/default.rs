//! The default comparator as rules (`rules/default-order.yaml`) against the native
//! default comparator: the shared conformance corpus, every fixture pair in
//! the repository in both directions with each order option, the sequencer's
//! shape fixtures, invalid options, and seeded random graphs with renames,
//! splits, merges and ambiguous claims.

mod common;

use common::{Random, Report, corpus, random_pair, read, root};
use projections_comparator_rules::Comparator;
use serde_json::{Value, json};

fn run(rules: &Comparator, report: &mut Report, case: &str, before: &Value, after: &Value, options: &Value) {
    let code = |failure: projections_engine::Failure| failure[0].code.clone();
    let expected = projections_comparator_default::compare(before, after, options).map_err(code);
    let actual = rules.compare(before, after, options).map_err(code);
    report.record(case, expected, actual);
}

fn numeric_keys(extraction: &Value) -> Vec<String> {
    let mut keys: Vec<String> = extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|entity| entity["data"].as_object().into_iter().flatten())
        .filter(|(_, value)| value.is_number())
        .map(|(key, _)| key.clone())
        .collect();
    keys.sort();
    keys.dedup();
    keys.truncate(2);
    keys
}

fn star(ids: &[String]) -> Value {
    let entity = |id: &str| json!({"id": id, "kind": "package", "label": id});
    let mut entities = vec![entity("root"), entity("keep")];
    let mut relationships = vec![json!({"id": "edge:keep", "kind": "dependency", "from": "root", "to": "keep"})];
    for id in ids {
        entities.push(entity(id));
        relationships.push(json!({"id": format!("edge:{id}"), "kind": "dependency", "from": "root", "to": id}));
    }
    json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": relationships})
}

fn layered(ids: &[String]) -> Value {
    let spine = ["root", "a", "b", "c", "d", "e"];
    let entity = |id: &str| json!({"id": id, "kind": "package", "label": id});
    let mut entities: Vec<_> = spine.iter().map(|id| entity(id)).collect();
    let mut relationships: Vec<_> = spine
        .windows(2)
        .map(|pair| json!({"id": format!("edge:{}", pair[1]), "kind": "dependency", "from": pair[0], "to": pair[1]}))
        .collect();
    for (index, id) in ids.iter().enumerate() {
        entities.push(entity(id));
        relationships.push(json!({"id": format!("edge:{id}"), "kind": "dependency", "from": spine[index % spine.len()], "to": id}));
    }
    json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": relationships})
}

#[test]
fn default_rules_match_the_native_default() {
    // The order rules nest functions deeply; unoptimized builds need more
    // than a test thread's default stack.
    common::with_stack(default_rules_match_the_native_default_);
}

fn default_rules_match_the_native_default_() {
    let rules = common::comparator("default-order");
    let mut report = Report::new("default");

    let conformance = read(&root().join("packages/schemas/fixtures/conformance.json"));
    for case in conformance["comparisons"].as_array().unwrap() {
        let options = case.get("options").cloned().unwrap_or_else(|| json!({}));
        run(
            &rules,
            &mut report,
            case["id"].as_str().unwrap(),
            &case["before"],
            &case["after"],
            &options,
        );
    }

    for (name, before, after) in corpus() {
        let mut options = vec![
            json!({}),
            json!({"order": {"by": "dependents"}}),
            json!({"order": {"by": "dependents", "direction": "ascending"}}),
        ];
        for key in numeric_keys(&before).into_iter().chain(numeric_keys(&after)) {
            options.push(json!({"order": {"by": format!("data.{key}")}}));
            options.push(json!({"order": {"by": format!("data.{key}"), "direction": "ascending"}}));
        }
        for options in &options {
            run(&rules, &mut report, &format!("{name} {options}"), &before, &after, options);
            run(&rules, &mut report, &format!("{name} reversed {options}"), &after, &before, options);
        }
    }

    let shapes = [
        (0, 0),
        (1, 1),
        (5, 0),
        (0, 5),
        (3, 3),
        (5, 5),
        (4, 2),
        (3, 7),
        (7, 7),
        (13, 4),
        (10, 10),
        (31, 17),
    ];
    let names = |prefix: &str, count: usize| -> Vec<String> { (0..count).map(|n| format!("{prefix}{n}")).collect() };
    for (shape, build) in [("peers", star as fn(&[String]) -> Value), ("layers", layered)] {
        for (removed, added) in shapes {
            let (before, after) = (build(&names("old", removed)), build(&names("new", added)));
            run(
                &rules,
                &mut report,
                &format!("{shape} {removed}/{added}"),
                &before,
                &after,
                &json!({}),
            );
        }
    }

    let empty = json!({"protocolVersion": 0, "schema": "graph/v0", "entities": [], "relationships": []});
    for options in [
        json!([]),
        json!({"sort": 1}),
        json!({"order": 1}),
        json!({"order": {"by": "dependents", "extra": true}}),
        json!({"order": {"by": "data."}}),
        json!({"order": {"by": "size"}}),
        json!({"order": {}}),
        json!({"order": {"by": "dependents", "direction": "up"}}),
        json!({"order": {"by": "dependents", "direction": null}}),
        json!({"zeta": 1, "alpha": 2}),
    ] {
        run(&rules, &mut report, &format!("options {options}"), &empty, &empty, &options);
    }

    let mut random = Random::new(7);
    for case in 0..common::cases(1500) {
        let (before, after) = random_pair(&mut random);
        let options = match case % 4 {
            0 => json!({}),
            1 => json!({"order": {"by": "dependents"}}),
            2 => json!({"order": {"by": "data.weight"}}),
            _ => json!({"order": {"by": "data.weight", "direction": "ascending"}}),
        };
        run(
            &rules,
            &mut report,
            &format!("random {case} {options} {before} {after}"),
            &before,
            &after,
            &options,
        );
    }

    // Volatile data: the same random graphs with their weights declared
    // volatile, with and without tolerances, on either or both sides.
    let declarations = [
        json!([{"path": "/data/weight"}]),
        json!([{"path": "/data/weight", "tolerance": {"absolute": 1}}]),
        json!([{"path": "/data/*", "tolerance": {"relative": 0.5}}, {"collection": "relationships", "path": "/data/weight"}]),
        json!([{"collection": "relationships", "path": "/data/weight", "tolerance": {"absolute": 2}}]),
    ];
    let mut random = Random::new(11);
    let mut seen = [0, 0];
    let results = |durations: [i64; 4], samples: i64, renamed: &str| {
        let test = |id: &str, duration: i64, status: &str| json!({"id": id, "kind": "test", "label": "test", "data": {"durationMs": duration, "status": status}});
        let mut renamed_test = test(renamed, durations[3], "passed");
        if renamed != "test:e" {
            renamed_test["previousIds"] = json!(["test:e"]);
        }
        json!({
            "protocolVersion": 0,
            "schema": "graph/v0",
            "entities": [
                {"id": "suite", "kind": "suite", "label": "Suite"},
                test("test:a", durations[0], "passed"),
                test("test:b", durations[1], "passed"),
                test("test:c", durations[2], if samples > 3 { "failed" } else { "passed" }),
                renamed_test,
            ],
            "relationships": [
                {"id": "suite-a", "kind": "contains", "from": "suite", "to": "test:a",
                    "data": {"samples": [{"count": samples}]}},
                {"id": "suite-c", "kind": "contains", "from": "suite", "to": "test:c"},
            ],
            "volatile": [
                {"kinds": ["test"], "path": "/data/durationMs", "tolerance": {"absolute": 50, "relative": 0.2}},
                {"collection": "relationships", "path": "/data/samples/*/count"},
            ],
        })
    };
    let fixtures = [
        results([100, 100, 100, 10], 3, "test:e"),
        results([130, 400, 120, 20], 5, "test:f"),
        results([90, 100, 100, 10], 4, "test:e"),
    ];
    let mut pairs = Vec::new();
    for before in &fixtures {
        for after in &fixtures {
            pairs.push((before.clone(), after.clone()));
        }
    }
    for case in 0..common::cases(400) {
        let (mut before, mut after) = match pairs.pop() {
            Some(pair) => pair,
            None => random_pair(&mut random),
        };
        let index = case % declarations.len();
        if before.get("volatile").is_none() {
            before["volatile"] = declarations[index].clone();
            if case % 3 != 0 {
                after["volatile"] = declarations[(index + case / 4) % declarations.len()].clone();
            }
        }
        let options = match case % 3 {
            0 => json!({}),
            1 => json!({"order": {"by": "dependents"}}),
            _ => json!({"order": {"by": "data.weight"}}),
        };
        if let Ok(comparison) = projections_comparator_default::compare(&before, &after, &options) {
            if let Some(variation) = comparison.get("variation") {
                seen[0] += variation["within"].as_u64().unwrap();
                seen[1] += variation["beyond"].as_u64().unwrap();
            }
        }
        run(
            &rules,
            &mut report,
            &format!("volatile {case} {options} {before} {after}"),
            &before,
            &after,
            &options,
        );
    }
    assert!(
        seen[0] > 0 && seen[1] > 0,
        "volatile cases vary within and beyond tolerance: {seen:?}"
    );
    report.finish();
}
