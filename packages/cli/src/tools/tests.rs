use serde_json::Map;

use super::{
    authoring::describe::describe_part,
    read::{summarize_comparison, summarize_sweep},
    *,
};

#[test]
fn every_tool_is_described_with_a_valid_schema_and_hints() {
    let tools = catalog();
    let mut names = std::collections::BTreeSet::new();
    for tool in &tools {
        assert!(names.insert(tool.name), "{} is listed twice", tool.name);
        assert!(
            tool.name.bytes().all(|byte| byte.is_ascii_lowercase() || byte == b'_'),
            "{}",
            tool.name
        );
        assert!(tool.description.len() > 80, "{} needs a description", tool.name);
        assert!(!tool.title.is_empty());
        assert!(!(tool.read_only && tool.destructive), "{}", tool.name);
        let schema = &tool.input_schema;
        assert_eq!(schema["type"], "object", "{}", tool.name);
        assert_eq!(schema["additionalProperties"], false, "{}", tool.name);
        let properties = schema["properties"].as_object().unwrap();
        for required in schema["required"].as_array().unwrap() {
            assert!(properties.contains_key(required.as_str().unwrap()), "{}", tool.name);
        }
        for (name, property) in properties {
            assert!(
                property["description"].as_str().is_some_and(|text| !text.is_empty()),
                "{}.{name} needs a description",
                tool.name
            );
            assert!(property.get("type").is_some(), "{}.{name}", tool.name);
        }
        // Writes preview first: each takes a confirm token, and nothing else
        // does. A tool that only runs repository code (prepare) changes the
        // checkout's ignored files without a preview.
        let writes = tool.trust == Trust::Write || tool.trust == Trust::Onboarding;
        assert_eq!(properties.contains_key("confirm"), writes, "{}", tool.name);
        assert!(!writes || !tool.read_only, "{}", tool.name);
        assert!(tool.read_only || writes || tool.name == "prepare", "{}", tool.name);
        let listed = tool.json();
        assert_eq!(listed["annotations"]["readOnlyHint"], tool.read_only);
        assert_eq!(listed["annotations"]["destructiveHint"], tool.destructive);
        // A schema accepts the arguments it requires.
        let minimal: Map<String, Value> = schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|key| {
                let key = key.as_str().unwrap();
                let value = match &properties[key] {
                    property if property["type"] == "array" => json!(["a"]),
                    property if property["enum"].is_array() => property["enum"][0].clone(),
                    _ => json!("a"),
                };
                (key.to_owned(), value)
            })
            .collect();
        validate(schema, &Value::Object(minimal), "").unwrap();
    }
    // Every host lists every tool; the view tools are marked, answered by the surface showing the view.
    let listed: Vec<Value> = list()["tools"].as_array().unwrap().clone();
    assert_eq!(listed.len(), tools.len());
    let views: Vec<&str> = listed
        .iter()
        .filter(|tool| tool["view"] == true)
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert_eq!(views, ["open_projection", "current_view", "refresh"]);
}

#[test]
fn arguments_are_validated_against_the_schema() {
    let schema = catalog().into_iter().find(|tool| tool.name == "compare").unwrap().input_schema;
    assert!(validate(&schema, &json!({"projection": "map", "maxChanges": 5}), "").is_ok());
    for (arguments, message) in [
        (json!({"projection": ""}), "projection must not be empty"),
        (json!({"projection": 3}), "projection must be string"),
        (json!({"projection": "map", "maxChanges": 0}), "maxChanges must be at least 1"),
        (json!({"projection": "map", "maxChanges": 1.5}), "maxChanges must be integer"),
        (json!({"projection": "map", "definition": "tip"}), "definition must be one of"),
        (json!({"projection": "map", "pair": "x"}), "have no pair"),
        (json!([]), "must be object"),
    ] {
        let error = validate(&schema, &arguments, "").unwrap_err();
        assert!(error.contains(message), "{arguments}: {error}");
    }
    let set_part = catalog().into_iter().find(|tool| tool.name == "set_part").unwrap().input_schema;
    assert!(validate(&set_part, &json!({"projection": "map", "comparator": null, "renderer": "dag"}), "").is_ok());
    assert!(validate(&set_part, &json!({"projection": "map", "renderer": 3}), "").is_err());
    let sweep = catalog().into_iter().find(|tool| tool.name == "sweep").unwrap().input_schema;
    assert!(validate(&sweep, &json!({"projections": []}), "").is_err());
    assert!(
        validate(&sweep, &json!({"projections": ["a", 1]}), "")
            .unwrap_err()
            .contains("projections[1]")
    );
}

