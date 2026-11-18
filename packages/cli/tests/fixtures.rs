use projections_cli::fixtures::{load, renderer_manifest, resolve, validate};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

fn scratch() -> TempDir {
    let root = Path::new("target/fixtures-tests");
    fs::create_dir_all(root).unwrap();
    tempfile::Builder::new().prefix("fixtures-").tempdir_in(root).unwrap()
}

fn write(path: &Path, bytes: impl AsRef<[u8]>) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

fn write_json(path: &Path, value: &Value) {
    write(path, serde_json::to_vec(value).unwrap());
}

fn extraction(label: &str) -> Value {
    json!({
        "protocolVersion": 0, "schema": "graph/v0",
        "entities": [{"id": "a", "kind": "item", "label": label}],
        "relationships": [],
    })
}

fn engine(operation: &str, fields: Value) -> Value {
    let mut request = fields;
    request["version"] = json!(0);
    request["operation"] = json!(operation);
    let response = projections_engine::handle(&serde_json::to_vec(&request).unwrap());
    assert_eq!(response["ok"], true, "{response}");
    response["result"].clone()
}

/// A saved `projections.extraction` document of `extraction`.
fn saved(extraction: &Value) -> Value {
    let commit = "a".repeat(40);
    let extraction = engine("normalize", json!({"extraction": extraction}));
    let canonical = engine("canonicalize", json!({"extraction": extraction}));
    json!({
        "format": "projections.extraction", "version": 0,
        "projection": {"id": "graph", "title": "graph", "renderer": "graph"},
        "extraction": extraction, "digest": canonical["digest"],
        "provenance": {
            "revision": {"kind": "commit", "ref": commit, "commit": commit, "dirty": false},
            "extractor": {"id": "executable", "version": "1"},
            "definition": {"id": "graph", "renderer": "graph", "extractor": {"command": ["true"]}},
            "definitionDigest": format!("sha256:{}", "d".repeat(64)),
            "reproducibility": "local", "limitations": [],
        },
    })
}

/// A comparator file that loads, and refuses every comparison.
const REFUSING: &str = "format: projections.comparator\nversion: 0\nchecks:\n  - assert: size(options) > 99\n    message: \"'refused'\"\n";

fn bundle(directory: &Path, name: &str) {
    write(
        &directory.join("index.html"),
        "<!doctype html><head><title>x</title></head><body></body>",
    );
    write_json(
        &directory.join("renderer.json"),
        &json!({"format": "projections.renderer", "version": 0, "name": name,
            "title": "Custom", "handles": ["graph"]}),
    );
}

fn document(scenarios: Value) -> Value {
    json!({"format": "projections.scenarios", "version": 0, "title": "Graph",
        "renderer": "graph", "scenarios": scenarios})
}

fn scenario<'a>(fixtures: &'a Value, key: &str) -> &'a Value {
    fixtures["scenarios"]
        .as_array()
        .unwrap()
        .iter()
        .find(|scenario| scenario["key"] == key)
        .unwrap_or_else(|| panic!("no scenario {key}: {fixtures:#}"))
}

fn loaded(sources: &[PathBuf], renderers: &[PathBuf]) -> projections_cli::fixtures::Fixtures {
    let (sources, renderers) = resolve(sources, renderers).unwrap();
    load(&sources, &renderers, "/base/", false, true)
}

