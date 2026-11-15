//! The API compatibility rules. They replaced a Rust comparator, compiled to
//! a WebAssembly module and deleted with the module comparator kind; its
//! comparisons of the api renderer's real extractions for every ecosystem in
//! both directions, with every `options.ecosystem`, mixed and undeclared
//! ecosystems, are recorded in `golden/api-compatibility.json`, and its unit
//! tests are the modules below, unchanged but for running the rules and for
//! their contract facts, rewritten when the facts were normalized (the golden
//! inputs were converted then: see `golden_migration` and `api/convert.rs`).
//! Seeded mutations of the extractions' contract facts (their native and
//! signature facts too), entities and identities, which had the original as
//! their reference, now check that the rules run.

mod common;
#[path = "api/convert.rs"]
mod convert;
#[path = "api/dotnet.rs"]
mod dotnet;
#[path = "api/general.rs"]
mod general;
#[path = "api/go.rs"]
mod go;
#[path = "api/rust.rs"]
mod rust;
#[path = "api/shared.rs"]
mod shared;
#[path = "api/testing.rs"]
mod testing;
#[path = "api/typescript.rs"]
mod typescript;

use common::{Golden, Random, golden_path, input_digest, read, root, runs, semantic};
use projections_comparator_rules::Comparator;
use projections_engine::normalize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn declarative(comparator: &Comparator, before: &Value, after: &Value, options: &Value) -> Result<Value, String> {
    if normalize(before, "/before").is_err() || normalize(after, "/after").is_err() {
        return Err("input".into());
    }
    if projections_comparator_default::compare(before, after, &json!({})).is_err() {
        return Err("input".into());
    }
    comparator
        .compare(before, after, options)
        .map_err(|failure| match failure[0].code.as_str() {
            "invalid-options" | "rules-evaluation" => format!("comparator-error: {}", failure[0]),
            code => code.to_owned(),
        })
}

pub const ECOSYSTEMS: [&str; 4] = ["dotnet", "typescript", "rust", "go"];

fn fixture(ecosystem: &str, side: &str) -> Value {
    read(&root().join(format!("packages/renderers/api/fixtures/{ecosystem}-{side}.json")))
}

/// Contract fact values seen per (entity kind, fact): a contract fact by its
/// name, a native one as `native.<name>`, one of the first signature's as
/// `signature.<name>`.
type Pools = BTreeMap<(String, String), Vec<Value>>;

fn pools(extractions: &[&Value]) -> Pools {
    let mut pools = Pools::new();
    let mut add = |kind: &str, key: String, value: &Value| {
        let pool = pools.entry((kind.to_owned(), key)).or_default();
        if !pool.contains(value) {
            pool.push(value.clone());
        }
    };
    for extraction in extractions {
        for entity in extraction["entities"].as_array().unwrap() {
            let kind = entity["kind"].as_str().unwrap();
            let contract = &entity["data"]["contract"];
            for (key, value) in contract.as_object().into_iter().flatten() {
                add(kind, key.clone(), value);
            }
            for (key, value) in contract["native"].as_object().into_iter().flatten() {
                add(kind, format!("native.{key}"), value);
            }
            for (key, value) in contract["signatures"][0].as_object().into_iter().flatten() {
                add(kind, format!("signature.{key}"), value);
            }
        }
    }
    pools
}