#[test]
fn long_text_is_cut_at_a_line_and_says_so() {
    let text = (0..1000).map(|line| format!("line {line}\n")).collect::<String>();
    let cut = bounded(text.clone(), 100);
    assert!(cut.len() < 200, "{cut}");
    assert!(cut.contains("line 0\n") && cut.contains("more bytes"));
    assert_eq!(bounded("short".to_owned(), 100), "short");
    assert!(bounded("é".repeat(100), 51).contains("more bytes"));
}

#[test]
fn diffs_show_changed_lines_with_their_context() {
    let before = "{\n  \"id\": \"map\",\n  \"a\": 1,\n  \"b\": 2,\n  \"c\": 3,\n  \"d\": 4,\n  \"e\": 5,\n  \"renderer\": \"graph\"\n}\n";
    let after = before.replace("\"graph\"", "\"dag\"");
    let diff = line_diff(before, &after);
    assert!(diff.contains("-   \"renderer\": \"graph\"\n+   \"renderer\": \"dag\""), "{diff}");
    assert!(diff.starts_with("  …\n"), "{diff}");
    assert!(!diff.contains("\"a\": 1"), "{diff}");
    assert_eq!(line_diff("a\n", "a\n"), "  …\n");
    assert_eq!(line_diff("", "a\nb\n"), "+ a\n+ b\n");
}

#[test]
fn confirm_tokens_name_what_is_written() {
    let one = token("set_part", &["sha256:1", "a.json", "{}"]);
    assert_eq!(one.len(), 20);
    assert_eq!(one, token("set_part", &["sha256:1", "a.json", "{}"]));
    assert_ne!(one, token("set_part", &["sha256:2", "a.json", "{}"]));
    assert_ne!(one, token("set_part", &["sha256:1", "a.json", "{ }"]));
    assert_ne!(one, token("adopt", &["sha256:1", "a.json", "{}"]));
    assert!(confirm_hint(Host::Agent, "adopt", &one).contains(&format!("confirm: \"{one}\"")));
    assert!(!confirm_hint(Host::Editor, "adopt", &one).contains(&one));
}

#[test]
fn a_comparison_is_told_in_steps_with_its_compatibility_levels() {
    let side = |commit: &str, entities: Value| {
        json!({"projection": {"id": "api", "title": "Public API"},
            "provenance": {"revision": {"kind": "commit", "commit": commit}, "definitionDigest": "sha256:d"},
            "extraction": {"schema": "api/v0", "entities": entities, "relationships": []}})
    };
    let document = json!({
        "before": side("1111111111111111111111111111111111111111", json!([{"id": "send", "kind": "method", "label": "Send"}])),
        "after": side("2222222222222222222222222222222222222222", json!([{"id": "add", "kind": "method", "label": "Add"}])),
        "comparator": {"id": "api-compatibility.comparator.yaml"},
        "comparison": {
            "changes": [
                {"id": "c1", "collection": "entities", "status": "removed", "before": ["send"], "after": [], "summary": "Breaking: removed"},
                {"id": "c2", "collection": "entities", "status": "added", "before": [], "after": ["add"]},
            ],
            "steps": [{"kind": "breaking", "summary": "What breaks", "changes": ["c1"]}, {"changes": ["c2"]}],
            "metadata": {
                "compatibility": {"rules": "ApiCompat, reproduced", "counts": {"additive": 1, "breaking": 1},
                    "changes": {"c1": {"level": "breaking", "reason": "Removed"}, "c2": {"level": "additive", "reason": "Added"}}},
                "verdict": "major",
            },
        },
    });
    let outcome = summarize_comparison(&document, &[], ("v1", "v2", Some("v1 → v2")), 1);
    let text = &outcome.text;
    assert!(text.contains("Public API (projection api)"), "{text}");
    assert!(text.contains("2 changes in 2 steps: 1 added, 1 removed."), "{text}");
    assert!(
        text.contains("Compatibility (ApiCompat, reproduced): 1 breaking, 1 additive."),
        "{text}"
    );
    assert!(text.contains("Comparator metadata: verdict \"major\"."), "{text}");
    assert!(text.contains("Step 1 of 2 (breaking): What breaks"), "{text}");
    assert!(text.contains("Removed entity Send [send]: Breaking: removed [breaking]"), "{text}");
    assert!(
        text.contains("1 change more not described") || text.contains("1 change more"),
        "{text}"
    );
    let structured = &outcome.structured;
    assert_eq!(structured["counts"], json!({"added": 1, "removed": 1}));
    assert_eq!(structured["changes"][0]["entities"], json!(["send"]));
    assert_eq!(structured["changes"][0]["level"], "breaking");
    assert_eq!(structured["steps"][1]["changes"], json!(["c2"]));
    assert_eq!(structured["truncated"], true);
    assert_eq!(structured["pair"], "v1 → v2");
}

