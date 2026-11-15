//! The default ordering policy, ported from the prototype sequencer's tests.

use projections_comparator_default::compare;
use serde_json::{Value, json};

fn entity(id: &str) -> Value {
    json!({"id": id, "kind": "package", "label": id})
}

fn dependency(id: &str, from: &str, to: &str) -> Value {
    json!({"id": id, "kind": "dependency", "from": from, "to": to})
}

fn graph(entities: Vec<Value>, relationships: Vec<Value>) -> Value {
    json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": relationships})
}

fn star(ids: &[String]) -> Value {
    let mut entities = vec![entity("root"), entity("keep")];
    let mut relationships = vec![dependency("edge:keep", "root", "keep")];
    for id in ids {
        entities.push(entity(id));
        relationships.push(dependency(&format!("edge:{id}"), "root", id));
    }
    graph(entities, relationships)
}

/// A spine of persistent entities with changes hanging off successive depths,
/// so the change spans many layers.
fn layered(ids: &[String]) -> Value {
    let spine = ["root", "a", "b", "c", "d", "e"];
    let mut entities: Vec<_> = spine.iter().map(|id| entity(id)).collect();
    let mut relationships: Vec<_> = spine
        .windows(2)
        .map(|pair| dependency(&format!("edge:{}", pair[1]), pair[0], pair[1]))
        .collect();
    for (index, id) in ids.iter().enumerate() {
        entities.push(entity(id));
        relationships.push(dependency(&format!("edge:{id}"), spine[index % spine.len()], id));
    }
    graph(entities, relationships)
}

const SHAPES: [(usize, usize); 11] = [
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
];

fn fixtures() -> Vec<(String, Value, Value)> {
    let names = |prefix: &str, count: usize| -> Vec<String> { (0..count).map(|index| format!("{prefix}{index}")).collect() };
    let mut result = Vec::new();
    for (name, shape) in [("peers", star as fn(&[String]) -> Value), ("layers", layered)] {
        for (removed, added) in SHAPES {
            result.push((
                format!("{name} {removed}/{added}"),
                shape(&names("old", removed)),
                shape(&names("new", added)),
            ));
        }
    }
    result
}

fn steps(before: &Value, after: &Value) -> Vec<Value> {
    compare(before, after, &json!({})).unwrap()["steps"].as_array().unwrap().clone()
}