fn mutate(random: &mut Random, extraction: &Value, pools: &Pools, other: &Value) -> Value {
    let mut extraction = extraction.clone();
    for _ in 0..1 + random.below(3) {
        let count = extraction["entities"].as_array().unwrap().len();
        if count == 0 {
            break;
        }
        let index = random.below(count);
        match random.below(12) {
            0 => {
                // Remove an entity and its relationships.
                let id = extraction["entities"][index]["id"].clone();
                extraction["entities"].as_array_mut().unwrap().remove(index);
                extraction["relationships"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|r| r["from"] != id && r["to"] != id);
            }
            1 => {
                // Rename: a new ID claiming the old one, sometimes with a new label.
                let entity = &mut extraction["entities"][index];
                let old = entity["id"].as_str().unwrap().to_owned();
                let new = format!("{old}Renamed");
                entity["id"] = json!(new);
                entity["previousIds"] = json!([old]);
                if random.chance(50) {
                    entity["label"] = json!(format!("{}2", entity["label"].as_str().unwrap_or("x")));
                }
                for relationship in extraction["relationships"].as_array_mut().unwrap() {
                    for end in ["from", "to"] {
                        if relationship[end] == old {
                            relationship[end] = json!(new);
                        }
                    }
                }
            }
            2 => {
                // Drop the contract facts.
                if let Some(data) = extraction["entities"][index]["data"].as_object_mut() {
                    data.remove("contract");
                }
            }
            3 => {
                // Take the other revision's version of an entity.
                let id = extraction["entities"][index]["id"].clone();
                if let Some(entity) = other["entities"].as_array().unwrap().iter().find(|e| e["id"] == id) {
                    extraction["entities"][index] = entity.clone();
                }
            }
            4 => {
                // Change the signature only.
                let entity = &mut extraction["entities"][index];
                if entity["data"].is_object() {
                    entity["data"]["signature"] = json!(format!("{} ", entity["data"]["signature"].as_str().unwrap_or("")));
                }
            }
            _ => {
                let entity = &mut extraction["entities"][index];
                let kind = entity["kind"].as_str().unwrap().to_owned();
                let keys: Vec<&(String, String)> = pools.keys().filter(|(k, _)| *k == kind).collect();
                if keys.is_empty() || !entity["data"]["contract"].is_object() {
                    continue;
                }
                let key = (*random.pick(&keys)).clone();
                let value = random.pick(&pools[&key]).clone();
                let contract = &mut entity["data"]["contract"];
                if let Some(name) = key.1.strip_prefix("native.") {
                    if !contract["native"].is_object() {
                        contract["native"] = json!({});
                    }
                    contract["native"][name] = value;
                } else if let Some(name) = key.1.strip_prefix("signature.") {
                    if contract["signatures"][0].is_object() {
                        contract["signatures"][0][name] = value;
                    }
                } else {
                    contract[key.1.as_str()] = value;
                }
            }
        }
    }
    extraction
}

type Case = (String, Value, Value, Value);

/// The fixed cases of one ecosystem's renderer fixtures: every option in both
/// directions, undeclared and unknown ecosystems, and the fixtures compared
/// with each other ecosystem's.
fn fixed_cases(ecosystem: &str, only: Option<&str>, fixture: &dyn Fn(&str, &str) -> Value) -> Vec<Case> {
    let mut cases = Vec::new();
    let (before, after) = (fixture(ecosystem, "before"), fixture(ecosystem, "after"));
    for options in [
        json!({}),
        json!({"ecosystem": null}),
        json!({"ecosystem": "cobol"}),
        json!({"extra": 1}),
        json!({"ecosystem": 1}),
    ]
    .into_iter()
    .chain(
        ECOSYSTEMS
            .iter()
            .filter(|e| only.is_none_or(|only| only == **e))
            .map(|e| json!({"ecosystem": e})),
    ) {
        cases.push((format!("{ecosystem} {options}"), before.clone(), after.clone(), options.clone()));
        cases.push((format!("{ecosystem} reversed {options}"), after.clone(), before.clone(), options));
    }
    let mut undeclared = (before.clone(), after.clone());
    undeclared.0["metadata"] = json!({});
    undeclared.1["metadata"] = json!({});
    cases.push((
        format!("{ecosystem} undeclared"),
        undeclared.0.clone(),
        undeclared.1.clone(),
        json!({}),
    ));
    let mut unknown = undeclared.clone();
    unknown.1["metadata"] = json!({"ecosystem": "cobol"});
    cases.push((format!("{ecosystem} unknown"), unknown.0, unknown.1, json!({})));
    for other in ECOSYSTEMS {
        if other != ecosystem {
            cases.push((format!("{ecosystem} → {other}"), before.clone(), fixture(other, "after"), json!({})));
        }
    }
    cases
}

#[test]
fn api_compatibility() {
    common::with_stack(api_compatibility_);
}