#[test]
fn a_sweep_is_summarized_per_projection() {
    let changes: Vec<Value> = (1..=4)
        .map(|number| json!({"before": format!("b{number}"), "after": format!("a{number}"), "title": format!("Change {number}"), "number": number}))
        .collect();
    let mut cells = Vec::new();
    for (index, change) in changes.iter().enumerate() {
        cells.push(
            json!({"projection": "map", "before": change["before"], "after": change["after"], "status": "changed",
            "changes": index + 1, "steps": 1, "counts": {"added": index + 1}}),
        );
        cells.push(json!({"projection": "deps", "before": change["before"], "after": change["after"],
            "status": if index == 3 { "changed" } else { "unchanged" }, "changes": if index == 3 { 2 } else { 0 }, "steps": 1, "counts": {"modified": 2}}));
    }
    let sweep = json!({"id": "s", "status": "completed", "changes": changes, "cells": cells, "projections": [
        {"projection": "map", "status": "ready"}, {"projection": "deps", "status": "ready"},
        {"projection": "flags", "status": "trust", "error": "It runs repository code"}]});
    let outcome = summarize_sweep(&sweep);
    let text = &outcome.text;
    assert!(text.contains("Swept 4 recent changes with 3 projections"), "{text}");
    assert!(
        text.contains("- map: changed in 4 of 4 (median 3 changes); most on #4 Change 4 (4: 4 added), #3 Change 3"),
        "{text}"
    );
    assert!(text.contains("likely noise"), "{text}");
    assert!(
        text.contains("- deps: changed in 1 of 4 (median 2 changes); most on #4 Change 4 (2: 2 modified)"),
        "{text}"
    );
    assert!(text.contains("- flags: skipped. It runs repository code"), "{text}");
    assert!(
        text.contains("Changes where several projections changed: #4 Change 4 (2 projections)"),
        "{text}"
    );
    assert!(
        text.contains("Worth a look: deps.\nLikely noise (changed on nearly every change): map."),
        "{text}"
    );
    // The structural one first, then the noisy one, then the skipped one.
    let projections = &outcome.structured["projections"];
    assert_eq!(projections[0]["projection"], "deps");
    assert_eq!(projections[0]["signal"], "rare");
    assert_eq!(projections[0]["median"], 2);
    assert_eq!(projections[1]["projection"], "map");
    assert_eq!(projections[1]["signal"], "noisy");
    assert_eq!(projections[1]["changed"], 4);
    assert_eq!(projections[2]["projection"], "flags");
}

#[test]
fn built_in_parts_are_described() {
    let extractor = describe_part(&json!({"part": "extractor", "id": "repository-map"})).unwrap();
    assert!(
        extractor.text.contains("[repository-map]") && extractor.text.contains("Definition template"),
        "{}",
        extractor.text
    );
    let all = describe_part(&json!({"part": "extractor"})).unwrap();
    assert!(all.text.contains("- prisma-schema:"), "{}", all.text);
    assert!(describe_part(&json!({"part": "extractor", "id": "nothing"})).is_err());
    let comparator = describe_part(&json!({"part": "comparator", "id": "default"})).unwrap();
    assert!(comparator.text.contains("\"order\""), "{}", comparator.text);
    assert!(describe_part(&json!({"part": "comparator", "id": "module"})).is_err());
    // Renderers come from the embedded Inspector build, which a test build may lack.
    let renderers = describe_part(&json!({"part": "renderer"})).unwrap();
    assert!(renderers.text.contains("Built-in renderers"), "{}", renderers.text);
}