#[test]
fn scenarios_load_inline_path_and_saved_extractions_with_comparators_and_bundles() {
    if projections_cli::assets::rules_comparator_module().is_none() {
        eprintln!("The rules comparator module is not embedded; build it with npm run build");
        return;
    }
    let scratch = scratch();
    let root = scratch.path().canonicalize().unwrap();
    let graph = root.join("graph");
    write_json(&graph.join("fixtures/before.json"), &extraction("Before"));
    write_json(&graph.join("fixtures/saved.json"), &saved(&extraction("Saved")));
    write(&root.join("comparators/refusing.comparator.yaml"), REFUSING);
    bundle(&graph.join("dist"), "custom");
    write_json(
        &graph.join("scenarios.json"),
        &document(json!([
            {"id": "paths", "title": "Paths", "description": "Both from files",
                "before": "fixtures/before.json", "after": "./fixtures/saved.json",
                "comparator": {"options": {"order": {"by": "dependents"}}},
                "presentation": {"mode": "swipe", "durationMs": 1000, "rendererOptions": {"layout": "horizontal"}}},
            {"id": "inline", "title": "Inline", "group": "Inline group",
                "before": extraction("One"), "after": extraction("Two"),
                "comparator": {"file": "../comparators/refusing.comparator.yaml", "options": {"x": 1}}},
            {"id": "single", "title": "Single", "extraction": "fixtures/saved.json",
                "renderer": {"bundle": "dist"}},
        ])),
    );
    let fixtures = loaded(std::slice::from_ref(&graph), &[]);
    let value = &fixtures.value;
    assert_eq!(
        value["sources"],
        json!([{"key": "graph", "path": graph.join("scenarios.json"), "title": "Graph"}])
    );
    let paths = scenario(value, "graph/paths");
    assert!(paths.get("error").is_none(), "{paths}");
    assert_eq!(paths["source"], "graph");
    assert_eq!(paths["id"], "paths");
    assert_eq!(paths["group"], "Graph");
    assert_eq!(paths["description"], "Both from files");
    assert_eq!(paths["renderer"], "graph");
    assert_eq!(paths["subject"]["mode"], "comparison");
    assert_eq!(paths["subject"]["before"]["entities"][0]["label"], "Before");
    assert_eq!(paths["subject"]["after"]["entities"][0]["label"], "Saved");
    assert_eq!(
        paths["comparator"],
        json!({"default": true, "options": {"order": {"by": "dependents"}}})
    );
    assert_eq!(
        paths["presentation"],
        json!({"mode": "swipe", "durationMs": 1000, "rendererOptions": {"layout": "horizontal"}})
    );
    let inline = scenario(value, "graph/inline");
    assert!(inline.get("error").is_none(), "{inline}");
    assert_eq!(inline["group"], "Inline group");
    assert_eq!(inline["comparator"]["id"], "../comparators/refusing.comparator.yaml");
    assert_eq!(inline["comparator"]["options"], json!({"x": 1}));
    assert_eq!(
        inline["comparator"]["rules"],
        projections_cli::artifact::base64(REFUSING.as_bytes())
    );
    assert!(inline["comparator"]["digest"].as_str().unwrap().starts_with("sha256:"));
    let single = scenario(value, "graph/single");
    assert!(single.get("error").is_none(), "{single}");
    assert_eq!(single["subject"]["mode"], "extraction");
    assert_eq!(single["subject"]["extraction"]["entities"][0]["label"], "Saved");
    assert!(single.get("comparator").is_none());
    let key = single["renderer"]["bundle"].as_str().unwrap();
    assert_eq!(key.len(), 16);
    let renderer = &value["renderers"][0];
    assert_eq!(renderer["key"], key);
    assert_eq!(renderer["path"], json!(graph.join("dist")));
    assert_eq!(renderer["manifest"]["name"], "custom");
    let url = renderer["url"].as_str().unwrap();
    assert!(url.starts_with(&format!("/base/{key}/index.html?v=")) && url.len() == 6 + 16 + 14 + 16);
    assert_eq!(fixtures.bundles[key], graph.join("dist"));
    for path in [
        "scenarios.json",
        "fixtures/before.json",
        "fixtures/saved.json",
        "dist/index.html",
        "dist/renderer.json",
    ] {
        assert!(fixtures.watched.contains(&graph.join(path)), "{path}");
    }
    assert!(fixtures.watched.contains(&root.join("comparators/refusing.comparator.yaml")));
    // Validation also runs every comparator, and this one refuses.
    let message = validate(&graph.join("scenarios.json")).unwrap_err().to_string();
    assert!(message.contains("graph/inline"), "{message}");
    assert!(message.contains("refused"), "{message}");
    assert!(!message.contains("graph/paths"), "{message}");
    let mut valid = document(json!([]));
    valid["scenarios"] = json!([
        {"id": "paths", "title": "Paths", "before": "graph/fixtures/before.json",
            "after": "graph/fixtures/saved.json"},
        {"id": "single", "title": "Single", "extraction": "graph/fixtures/saved.json",
            "renderer": {"bundle": "graph/dist"}},
    ]);
    write_json(&root.join("valid.scenarios.json"), &valid);
    assert_eq!(validate(&root.join("valid.scenarios.json")).unwrap(), 2);

    // The URL digest changes only when the bundle does.
    let reloaded = loaded(std::slice::from_ref(&graph), &[]);
    assert_eq!(reloaded.value["renderers"][0]["url"], url);
    write(&graph.join("dist/index.html"), "<!doctype html>changed");
    let changed = loaded(std::slice::from_ref(&graph), &[]);
    assert_ne!(changed.value["renderers"][0]["url"], url);
    assert_eq!(changed.value["renderers"][0]["key"], key);
}