fn api_compatibility_() {
    // `API_ECOSYSTEM=go` checks one ecosystem's fixtures and mutations.
    let only = std::env::var("API_ECOSYSTEM").ok();
    let comparator = common::comparator("api-compatibility");
    let mut golden = Golden::open("api-compatibility");
    let mut cases: Vec<Case> = Vec::new();
    let ecosystems: Vec<&str> = ECOSYSTEMS
        .iter()
        .copied()
        .filter(|e| only.as_deref().is_none_or(|only| only == *e))
        .collect();
    let mut random = Random::new(13);
    for ecosystem in &ecosystems {
        let (before, after) = (fixture(ecosystem, "before"), fixture(ecosystem, "after"));
        cases.extend(fixed_cases(ecosystem, only.as_deref(), &fixture));
        let pools = pools(&[&before, &after]);
        let mutations = std::env::var("API_MUTATIONS")
            .ok()
            .and_then(|n| n.parse().ok())
            .unwrap_or(common::cases(400));
        for case in 0..mutations {
            let old = if random.chance(30) {
                mutate(&mut random, &before, &pools, &after)
            } else {
                before.clone()
            };
            let source = if random.chance(50) { &after } else { &before };
            let new = mutate(&mut random, source, &pools, &before);
            cases.push((format!("{ecosystem} mutation {case} {new}"), old, new, json!({})));
        }
    }
    let graph = json!({"protocolVersion": 0, "schema": "graph/v0", "entities": [], "relationships": []});
    cases.push(("graph".into(), graph.clone(), graph, json!({})));
    for (name, before, after, options) in &cases {
        let actual = declarative(&comparator, before, after, options);
        if name.contains(" mutation ") {
            runs(name, &actual);
        } else {
            golden.check(name, before, after, options, actual);
        }
    }
    golden.finish();
}

/// The commit whose renderer fixtures carry the contract facts the golden
/// comparisons were recorded over, before the facts were normalized.
const LANGUAGE_SHAPED_FIXTURES: &str = "18a5be2a";

/// The commit whose renderer fixtures the golden cases were last re-keyed
/// over: the normalized facts before every contract stated its `visibility`
/// and every parameter its `passing`.
const REKEYED_FIXTURES: &str = "b7819d74";

/// One-off migration of `golden/api-compatibility.json` to the normalized
/// contract facts: rebuilds every fixed case from the fixtures the original
/// comparator saw (from Git), requires its recorded input digest, converts the
/// fixtures (`convert.rs`), requires the rules' comparison of the converted
/// case to equal the recorded one, and re-keys the case to its new input (a
/// case already re-keyed, over the fixtures at `REKEYED_FIXTURES` or the
/// converted ones, is checked again). It also compares the converted
/// fixtures with the fixtures the extractors now write. `target/rules-equivalence/api-migration.json` reports the result;
/// `API_GOLDEN_ACCEPT=1` re-records the cases that differ (each needs approval).
///
/// `cargo test -p projections-comparator-rules --test api golden_migration -- --ignored`
#[test]
#[ignore = "one-off migration of the golden file; needs Git history"]
fn golden_migration() {
    common::with_stack(golden_migration_);
}

