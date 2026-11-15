//! Every custom comparator's rules against the original it replaced: the
//! JavaScript comparators, which ran in QuickJS, and the Rust one, compiled to
//! a WebAssembly module, were deleted with the module comparator kind, and
//! their comparisons of every fixed case (the repository's fixtures, with each
//! test's options) are recorded in `golden/`. Seeded random cases, which had
//! the originals as their reference, now check that the rules run.

mod common;

use common::{Golden, Random, corpus, random_pair, read, root, runs};
use projections_comparator_rules::Comparator;
use projections_engine::normalize;
use serde_json::{Value, json};

/// The default comparison of two extractions, or None when they don't normalize.
fn baseline(before: &Value, after: &Value) -> Option<Value> {
    let before = normalize(before, "/before").ok()?;
    let after = normalize(after, "/after").ok()?;
    projections_comparator_default::compare(&before, &after, &json!({})).ok()
}

fn declarative(comparator: &Comparator, before: &Value, after: &Value, options: &Value) -> Result<Value, String> {
    if baseline(before, after).is_none() {
        return Err("input".into());
    }
    comparator
        .compare(before, after, options)
        .map_err(|failure| match failure[0].code.as_str() {
            // A failed check or expression is the comparator failing, as a thrown error or an `error` output was.
            "invalid-options" | "rules-evaluation" => format!("comparator-error: {}", failure[0]),
            code => code.to_owned(),
        })
}

/// Checks a case: against its golden comparison when it is fixed, else that the rules run.
fn check(golden: &mut Golden, case: &str, fixed: bool, actual: Result<Value, String>, inputs: (&Value, &Value, &Value)) {
    if fixed {
        golden.check(case, inputs.0, inputs.1, inputs.2, actual);
    } else {
        runs(case, &actual);
    }
}

/// Every pair, both ways: the repository's fixtures, which are fixed, and
/// seeded random graphs, which aren't.
fn pairs(random_cases: usize) -> Vec<(String, Value, Value, bool)> {
    let mut pairs = Vec::new();
    // A quick run (debug builds) checks every fourth fixture pair.
    for (index, (name, before, after)) in corpus().into_iter().enumerate() {
        if common::quick() && index % 4 != 0 {
            continue;
        }
        pairs.push((format!("{name} reversed"), after.clone(), before.clone(), true));
        pairs.push((name, before, after, true));
    }
    let mut random = Random::new(11);
    for case in 0..common::cases(random_cases) {
        let (before, after) = random_pair(&mut random);
        pairs.push((format!("random {case}"), before, after, false));
    }
    pairs
}