#[test]
fn renderer_directories_packages_and_scenario_bundles_are_deduplicated() {
    let scratch = scratch();
    let root = scratch.path().canonicalize().unwrap();
    let package = root.join("graph");
    bundle(&package.join("dist"), "graph");
    write_json(
        &package.join("package.json"),
        &json!({"name": "graph", "projections": {"renderer": "dist"}}),
    );
    write_json(
        &package.join("scenarios.json"),
        &json!({"format": "projections.scenarios", "version": 0,
            "renderer": {"bundle": "dist"},
            "scenarios": [{"id": "one", "title": "One", "extraction": extraction("A")}]}),
    );
    let plain = root.join("plain");
    bundle(&plain, "plain");
    let broken = root.join("broken");
    fs::create_dir_all(&broken).unwrap();
    let fixtures = loaded(std::slice::from_ref(&package), &[package.clone(), plain.clone(), broken]);
    let renderers = fixtures.value["renderers"].as_array().unwrap();
    assert_eq!(renderers.len(), 3, "{renderers:#?}");
    assert_eq!(renderers[0]["path"], json!(package.join("dist")));
    assert_eq!(renderers[0]["manifest"]["name"], "graph");
    assert_eq!(renderers[1]["manifest"]["name"], "plain");
    assert!(renderers[2]["error"].as_str().unwrap().contains("package.json"));
    let one = scenario(&fixtures.value, "graph/one");
    assert_eq!(one["renderer"], json!({"bundle": renderers[0]["key"]}));
    assert_eq!(one["group"], "graph");
    assert!(fixtures.watched.contains(&package.join("package.json")));

    let invalid = root.join("invalid");
    bundle(&invalid, "Invalid Name");
    let fixtures = loaded(&[], &[invalid]);
    assert!(
        fixtures.value["renderers"][0]["error"]
            .as_str()
            .unwrap()
            .contains("lowercase identifier")
    );
    assert!(fixtures.bundles.is_empty());
}