fn golden_migration_() {
    let git = |commit: &str, path: &str| -> Value {
        let output = std::process::Command::new("git")
            .args(["show", &format!("{commit}:./{path}")])
            .current_dir(root())
            .output()
            .unwrap();
        assert!(output.status.success(), "git show {commit}:{path}");
        serde_json::from_slice(&output.stdout).unwrap()
    };
    let mut old = BTreeMap::new();
    let mut rekeyed_over = BTreeMap::new();
    let mut converted = BTreeMap::new();
    let mut fixture_differences = Vec::new();
    for ecosystem in ECOSYSTEMS {
        for side in ["before", "after"] {
            let path = format!("packages/renderers/api/fixtures/{ecosystem}-{side}.json");
            rekeyed_over.insert((ecosystem.to_owned(), side.to_owned()), git(REKEYED_FIXTURES, &path));
            let value = git(LANGUAGE_SHAPED_FIXTURES, &path);
            let new = convert::extraction(&value);
            let written = fixture(ecosystem, side);
            if new != written {
                fixture_differences.push(json!({"fixture": format!("{ecosystem}-{side}"),
                    "differences": differences(&new, &written, "")}));
            }
            old.insert((ecosystem.to_owned(), side.to_owned()), value);
            converted.insert((ecosystem.to_owned(), side.to_owned()), new);
        }
    }
    let from = |fixtures: &BTreeMap<(String, String), Value>| {
        let fixtures = fixtures.clone();
        move |ecosystem: &str, side: &str| fixtures[&(ecosystem.to_owned(), side.to_owned())].clone()
    };
    let path = golden_path("api-compatibility");
    let mut golden = read(&path);
    let index: BTreeMap<String, usize> = golden["cases"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(i, case)| (case["case"].as_str().unwrap().to_owned(), i))
        .collect();
    let expected = |golden: &Value, name: &str| -> Result<Value, String> {
        let mut case = &golden["cases"][index[name]];
        while let Some(first) = case["sameAs"].as_str() {
            case = &golden["cases"][index[first]];
        }
        match case["error"].as_str() {
            Some(error) => Err(error.to_owned()),
            None => Ok(case["comparison"].clone()),
        }
    };
    let comparator = common::comparator("api-compatibility");
    let accept = std::env::var_os("API_GOLDEN_ACCEPT").is_some();
    let (mut checked, mut rekeyed, mut mismatches) = (0, 0, Vec::new());
    let original = golden.clone();
    for ecosystem in ECOSYSTEMS {
        let olds = fixed_cases(ecosystem, None, &from(&old));
        let previous = fixed_cases(ecosystem, None, &from(&rekeyed_over));
        let news = fixed_cases(ecosystem, None, &from(&converted));
        for (((name, before, after, options), (_, new_before, new_after, _)), (_, last_before, last_after, _)) in
            olds.iter().zip(&news).zip(&previous)
        {
            let i = index[name.as_str()];
            let digest = input_digest(new_before, new_after, options);
            // Recorded over the fixtures the original saw, or already re-keyed by a previous run.
            assert!(
                original["cases"][i]["input"] == input_digest(before, after, options)
                    || original["cases"][i]["input"] == input_digest(last_before, last_after, options)
                    || original["cases"][i]["input"] == digest,
                "{name}: the fixtures at {LANGUAGE_SHAPED_FIXTURES} aren't the recorded input"
            );
            checked += 1;
            let actual = declarative(&comparator, new_before, new_after, options);
            let wanted = expected(&original, name);
            let code = |error: &str| error.split(':').next().unwrap().to_owned();
            let agree = match (&wanted, &actual) {
                (Ok(wanted), Ok(actual)) => semantic(wanted) == semantic(actual),
                (Err(wanted), Err(actual)) => *wanted == code(actual),
                _ => false,
            };
            if agree {
                golden["cases"][i]["input"] = json!(digest);
                rekeyed += 1;
                continue;
            }
            mismatches.push(json!({"case": name, "expected": summaries(&wanted), "actual": summaries(&actual)}));
            if accept {
                let case = golden["cases"][i].as_object_mut().unwrap();
                case.remove("sameAs");
                case.remove("comparison");
                case.remove("error");
                match &actual {
                    Ok(comparison) => case.insert("comparison".into(), comparison.clone()),
                    Err(error) => case.insert("error".into(), json!(code(error))),
                };
                case.insert("input".into(), json!(digest));
            }
        }
    }
    let lines: Vec<String> = golden["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| serde_json::to_string(case).unwrap())
        .collect();
    let header = json!({"comparator": golden["comparator"], "original": golden["original"]});
    let header = serde_json::to_string(&header).unwrap();
    std::fs::write(
        &path,
        format!("{},\"cases\":[\n{}\n]}}\n", &header[..header.len() - 1], lines.join(",\n")),
    )
    .unwrap();
    let report = json!({"summary": {"checked": checked, "rekeyed": rekeyed, "mismatches": mismatches.len(),
        "fixtureDifferences": fixture_differences.len()},
        "mismatches": mismatches, "fixtureDifferences": fixture_differences});
    let dir = root().join("target/rules-equivalence");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("api-migration.json"), serde_json::to_string_pretty(&report).unwrap()).unwrap();
    eprintln!("{}", report["summary"]);
}

/// Each change's summary and the counts, or the error: what a mismatch shows.
fn summaries(result: &Result<Value, String>) -> Value {
    match result {
        Ok(comparison) => json!({
            "counts": comparison["metadata"]["compatibility"]["counts"],
            "changes": comparison["changes"].as_array().unwrap().iter()
                .map(|change| json!([change["id"], change["summary"]])).collect::<Vec<_>>(),
        }),
        Err(error) => json!({"error": error}),
    }
}

/// The JSON pointers at which two values differ, with both values.
fn differences(a: &Value, b: &Value, path: &str) -> Vec<Value> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let keys: std::collections::BTreeSet<&String> = x.keys().chain(y.keys()).collect();
            keys.into_iter()
                .flat_map(|key| {
                    differences(
                        x.get(key).unwrap_or(&Value::Null),
                        y.get(key).unwrap_or(&Value::Null),
                        &format!("{path}/{key}"),
                    )
                })
                .collect()
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => x
            .iter()
            .zip(y)
            .enumerate()
            .flat_map(|(i, (x, y))| differences(x, y, &format!("{path}/{i}")))
            .collect(),
        _ if a == b => vec![],
        _ => vec![json!({"path": path, "converted": a, "extracted": b})],
    }
}