fn changed_entities(before: &Value, after: &Value) -> Vec<String> {
    let Some(baseline) = baseline(before, after) else {
        return vec![];
    };
    baseline["changes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|change| change["collection"] == "entities")
        .flat_map(|change| {
            change["after"]
                .as_array()
                .unwrap()
                .iter()
                .chain(change["before"].as_array().unwrap())
        })
        .map(|id| id.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn priority_order() {
    common::with_stack(priority_order_);
}

fn priority_order_() {
    let comparator = common::comparator("priority-order");
    let mut golden = Golden::open("priority-order");
    let mut cases: Vec<(String, Value, Value, Value, bool)> = Vec::new();
    for (name, before, after, fixed) in pairs(300) {
        let mut ids = changed_entities(&before, &after);
        ids.reverse();
        let picked: Vec<String> = ids.iter().step_by(2).take(4).cloned().collect();
        for options in [
            json!({}),
            json!({"priority": []}),
            json!({"priority": picked}),
            json!({"priority": [picked.first(), "unknown", picked.first()]}),
        ] {
            if options["priority"].as_array().is_some_and(|ids| ids.iter().any(Value::is_null)) {
                continue;
            }
            cases.push((name.clone(), before.clone(), after.clone(), options, fixed));
        }
    }
    let fixtures = root().join("examples/comparators/priority-order/fixtures");
    cases.push((
        "priority-order fixture".into(),
        read(&fixtures.join("before.json")),
        read(&fixtures.join("after.json")),
        json!({"priority": ["package:@acme/core", "package:@acme/auth", "package:@acme/ui"]}),
        true,
    ));
    let empty = json!({"protocolVersion": 0, "schema": "graph/v0", "entities": [], "relationships": []});
    for options in [json!({"priorities": []}), json!({"priority": "a"}), json!({"priority": [1]})] {
        cases.push((format!("options {options}"), empty.clone(), empty.clone(), options, true));
    }
    for (name, before, after, options, fixed) in &cases {
        let case = format!("{name} {options}");
        let actual = declarative(&comparator, before, after, options);
        check(&mut golden, &case, *fixed, actual, (before, after, options));
    }
    // The two originals disagreed on `priority: null`: the Rust one rejected
    // it, the JavaScript one read it as no priorities. The rules reject it.
    let null = json!({"priority": null});
    assert!(declarative(&comparator, &empty, &empty, &null).is_err());
    golden.finish();
}

#[test]
fn starter_and_guide() {
    common::with_stack(starter_and_guide_);
}

fn starter_and_guide_() {
    let starter = common::comparator("starter-kinds");
    let guide = common::comparator("guide-priority");
    // The originals were JavaScript, from before the starter and the guide became rules.
    let mut starter_golden = Golden::open("starter-kinds");
    let mut guide_golden = Golden::open("guide-priority");
    for (name, before, after, fixed) in pairs(300) {
        let mut kinds: Vec<String> = after["entities"]
            .as_array()
            .unwrap()
            .iter()
            .chain(before["entities"].as_array().unwrap())
            .map(|entity| entity["kind"].as_str().unwrap().to_owned())
            .collect();
        kinds.sort();
        kinds.dedup();
        kinds.reverse();
        for options in [
            json!({}),
            json!({"kinds": null}),
            json!({"kinds": kinds}),
            json!({"kinds": ["nothing", kinds.last()]}),
            json!({"kinds": "service"}),
            json!({"other": 1}),
        ] {
            let case = format!("{name} {options}");
            let actual = declarative(&starter, &before, &after, &options);
            check(&mut starter_golden, &case, fixed, actual, (&before, &after, &options));
        }
        let mut ids: Vec<Value> = baseline(&before, &after)
            .map(|baseline| {
                baseline["changes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|change| change["id"].clone())
                    .collect()
            })
            .unwrap_or_default();
        ids.reverse();
        ids.truncate(5);
        for options in [json!({}), json!({"priority": ids})] {
            let case = format!("{name} {options}");
            let actual = declarative(&guide, &before, &after, &options);
            check(&mut guide_golden, &case, fixed, actual, (&before, &after, &options));
        }
    }
    starter_golden.finish();
    guide_golden.finish();
}

/// Components that move between modules: IDs carry the module, labels don't.
fn moves(random: &mut Random) -> (Value, Value) {
    let modules = ["billing", "invoicing", "core", "web"];
    let names = ["InvoiceService", "Ledger", "Mailer", "Cache", "Router", "Mailer"];
    let mut before = Vec::new();
    let mut after = Vec::new();
    for (index, name) in names.iter().enumerate().take(2 + random.below(5)) {
        let label = if random.chance(80) {
            name.to_string()
        } else {
            format!("{name}{index}")
        };
        let module = random.pick(&modules);
        let entity = |module: &str, label: &str| json!({"id": format!("component:{module}/{label}"), "kind": if random_kind(index) { "component" } else { "service" }, "label": label});
        if random.chance(85) {
            before.push(entity(module, &label));
        }
        if random.chance(85) {
            let target = if random.chance(50) { random.pick(&modules) } else { module };
            let mut moved = entity(target, &label);
            if random.chance(25) {
                moved["data"] = json!({"lines": random.below(100)});
            }
            after.push(moved);
        }
    }
    let dedup = |list: &mut Vec<Value>| {
        let mut seen = std::collections::HashSet::new();
        list.retain(|entity| seen.insert(entity["id"].as_str().unwrap().to_owned()));
    };
    dedup(&mut before);
    dedup(&mut after);
    let relationships = |random: &mut Random, entities: &[Value]| {
        let mut list: Vec<Value> = Vec::new();
        for _ in 0..random.below(entities.len() * 2 + 1) {
            if entities.is_empty() {
                break;
            }
            let from = random.pick(entities)["id"].as_str().unwrap().to_owned();
            let to = random.pick(entities)["id"].as_str().unwrap().to_owned();
            let id = format!("{from}->{to}");
            if list.iter().any(|r| r["id"] == id) {
                continue;
            }
            list.push(json!({"id": id, "kind": if random.chance(80) { "calls" } else { "uses" }, "from": from, "to": to}));
        }
        list
    };
    let before_relationships = relationships(random, &before);
    let after_relationships = relationships(random, &after);
    let extraction =
        |entities, relationships| json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": relationships});
    (extraction(before, before_relationships), extraction(after, after_relationships))
}

fn random_kind(index: usize) -> bool {
    index % 3 != 2
}

#[test]
fn moved_components() {
    common::with_stack(moved_components_);
}

fn moved_components_() {
    let comparator = common::comparator("moved-components");
    let mut golden = Golden::open("moved-components");
    let mut cases = pairs(200);
    let mut random = Random::new(5);
    for case in 0..common::cases(600) {
        let (before, after) = moves(&mut random);
        cases.push((format!("moves {case} {before} {after}"), before, after, false));
    }
    let options = json!({});
    for (name, before, after, fixed) in cases {
        let actual = declarative(&comparator, &before, &after, &options);
        check(&mut golden, &name, fixed, actual, (&before, &after, &options));
    }
    golden.finish();
}

/// Values seen per (entity kind, data key) across the runtime policy fixtures.
type Pools = std::collections::BTreeMap<(String, String), Vec<Value>>;

fn mutate(random: &mut Random, extraction: &Value, pools: &Pools) -> Value {
    let mut extraction = extraction.clone();
    for _ in 0..1 + random.below(4) {
        let entities = extraction["entities"].as_array().unwrap().len();
        if entities == 0 {
            break;
        }
        let index = random.below(entities);
        match random.below(10) {
            0 => {
                let id = extraction["entities"][index]["id"].clone();
                extraction["entities"].as_array_mut().unwrap().remove(index);
                extraction["relationships"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|r| r["from"] != id && r["to"] != id);
            }
            1 => {
                let subjects: Vec<Value> = extraction["entities"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|e| e["kind"] == "subject")
                    .map(|e| e["id"].clone())
                    .collect();
                if let Some(relationship) = extraction["relationships"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|r| r["kind"] == "applies-to")
                {
                    if !subjects.is_empty() {
                        relationship["to"] = random.pick(&subjects).clone();
                    }
                }
            }
            _ => {
                let entity = &mut extraction["entities"][index];
                let kind = entity["kind"].as_str().unwrap().to_owned();
                let keys: Vec<&(String, String)> = pools.keys().filter(|(k, _)| *k == kind).collect();
                if keys.is_empty() {
                    continue;
                }
                let key = (*random.pick(&keys)).clone();
                let value = random.pick(&pools[&key]).clone();
                if !entity["data"].is_object() {
                    entity["data"] = json!({});
                }
                entity["data"][key.1.as_str()] = value;
            }
        }
    }
    extraction
}

#[test]
fn runtime_policy() {
    common::with_stack(runtime_policy_);
}

fn runtime_policy_() {
    let comparator = common::comparator("runtime-policy");
    let mut golden = Golden::open("runtime-policy");
    let dir = root().join("packages/extractors/tetragon-policies/tests/fixtures");
    let fixtures: Vec<(String, Value)> = [
        "credentials/before",
        "credentials/after",
        "credentials/monitor",
        "deployment/before",
        "deployment/after",
        "library/",
    ]
    .iter()
    .map(|name| {
        (
            name.to_string(),
            read(&dir.join(format!("{name}{}expected.json", if name.ends_with('/') { "" } else { "." }))),
        )
    })
    .collect();
    let mut pools = Pools::new();
    for (_, extraction) in &fixtures {
        for entity in extraction["entities"].as_array().unwrap() {
            for (key, value) in entity["data"].as_object().into_iter().flatten() {
                let pool = pools.entry((entity["kind"].as_str().unwrap().to_owned(), key.clone())).or_default();
                if !pool.contains(value) {
                    pool.push(value.clone());
                }
            }
        }
    }
    let mut cases: Vec<(String, Value, Value, bool)> = Vec::new();
    for (a, before) in &fixtures {
        for (b, after) in &fixtures {
            cases.push((format!("{a} → {b}"), before.clone(), after.clone(), true));
        }
    }
    let mut random = Random::new(3);
    for case in 0..common::cases(600) {
        let (name, base) = random.pick(&fixtures).clone();
        let before = if random.chance(30) {
            mutate(&mut random, &base, &pools)
        } else {
            base.clone()
        };
        let after = mutate(&mut random, &base, &pools);
        cases.push((format!("mutated {name} {case}"), before, after, false));
    }
    cases.extend(pairs(50));
    let options = json!({});
    for (name, before, after, fixed) in &cases {
        let actual = declarative(&comparator, before, after, &options);
        check(&mut golden, name, *fixed, actual, (before, after, &options));
    }
    let empty = json!({"protocolVersion": 0, "schema": "graph/v0", "entities": [], "relationships": []});
    let options = json!({"x": 1});
    let actual = declarative(&comparator, &empty, &empty, &options);
    golden.check("options", &empty, &empty, &options, actual);
    golden.finish();
}