fn shown() -> ViewDefaults {
    ViewDefaults {
        projection: "map".into(),
        title: "Map".into(),
        compared: "Branch changes".into(),
        pair: Some((Some("a".repeat(40)), "working-tree".into())),
        parts: json!({"extractor": "workspace-dependencies", "comparator": null, "renderer": "graph"}),
        mode: Some("swipe".into()),
        progress: Some(0.5),
        theme: Some("dark".into()),
        width: Some(5000),
        height: Some(600),
        definition_revision: None,
    }
}

#[test]
fn omitted_projections_and_revisions_come_from_the_viewer_and_say_so() {
    let view = shown();
    let (input, note) = with_view_defaults("compare", json!({}), Some(&view)).unwrap();
    assert_eq!(input["projection"], "map");
    assert_eq!(
        (input["before"].as_str().unwrap().len(), input["after"].as_str()),
        (40, Some("working-tree"))
    );
    let note = note.unwrap();
    assert!(note.contains("Projection: map, the one the viewer shows."), "{note}");
    assert!(
        note.contains(
            "aaaaaaaa → working-tree, the ones the viewer shows (Branch changes). This is the comparison on the person's screen."
        ),
        "{note}"
    );
    // The viewer's pair compares with the definition the viewer applies.
    assert_eq!(input["definitionRevision"], "working-tree");
    let committed = ViewDefaults {
        definition_revision: Some("HEAD".into()),
        ..shown()
    };
    let (input, _) = with_view_defaults("compare", json!({}), Some(&committed)).unwrap();
    assert_eq!(input["definitionRevision"], "HEAD");
    let (input, _) = with_view_defaults("compare", json!({"definition": "head"}), Some(&committed)).unwrap();
    assert!(input.get("definitionRevision").is_none(), "a chosen definition stands");
    let (input, note) = with_view_defaults("compare", json!({"before": "HEAD"}), Some(&view)).unwrap();
    assert!(note.unwrap().contains("Not the comparison the viewer shows"));
    assert!(
        input.get("definitionRevision").is_none(),
        "given revisions use their own definition"
    );
    let (input, _) = with_view_defaults("compare", json!({"projection": "other"}), Some(&committed)).unwrap();
    assert_eq!(input["after"], "working-tree", "revisions apply to any projection");
    assert_eq!(
        input["definitionRevision"], "working-tree",
        "the view's definition is its projection's"
    );
    let (input, _) = with_view_defaults("screenshot", json!({"projection": "other"}), Some(&view)).unwrap();
    assert!(input.get("theme").is_none(), "the view's theme and size are its projection's");
    let (input, note) = with_view_defaults("check", json!({}), Some(&view)).unwrap();
    assert_eq!(input["projections"], json!(["map"]));
    assert!(note.unwrap().starts_with("Checked the projection the viewer shows (map)"));
    let (_, note) = with_view_defaults("describe_part", json!({"part": "renderer"}), Some(&view)).unwrap();
    assert!(note.unwrap().contains("uses the renderer graph"));
    assert!(with_view_defaults("compare", json!({}), None).is_err());
    assert_eq!(with_view_defaults("check", json!({}), None).unwrap(), (json!({}), None));
}

#[test]
fn screenshots_default_to_what_the_viewer_shows() {
    let (input, _) = with_view_defaults("screenshot", json!({"theme": "light"}), Some(&shown())).unwrap();
    assert_eq!(input["theme"], "light", "given values win");
    assert_eq!(input["progress"], 0.5);
    assert_eq!((input["width"].as_u64(), input["height"].as_u64()), (Some(2560), Some(600)));
    assert!(input.get("mode").is_none(), "swipe has no image of its own");
    validate(
        &catalog().into_iter().find(|tool| tool.name == "screenshot").unwrap().input_schema,
        &input,
        "",
    )
    .unwrap();
}

#[test]
fn results_round_trip_with_their_image() {
    let mut outcome = Outcome::new("Rendered".into(), json!({"bytes": 3}));
    outcome.image = Some(vec![1, 2, 3]);
    let json = outcome.json();
    assert_eq!(json["content"][1]["mimeType"], "image/png");
    let back = Outcome::from_json(&json);
    assert_eq!(
        (back.text.as_str(), back.image, back.error),
        ("Rendered", Some(vec![1, 2, 3]), false)
    );
}