#[test]
fn source_keys_come_from_file_and_directory_names_and_duplicates_get_suffixes() {
    let scratch = scratch();
    let root = scratch.path().canonicalize().unwrap();
    let body = document(json!([{"id": "s", "title": "S", "extraction": extraction("A")}]));
    let mut untitled = body.clone();
    untitled.as_object_mut().unwrap().remove("title");
    write_json(&root.join("a/graph/scenarios.json"), &body);
    write_json(&root.join("b/graph.json"), &untitled);
    write_json(&root.join("c/graph.scenarios.json"), &body);
    write_json(&root.join("d/other.scenarios.json"), &untitled);
    let fixtures = loaded(
        &[
            root.join("a/graph"),
            root.join("b/graph.json"),
            root.join("c/graph.scenarios.json"),
            root.join("d/other.scenarios.json"),
            root.join("a/graph/scenarios.json"),
        ],
        &[],
    );
    let keys: Vec<_> = fixtures.value["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|source| source["key"].clone())
        .collect();
    assert_eq!(keys, vec!["graph", "graph-2", "graph-3", "other"]);
    let groups: Vec<_> = fixtures.value["scenarios"]
        .as_array()
        .unwrap()
        .iter()
        .map(|scenario| (scenario["key"].clone(), scenario["group"].clone()))
        .collect();
    assert_eq!(
        groups,
        vec![
            (json!("graph/s"), json!("Graph")),
            (json!("graph-2/s"), json!("graph-2")),
            (json!("graph-3/s"), json!("Graph")),
            (json!("other/s"), json!("other")),
        ]
    );
    assert!(resolve(&[root.join("missing.json")], &[]).is_err());
    assert!(resolve(&[root.join("b")], &[]).is_err());
    assert!(resolve(&[], &[root.join("missing")]).is_err());
}

#[test]
fn invalid_scenarios_are_reported_as_entries() {
    let scratch = scratch();
    let root = scratch.path().canonicalize().unwrap();
    let good = extraction("A");
    write(&root.join("bad.json"), "{not json");
    write(&root.join("module.wasm"), "not wasm");
    write_json(
        &root.join("scenarios.json"),
        &json!({"format": "projections.scenarios", "version": 0, "scenarios": [
            {"id": "unknown", "title": "Unknown", "extraction": good, "renderer": "graph", "extra": 1},
            {"id": "both", "title": "Both", "extraction": good, "before": good, "after": good, "renderer": "graph"},
            {"id": "single", "title": "Single", "extraction": good, "renderer": "graph",
                "comparator": {"options": {}}},
            {"id": "bad id", "title": "Bad id", "extraction": good, "renderer": "graph"},
            {"id": "dup", "title": "First", "extraction": good, "renderer": "graph"},
            {"id": "dup", "title": "Second", "extraction": good, "renderer": "graph"},
            {"id": "norenderer", "title": "No renderer", "extraction": good},
            {"id": "absolute", "title": "Absolute", "extraction": "/etc/passwd", "renderer": "graph"},
            {"id": "scheme", "title": "Scheme", "extraction": "file:x.json", "renderer": "graph"},
            {"id": "missing", "title": "Missing", "extraction": "missing.json", "renderer": "graph"},
            {"id": "broken", "title": "Broken", "extraction": "bad.json", "renderer": "graph"},
            {"id": "invalid", "title": "Invalid", "renderer": "graph",
                "extraction": {"protocolVersion": 0, "schema": "graph/v0", "entities": [{"id": "a"}], "relationships": []}},
            {"id": "options", "title": "Options", "before": good, "after": good, "renderer": "graph",
                "comparator": {"options": {"order": {"by": "nothing"}}}},
            {"id": "module", "title": "Module", "before": good, "after": good, "renderer": "graph",
                "comparator": {"module": "module.wasm"}},
            {"id": "rules", "title": "Rules", "before": good, "after": good, "renderer": "graph",
                "comparator": {"rules": "x.comparator.yaml"}},
            {"id": "file", "title": "File", "before": good, "after": good, "renderer": "graph",
                "comparator": {"file": "module.wasm"}},
            {"id": "named", "title": "Named", "before": good, "after": good, "renderer": "graph",
                "comparator": "x.rules.yaml"},
            {"id": "presentation", "title": "Presentation", "extraction": good, "renderer": "graph",
                "presentation": {"mode": "zoom"}},
            {"id": "ok", "title": "Ok", "extraction": good, "renderer": "graph"},
        ]}),
    );
    let fixtures = loaded(&[root.join("scenarios.json")], &[]);
    let value = &fixtures.value;
    let source = value["sources"][0]["key"].as_str().unwrap().to_owned();
    let error = |key: &str| {
        scenario(value, &format!("{source}/{key}"))["error"]
            .as_str()
            .unwrap_or_else(|| panic!("{key} has no error"))
            .to_owned()
    };
    assert!(error("unknown").contains("unknown field extra"));
    assert!(error("both").contains("not both"));
    assert!(error("single").contains("requires before and after"));
    assert!(error("#3").contains("filename-safe"));
    assert_eq!(scenario(value, &format!("{source}/#3"))["id"], "bad id");
    assert!(scenario(value, &format!("{source}/dup")).get("error").is_none());
    assert!(error("#5").contains("Duplicate scenario id dup"));
    assert!(error("norenderer").contains("no renderer"));
    assert!(error("absolute").contains("relative path"));
    assert!(error("scheme").contains("relative path"));
    assert!(error("missing").contains("does not exist"));
    assert!(error("broken").contains("bad.json"));
    assert!(error("invalid").contains("not a valid extraction"));
    assert!(error("options").contains("options are invalid"));
    assert!(error("module").contains("unknown field"));
    assert!(error("rules").contains("comparator.rules was renamed"));
    assert!(error("file").contains("comparator.file must name a comparator file"));
    assert!(error("named").contains("comparator must name a comparator file"));
    assert!(error("presentation").contains("presentation.mode"));
    let ok = scenario(value, &format!("{source}/ok"));
    assert!(ok.get("error").is_none());
    let failed = scenario(value, &format!("{source}/missing"));
    assert!(failed.get("subject").is_none());
    assert_eq!(failed["title"], "Missing");
    assert_eq!(failed["group"], source);
    let message = validate(&root.join("scenarios.json")).unwrap_err().to_string();
    assert!(message.contains("Duplicate scenario id"), "{message}");

    for (name, body) in [
        ("format", json!({"format": "projections.other", "version": 0, "scenarios": []})),
        (
            "field",
            json!({"format": "projections.scenarios", "version": 0, "scenarios": [], "x": 1}),
        ),
        ("list", json!({"format": "projections.scenarios", "version": 0, "scenarios": {}})),
    ] {
        let path = root.join(format!("{name}.json"));
        write_json(&path, &body);
        let fixtures = loaded(&[path], &[]);
        assert!(fixtures.value["sources"][0]["error"].is_string(), "{name}: {}", fixtures.value);
        assert_eq!(fixtures.value["scenarios"], json!([]));
    }
}

#[test]
fn renderer_manifests_keep_valid_accepts_and_reject_invalid_ones() {
    let manifest = json!({"format": "projections.renderer", "version": 0, "name": "di", "title": "DI", "handles": [],
        "accepts": [{"schema": "architecture/v0", "vocabulary": "dependency-injection/v0"}, {"schema": "graph/v0"}]});
    assert_eq!(renderer_manifest(&manifest).unwrap(), manifest);
    for accepts in [
        json!([]),
        json!("graph/v0"),
        json!([{"schema": "nodes/v0"}]),
        json!([{"schema": "graph/v0", "vocabulary": "unknown/v0"}]),
        json!([{"schema": "graph/v0"}, {"schema": "graph/v0"}]),
        json!([{"schema": "graph/v0", "extra": true}]),
    ] {
        let mut invalid = manifest.clone();
        invalid["accepts"] = accepts.clone();
        assert!(renderer_manifest(&invalid).is_err(), "{accepts}");
    }
}

#[test]
fn renderer_manifests_keep_valid_comparison_modes_and_reject_invalid_ones() {
    let manifest = json!({"format": "projections.renderer", "version": 0, "name": "plan",
        "title": "Plan", "handles": ["plan"], "comparisonModes": ["diff", "side-by-side"]});
    assert_eq!(renderer_manifest(&manifest).unwrap(), manifest);
    let mut plain = manifest.clone();
    plain.as_object_mut().unwrap().remove("comparisonModes");
    assert_eq!(renderer_manifest(&plain).unwrap(), plain);
    for modes in [json!([]), json!(["diff", "diff"]), json!(["morph"]), json!("diff"), json!([1])] {
        let mut invalid = manifest.clone();
        invalid["comparisonModes"] = modes.clone();
        assert!(renderer_manifest(&invalid).is_err(), "{modes}");
    }
}