/// Entity members of each step, leaving out relationships.
fn entities(steps: &[Value]) -> Vec<Vec<String>> {
    steps
        .iter()
        .map(|step| {
            step["changes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap().to_owned())
                .filter(|id| !id.starts_with("edge:"))
                .collect()
        })
        .collect()
}

#[test]
fn changes_connected_to_each_other_happen_as_one_coherent_step() {
    // Removing a service, its registration and its implementation is one act.
    let before = graph(
        ["root", "service", "registration", "implementation"]
            .into_iter()
            .map(entity)
            .collect(),
        vec![
            dependency("edge:service", "root", "service"),
            dependency("edge:registration", "service", "registration"),
            dependency("edge:implementation", "registration", "implementation"),
        ],
    );
    let after = graph(vec![entity("root")], vec![]);
    let removals = steps(&before, &after);
    assert_eq!(
        entities(&removals),
        [["service", "registration", "implementation"]],
        "a connected removal must not leave one entity at a time"
    );
    assert_eq!(removals[0]["kind"], "remove");
    assert_eq!(
        removals[0]["changes"].as_array().unwrap().len(),
        6,
        "its relationships leave with it"
    );
    let additions = steps(&after, &before);
    assert_eq!(
        entities(&additions),
        [["service", "registration", "implementation"]],
        "and the same group arrives together"
    );
    assert_eq!(additions[0]["kind"], "add");
}

#[test]
fn independent_changes_are_ordered_leaf_first_outward_and_root_first_inward() {
    let before = graph(
        ["root", "mid", "shallow", "deep"].into_iter().map(entity).collect(),
        vec![
            dependency("edge:mid", "root", "mid"),
            dependency("edge:shallow", "root", "shallow"),
            dependency("edge:deep", "mid", "deep"),
        ],
    );
    let after = graph(vec![entity("root"), entity("mid")], vec![dependency("edge:mid", "root", "mid")]);
    assert_eq!(entities(&steps(&before, &after)), [["deep"], ["shallow"]]);
    assert_eq!(
        entities(&steps(&after, &before)),
        [["shallow"], ["deep"]],
        "additions are the exact reverse of removals for the same set"
    );
}

#[test]
fn independent_peers_at_the_same_depth_change_together() {
    let names = ["octicons-react", "primitives", "react", "react-is", "types-react-is"];
    let after = graph(
        std::iter::once(entity("app"))
            .chain(names.iter().map(|name| entity(&format!("package:{name}"))))
            .collect(),
        names
            .iter()
            .map(|name| dependency(&format!("edge:{name}"), "app", &format!("package:{name}")))
            .collect(),
    );
    let before = graph(vec![entity("app")], vec![]);
    let result = steps(&before, &after);
    assert_eq!(result.len(), 1, "peers must not be staggered into a sequence");
    let mut members = entities(&result).remove(0);
    members.sort();
    assert_eq!(members, names.iter().map(|name| format!("package:{name}")).collect::<Vec<_>>());
}

#[test]
fn a_bounded_number_of_waves_never_splits_a_coherent_group() {
    // Twelve independent connected pairs at increasing depth: more layers than waves.
    let mut entities_before = vec![entity("root")];
    let mut relationships = Vec::new();
    let mut parent = "root".to_owned();
    for index in 0..12 {
        let (a, b) = (format!("a{index}"), format!("b{index}"));
        entities_before.extend([entity(&a), entity(&b)]);
        relationships.push(dependency(&format!("edge:pair{index}"), &a, &b));
        relationships.push(dependency(&format!("edge:root{index}"), &parent, &a));
        entities_before.push(entity(&format!("spine{index}")));
        relationships.push(dependency(&format!("edge:spine{index}"), &parent, &format!("spine{index}")));
        parent = format!("spine{index}");
    }
    let before = graph(entities_before, relationships);
    let after = graph(vec![entity("root")], vec![]);
    let result = entities(&steps(&before, &after));
    assert!(result.len() <= 5, "waves stay bounded: {result:?}");
    for index in 0..12 {
        let (a, b) = (format!("a{index}"), format!("b{index}"));
        let owning: Vec<_> = result.iter().filter(|step| step.contains(&a) || step.contains(&b)).collect();
        assert_eq!(owning.len(), 1, "pair {index} was split across waves");
        assert!(owning[0].contains(&a) && owning[0].contains(&b));
    }
}

#[test]
fn steps_carry_order_and_simultaneity_but_never_time_or_position() {
    for (shape, before, after) in fixtures() {
        for step in steps(&before, &after) {
            let mut keys: Vec<_> = step.as_object().unwrap().keys().cloned().collect();
            keys.sort();
            assert_eq!(keys, ["changes", "kind"], "{shape}");
        }
    }
}

#[test]
fn removal_and_addition_waves_stay_bounded() {
    for (shape, before, after) in fixtures() {
        let result = steps(&before, &after);
        for kind in ["remove", "add"] {
            let count = result.iter().filter(|step| step["kind"] == kind).count();
            assert!(count <= 5, "{shape}: {count} {kind} steps");
        }
    }
}

#[test]
fn swapping_the_compared_extractions_mirrors_the_steps_exactly() {
    for (shape, before, after) in fixtures() {
        let forward = steps(&before, &after);
        let mut reverse = steps(&after, &before);
        reverse.reverse();
        assert_eq!(forward.len(), reverse.len(), "{shape}");
        for (forward, reverse) in forward.iter().zip(&reverse) {
            assert_eq!(forward["changes"], reverse["changes"], "{shape}");
            let mirrored = match forward["kind"].as_str().unwrap() {
                "remove" => "add",
                "add" => "remove",
                kind => kind,
            };
            assert_eq!(reverse["kind"], mirrored, "{shape}");
        }
    }
}

#[test]
fn ordering_is_deterministic() {
    for (shape, before, after) in fixtures() {
        assert_eq!(steps(&before, &after), steps(&before, &after), "{shape}");
        let mut shuffled = after.clone();
        shuffled["entities"].as_array_mut().unwrap().reverse();
        shuffled["relationships"].as_array_mut().unwrap().reverse();
        assert_eq!(steps(&before, &after), steps(&before, &shuffled), "{shape}");
    }
}

fn kinds_and_entities(before: &Value, after: &Value, options: Value) -> Vec<(String, Vec<String>)> {
    let comparison = compare(before, after, &options).unwrap();
    let steps = comparison["steps"].as_array().unwrap();
    steps
        .iter()
        .map(|step| step["kind"].as_str().unwrap().to_owned())
        .zip(entities(steps))
        .collect()
}

#[test]
fn self_relationships_do_not_affect_depth() {
    // "keep" survives with a self-loop; "deep" hangs below it, so it is added
    // after "shallow", which hangs off the root.
    let before = graph(
        vec![entity("root"), entity("keep")],
        vec![dependency("edge:keep", "root", "keep"), dependency("edge:loop", "keep", "keep")],
    );
    let mut after = before.clone();
    for (id, parent) in [("deep", "keep"), ("shallow", "root")] {
        after["entities"].as_array_mut().unwrap().push(entity(id));
        after["relationships"]
            .as_array_mut()
            .unwrap()
            .push(dependency(&format!("edge:{id}"), parent, id));
    }
    assert_eq!(
        kinds_and_entities(&before, &after, json!({})),
        [
            ("add".to_owned(), vec!["shallow".to_owned()]),
            ("add".to_owned(), vec!["deep".to_owned()])
        ]
    );
}

#[test]
fn parallel_relationships_count_once_for_depth() {
    let before = graph(vec![entity("root")], vec![]);
    let after = graph(
        vec![entity("root"), entity("a"), entity("b"), entity("c")],
        vec![
            dependency("edge:a", "root", "a"),
            dependency("edge:a2", "root", "a"),
            dependency("edge:b", "a", "b"),
            dependency("edge:c", "root", "c"),
        ],
    );
    // a and b are connected, so they form one group at a's depth with c.
    assert_eq!(
        kinds_and_entities(&before, &after, json!({})),
        [("add".to_owned(), vec!["a".to_owned(), "b".to_owned(), "c".to_owned()])]
    );
}

#[test]
fn steps_without_a_value_sort_after_steps_with_one() {
    // "first" is shallowest, so it is added first by default, but only the
    // deeper peers below the surviving "keep" have a size.
    let before = graph(vec![entity("root"), entity("keep")], vec![dependency("edge:keep", "root", "keep")]);
    let mut after = before.clone();
    for (id, parent, size) in [("first", "root", None), ("deep", "keep", Some(1)), ("deeper", "keep", Some(2))] {
        let mut item = entity(id);
        if let Some(size) = size {
            item["data"] = json!({"size": size});
        }
        after["entities"].as_array_mut().unwrap().push(item);
        after["relationships"]
            .as_array_mut()
            .unwrap()
            .push(dependency(&format!("edge:{id}"), parent, id));
    }
    let names = |options: Value| -> Vec<Vec<String>> {
        kinds_and_entities(&before, &after, options)
            .into_iter()
            .map(|(_, ids)| ids)
            .collect()
    };
    assert_eq!(names(json!({})), [vec!["first"], vec!["deep", "deeper"]]);
    for direction in ["ascending", "descending"] {
        assert_eq!(
            names(json!({"order": {"by": "data.size", "direction": direction}})),
            [vec!["deep", "deeper"], vec!["first"]],
            "{direction}"
        );
    }
}

#[test]
fn a_relationship_moving_from_a_departing_to_an_arriving_endpoint_arrives_in_both_directions() {
    // "edge" keeps its ID but moves from the removed "old" to the added "new".
    let before = graph(vec![entity("root"), entity("old")], vec![dependency("edge", "root", "old")]);
    let after = graph(vec![entity("root"), entity("new")], vec![dependency("edge", "root", "new")]);
    for (before, after, removed, added) in [(&before, &after, "old", "new"), (&after, &before, "new", "old")] {
        let comparison = compare(before, after, &json!({})).unwrap();
        assert_eq!(
            comparison["steps"],
            json!([
                {"changes": [removed], "kind": "remove"},
                {"changes": [added, "edge"], "kind": "add"},
            ])
        );
    }
}
