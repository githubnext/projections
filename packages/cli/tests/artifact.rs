use projections_cli::artifact::{
    MAX_ARTIFACT_BYTES, MAX_DOCUMENT_BYTES, base64, byte_sha256, compare_extractions, compare_extractions_with, parse, read_artifact,
    read_document, validate_comparison, validate_comparison_with, validate_definition, validate_extraction,
};
use serde_json::{Value, json};
use std::fs;
use std::path::Path;
use tempfile::TempDir;

const COMMIT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn scratch() -> TempDir {
    let root = Path::new("target/artifact-tests");
    fs::create_dir_all(root).unwrap();
    tempfile::Builder::new().prefix("artifact-").tempdir_in(root).unwrap()
}

fn engine(operation: &str, fields: Value) -> Value {
    let mut request = fields;
    request["version"] = json!(0);
    request["operation"] = json!(operation);
    let response = projections_engine::handle(&serde_json::to_vec(&request).unwrap());
    assert_eq!(response["ok"], true, "{response}");
    response["result"].clone()
}

const DEFINITION_DIGEST: &str = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

fn saved(id: &str, label: &str) -> Value {
    let extraction = engine(
        "normalize",
        json!({"extraction": {
            "protocolVersion": 0, "schema": "metrics/v0",
            "entities": [{
                "id": "size", "kind": "metric", "label": label, "data": {"value": 3},
                "evidence": [{"kind": "fixture", "source": "facts.json"}],
            }],
            "relationships": [],
        }}),
    );
    let canonical = engine("canonicalize", json!({"extraction": extraction}));
    json!({
        "format": "projections.extraction", "version": 0,
        "projection": {"id": id, "title": id, "renderer": "code-statistics"},
        "extraction": extraction, "digest": canonical["digest"],
        "provenance": {
            "revision": {"kind": "commit", "ref": COMMIT, "commit": COMMIT, "dirty": false},
            "extractor": {"id": "executable", "version": "1"},
            "definition": {
                "id": id, "renderer": "code-statistics", "extractor": {"command": ["python3", "collect.py"]},
            },
            "definitionDigest": DEFINITION_DIGEST,
            "reproducibility": "local", "limitations": [],
        },
    })
}

fn write_json(path: &Path, value: &Value) {
    fs::write(path, serde_json::to_vec(value).unwrap()).unwrap();
}

fn refresh_digest(value: &mut Value) {
    value["digest"] = engine("canonicalize", json!({"extraction": value["extraction"]}))["digest"].clone();
}

fn error_contains<T: std::fmt::Debug>(result: anyhow::Result<T>, message: &str) {
    let error = format!("{:#}", result.unwrap_err());
    assert!(error.contains(message), "expected {message:?}, got {error}");
}

#[test]
fn raw_json_reaches_strict_native_parser_without_duplicate_loss() {
    for raw in [
        r#"{"format":"projections.extraction","format":"projections.extraction"}"#,
        r#"{"configuration":{"id":"one","\u0069d":"two"}}"#,
        r#"{"value":9007199254740992}"#,
        r#"{"value":1e100}"#,
        r#"{"value":1e999}"#,
        r#"{"value":"\ud800"}"#,
        r#"{"value":"\udfff"}"#,
        r#"{} true"#,
        r#"{"value":01}"#,
        r#"{"value":true,}"#,
        r#"[NaN]"#,
    ] {
        assert!(parse(raw).is_err(), "accepted {raw}");
    }
    let deep = format!("{}0{}", "[".repeat(65), "]".repeat(65));
    assert!(parse(&deep).is_err());
    assert_eq!(
        parse(r#"{"value":9007199254740991,"unicode":"\ud83d\ude00"}"#).unwrap()["unicode"],
        "😀"
    );
    assert_eq!(parse("null").unwrap(), Value::Null);
}

#[test]
fn definition_accepts_exact_native_contract_and_preserves_explicit_options() {
    let definition = json!({
        "id": "package.metrics-1", "renderer": "code-statistics",
        "title": "Package metrics", "description": "Count dependencies",
        "extractor": {"command": ["python3", "collect.py", "", "😀"]},
        "inputs": {"nested": [true, null, 1.5, {"name": "sample"}]},
        "correspondence": {"previous metric": ["old", "older"]},
        "execution": {
            "timeoutMs": 300000, "environment": ["PATH", "_TOKEN"],
            "network": false, "reproducibility": "pinned-toolchain",
        },
    });
    assert_eq!(validate_definition(&definition).unwrap(), definition);
    let minimal = json!({"id": "parser", "renderer": "graph", "extractor": "parser"});
    assert_eq!(validate_definition(&minimal).unwrap(), minimal);
    let mut integer_float = minimal.clone();
    integer_float["execution"] = json!({"timeoutMs": 1.0});
    assert_eq!(validate_definition(&integer_float).unwrap()["execution"]["timeoutMs"], 1);
    let components = json!({
        "id": "flags", "title": "Feature flags",
        "extractor": {"command": ["python3", "tools/flags.py"], "sources": ["tools/flags.py", "tools/lib"]},
        "comparator": {"options": {"order": {"by": "data.rollout", "direction": "ascending"}}},
        "renderer": {"bundle": "renderers/flags/dist", "sources": ["renderers/flags/dist"]},
    });
    assert_eq!(validate_definition(&components).unwrap(), components);
    for comparator in [
        json!({}),
        json!({"options": {}}),
        json!({"options": {"order": {"by": "dependents"}}}),
        json!({"file": "tools/compare.comparator.yaml", "sources": ["tools/lib.yaml"], "options": {"any": [1]}}),
    ] {
        let mut definition = minimal.clone();
        definition["comparator"] = comparator.clone();
        assert_eq!(validate_definition(&definition).unwrap()["comparator"], comparator);
    }
}

#[test]
fn definition_rejects_unknown_missing_null_and_malformed_fields() {
    let original = json!({"id": "metric", "renderer": "code-statistics", "extractor": "parser"});
    for (key, value) in [
        ("id", json!("../escape")),
        ("id", json!("a".repeat(101))),
        ("id", json!("é")),
        ("renderer", json!("")),
        ("renderer", json!({"bundle": "dist/../outside"})),
        ("renderer", json!({"bundle": "dist", "url": "https://example.com"})),
        ("extractor", Value::Null),
        ("extractor", json!({"command": []})),
        ("extractor", json!({"command": [""]})),
        ("extractor", json!({"command": ["python3", "bad\0arg"]})),
        ("extractor", json!({"command": ["python3"], "shell": true})),
        ("extractor", json!({"command": vec!["arg"; 257]})),
        ("extractor", json!({"command": ["python3"], "sources": ["/absolute"]})),
        ("extractor", json!({"command": ["python3"], "sources": ["a", "a"]})),
        ("extractor", json!({"command": ["python3"], "sources": ["a/../b"]})),
        ("collector", json!("parser")),
        ("comparator", json!("default")),
        ("comparator", json!({"options": {"order": {"by": "size"}}})),
        ("comparator", json!({"options": {"order": {"by": "dependents", "direction": "up"}}})),
        ("comparator", json!({"options": {"unknown": true}})),
        ("comparator", json!({"module": "tools/compare.wasm"})),
        ("comparator", json!({"rules": "tools/compare.comparator.yaml"})),
        ("comparator", json!({"file": "tools/compare.js"})),
        ("comparator", json!({"file": "tools/compare.yaml"})),
        ("comparator", json!("tools/compare.yaml")),
        ("comparator", json!("tools/../compare.comparator.yaml")),
        ("execution", json!({"scope": ["src/../lib"]})),
        ("comparator", json!({"file": "tools/compare.comparator.yaml", "url": "x"})),
        ("title", json!("\u{feff}")),
        ("description", Value::Null),
        ("inputs", json!([])),
        ("inputs", json!({"integer": 9_007_199_254_740_992_u64})),
        ("correspondence", json!({"": ["alias"]})),
        ("correspondence", json!({"old": ["alias", "alias"]})),
        ("execution", json!({"timeoutMs": 0})),
        ("execution", json!({"timeoutMs": 300001})),
        ("execution", json!({"timeoutMs": 1.5})),
        ("execution", json!({"environment": ["PATH", "PATH"]})),
        ("execution", json!({"environment": ["1BAD"]})),
        ("execution", json!({"environment": ["BAD-NAME"]})),
        ("execution", json!({"network": "false"})),
        ("execution", json!({"reproducibility": "guaranteed"})),
        ("execution", json!({"unknown": true})),
        ("unknown", json!(true)),
    ] {
        let mut definition = original.clone();
        definition[key] = value;
        assert!(validate_definition(&definition).is_err(), "accepted {definition}");
    }
    for field in ["id", "renderer", "extractor"] {
        let mut definition = original.clone();
        definition.as_object_mut().unwrap().remove(field);
        assert!(validate_definition(&definition).is_err());
    }
    // Paths are relative to the definition's project: leading `..` segments leave a nested one.
    for (key, value) in [
        ("comparator", json!("../compare.comparator.yaml")),
        ("extractor", json!({"command": ["python3"], "sources": ["../../shared", ".."]})),
        ("execution", json!({"scope": [".", "../shared/"]})),
    ] {
        let mut definition = original.clone();
        definition[key] = value;
        assert!(validate_definition(&definition).is_ok(), "rejected {definition}");
    }
}

#[test]
fn extraction_normalizes_with_shared_engine_and_checks_semantic_digest() {
    let original = saved("metric", "Size");
    assert_eq!(validate_extraction(&original).unwrap(), original);
    let mut evidence_only = original.clone();
    evidence_only["extraction"]["entities"][0]["evidence"][0]["source"] = json!("moved/facts.json");
    evidence_only["extraction"]["metadata"] = json!({"generated": "different"});
    validate_extraction(&evidence_only).unwrap();
    let mut changed = original.clone();
    changed["extraction"]["entities"][0]["data"]["value"] = json!(999);
    error_contains(validate_extraction(&changed), "digest mismatch");
    changed["digest"] = json!(original["digest"].as_str().unwrap().to_ascii_uppercase());
    error_contains(validate_extraction(&changed), "digest mismatch");
    let mut invalid_state = original.clone();
    invalid_state["extraction"]["entities"][0]["unexpected"] = json!(true);
    assert!(validate_extraction(&invalid_state).is_err());
}

#[test]
fn extraction_requires_exact_envelope_and_provenance_fields() {
    let original = saved("metric", "Size");
    for pointer in [
        "",
        "/projection",
        "/provenance",
        "/provenance/revision",
        "/provenance/extractor",
        "/provenance/definition",
    ] {
        let mut value = original.clone();
        value.pointer_mut(pointer).unwrap()["unknown"] = json!(true);
        error_contains(validate_extraction(&value), "unknown field");
    }
    for pointer in [
        "/projection/id",
        "/projection/title",
        "/projection/renderer",
        "/provenance/revision/dirty",
        "/provenance/extractor/version",
        "/provenance/limitations",
        "/provenance/reproducibility",
        "/provenance/definitionDigest",
        "/digest",
    ] {
        let mut value = original.clone();
        *value.pointer_mut(pointer).unwrap() = Value::Null;
        assert!(validate_extraction(&value).is_err(), "accepted null {pointer}");
    }
    for (pointer, changed) in [
        ("/version", json!(1)),
        ("/format", json!("projections.snapshot")),
        ("/provenance/definitionDigest", json!("d".repeat(64))),
        ("/provenance/definitionDigest", json!(format!("sha256:{}", "D".repeat(64)))),
        ("/projection/id", json!("other")),
        ("/projection/title", json!("Other title")),
        ("/projection/renderer", json!("graph")),
        ("/provenance/extractor/id", json!("parser")),
        ("/provenance/revision/ref", json!("HEAD")),
        ("/provenance/revision/dirty", json!(true)),
        ("/provenance/revision/commit", json!("A".repeat(40))),
        ("/provenance/revision/kind", json!("branch")),
        ("/provenance/limitations", json!(["same", "same"])),
        ("/provenance/reproducibility", json!("guaranteed")),
        ("/provenance/toolchain", json!({"python": ""})),
        ("/provenance/toolchain", json!({"": "1"})),
    ] {
        let mut value = original.clone();
        if pointer == "/provenance/toolchain" {
            value["provenance"]["toolchain"] = changed;
        } else {
            *value.pointer_mut(pointer).unwrap() = changed;
        }
        assert!(validate_extraction(&value).is_err(), "accepted {value}");
    }
}

#[test]
fn extraction_preserves_explicit_toolchain_title_and_working_tree_provenance() {
    let mut value = saved("metric", "Size");
    value["provenance"]["definition"]["title"] = json!("Named metric");
    value["projection"]["title"] = json!("Named metric");
    value["provenance"]["toolchain"] = json!({"python": "3.12", "rust": "1.85"});
    value["provenance"]["revision"]["kind"] = json!("working-tree");
    value["provenance"]["revision"]["ref"] = json!("working-tree");
    value["provenance"]["revision"]["dirty"] = json!(true);
    assert_eq!(validate_extraction(&value).unwrap(), value);
    value["provenance"]["revision"]["ref"] = json!("HEAD");
    error_contains(validate_extraction(&value), "Working-tree provenance");
}

#[test]
fn comparison_is_recomputed_and_rejects_supplied_claim_tampering() {
    let before = saved("metric", "Before");
    let after = saved("metric", "After");
    let comparison = compare_extractions(&before, &after).unwrap();
    assert_eq!(
        comparison["comparison"]["changes"],
        json!([{"id": "size", "collection": "entities", "before": ["size"], "after": ["size"],
            "status": "modified", "correspondence": "exact"}])
    );
    assert_eq!(
        comparison["comparison"]["steps"],
        json!([{"changes": ["size"], "kind": "restructure"}])
    );
    let digest = comparison["comparator"]["digest"].as_str().unwrap();
    assert_eq!(comparison["comparator"]["id"], "default");
    assert!(digest.starts_with("sha256:") && digest.len() == 71);
    assert_eq!(validate_comparison(&comparison).unwrap(), comparison);
    let mut float_version = comparison.clone();
    float_version["comparison"]["protocolVersion"] = json!(0.0);
    assert_eq!(validate_comparison(&float_version).unwrap(), comparison);
    for pointer in [
        "/comparison/changes",
        "/comparison/changes/0/status",
        "/comparison/steps",
        "/comparison",
        "/comparator",
        "/comparator/digest",
        "/before/digest",
    ] {
        let mut value = comparison.clone();
        *value.pointer_mut(pointer).unwrap() = Value::Null;
        assert!(validate_comparison(&value).is_err(), "accepted {value}");
    }
    let mut extra = comparison.clone();
    extra["comparison"]["metadata"] = json!({"forged": true});
    error_contains(validate_comparison(&extra), "does not match the comparator");
    extra = comparison.clone();
    extra["comparison"]["changes"][0]["summary"] = json!("Forged explanation");
    error_contains(validate_comparison(&extra), "does not match the comparator");
    extra = comparison.clone();
    extra["comparator"]["digest"] = json!(format!("sha256:{}", "0".repeat(64)));
    error_contains(validate_comparison(&extra), "different comparator");
    extra = comparison.clone();
    extra["extra"] = json!(true);
    error_contains(validate_comparison(&extra), "unknown field");
    let mut redefined = after.clone();
    redefined["provenance"]["definitionDigest"] = json!(format!("sha256:{}", "e".repeat(64)));
    error_contains(compare_extractions(&before, &redefined), "declared component sources differ");
    redefined["provenance"]["definition"]["description"] = json!("Changed");
    error_contains(compare_extractions(&before, &redefined), "projection definition itself differs");
    let mut custom = after.clone();
    let mut custom_before = before.clone();
    for document in [&mut custom, &mut custom_before] {
        document["provenance"]["definition"]["comparator"] = json!({"file": "tools/compare.comparator.yaml"});
    }
    error_contains(
        compare_extractions(&custom_before, &custom),
        "supply that file from the definition's revision",
    );
    let mut incompatible = after.clone();
    incompatible["extraction"]["schema"] = json!("graph/v0");
    refresh_digest(&mut incompatible);
    error_contains(compare_extractions(&before, &incompatible), "share one domain schema");
    error_contains(compare_extractions(&before, &saved("other", "After")), "different projections");
    let unchanged = compare_extractions(&before, &before).unwrap();
    assert_eq!(unchanged["comparison"]["changes"], json!([]));
}

#[test]
fn document_reader_rejects_oversized_json_before_parsing() {
    error_contains(parse(&" ".repeat(MAX_DOCUMENT_BYTES + 1)), "json-size-limit");
}

#[test]
fn file_readers_reject_invalid_utf8_duplicate_keys_and_unrecognized_documents() {
    let root = scratch();
    let filename = root.path().join("document.json");
    for raw in [
        b"\xff".as_slice(),
        br#"{"format":"projections.extraction","format":"projections.extraction"}"#,
        br#"{"format":"projections.manifest","version":0}"#,
        b"[]",
        b"null",
    ] {
        fs::write(&filename, raw).unwrap();
        assert!(read_document(&filename).is_err());
    }
    let comparison = compare_extractions(&saved("metric", "Before"), &saved("metric", "After")).unwrap();
    write_json(&filename, &comparison);
    assert_eq!(read_document(&filename).unwrap(), comparison);
    let mut altered = comparison;
    altered["comparison"]["changes"][0]["status"] = json!("unchanged");
    write_json(&filename, &altered);
    error_contains(read_document(&filename), "does not match the comparator");
}

#[test]
fn byte_limits_are_enforced_on_actual_files() {
    let root = scratch();
    let filename = root.path().join("bounded.json");
    fs::write(&filename, vec![b'x'; 100]).unwrap();
    assert_eq!(read_artifact(&filename, 100).unwrap().len(), 100);
    error_contains(read_artifact(&filename, 99), "<= 99 bytes");
    let file = fs::File::create(&filename).unwrap();
    file.set_len((MAX_DOCUMENT_BYTES + 1) as u64).unwrap();
    error_contains(read_document(&filename), "regular file");
    let value = saved("metric", "Size");
    let mut bytes = serde_json::to_vec(&value).unwrap();
    bytes.resize(MAX_ARTIFACT_BYTES, b' ');
    fs::write(&filename, &bytes).unwrap();
    assert_eq!(read_document(&filename).unwrap(), value);
    bytes.push(b' ');
    fs::write(&filename, &bytes).unwrap();
    error_contains(read_document(&filename), "Extraction artifact exceeds byte limit");
    assert!(read_artifact(root.path(), 100).is_err());
}

#[test]
fn comparison_reader_accepts_its_exact_byte_limit() {
    let root = scratch();
    let snapshot = saved("metric", "Size");
    let comparison = compare_extractions(&snapshot, &snapshot).unwrap();
    let filename = root.path().join("comparison.json");
    let mut bytes = serde_json::to_vec(&comparison).unwrap();
    bytes.resize(MAX_DOCUMENT_BYTES, b' ');
    fs::write(&filename, &bytes).unwrap();
    assert_eq!(read_document(&filename).unwrap(), comparison);
    bytes.push(b' ');
    fs::write(&filename, &bytes).unwrap();
    error_contains(read_document(&filename), "regular file");
}

#[cfg(unix)]
#[test]
fn artifact_readers_reject_symlinks_and_special_files() {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::symlink;

    let root = scratch();
    let saved_file = root.path().join("metric.json");
    write_json(&saved_file, &saved("metric", "Size"));
    let link = root.path().join("link.json");
    symlink("metric.json", &link).unwrap();
    error_contains(read_document(&link), "symlink");
    let fifo = root.path().join("pipe");
    let cpath = std::ffi::CString::new(fifo.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(cpath.as_ptr(), 0o600) }, 0);
    error_contains(read_artifact(&fifo, 100), "regular file");
}

#[test]
fn sha256_git_revisions_are_supported() {
    let revision = "a".repeat(64);
    let mut value = saved("metric", "Size");
    value["provenance"]["revision"]["commit"] = json!(revision);
    value["provenance"]["revision"]["ref"] = json!(revision);
    validate_extraction(&value).unwrap();
}

#[test]
fn base64_matches_the_standard_alphabet_and_padding() {
    assert_eq!(base64(b""), "");
    assert_eq!(base64(b"f"), "Zg==");
    assert_eq!(base64(b"fo"), "Zm8=");
    assert_eq!(base64(b"foo"), "Zm9v");
    assert_eq!(base64(&[0xfb, 0xff, 0xbf]), "+/+/");
}

fn ruled(document: &Value, options: Value) -> Value {
    let mut document = document.clone();
    document["provenance"]["definition"]["comparator"] = json!({"file": "tools/order.comparator.yaml", "options": options});
    document
}

#[test]
fn comparator_files_are_definitions_and_join_the_digest() {
    for file in ["tools/order.comparator.yaml", "tools/order.comparator.yml"] {
        // A string names the file alone; `{file, options}` adds options. Both
        // normalize to the object form, so they have one digest.
        for comparator in [json!(file), json!({"file": file})] {
            let definition = validate_definition(&json!({"id": "x", "renderer": "graph",
                "extractor": "repository-map", "comparator": comparator}))
            .unwrap();
            assert_eq!(definition["comparator"], json!({"file": file}));
        }
        let definition = validate_definition(&json!({"id": "x", "renderer": "graph",
            "extractor": "repository-map", "comparator": {"file": file, "options": {"a": 1}}}))
        .unwrap();
        assert_eq!(definition["comparator"]["file"], file);
        assert_eq!(projections_cli::artifact::definition_sources(&definition), vec![file.to_owned()]);
    }
    for file in ["tools/order.json", "tools/order.yaml", "tools/order.rules.yaml"] {
        error_contains(
            validate_definition(&json!({"id": "x", "renderer": "graph",
                "extractor": "repository-map", "comparator": file})),
            "comparator must name a comparator file, ending in `.comparator.yaml` or `.comparator.yml`",
        );
        error_contains(
            validate_definition(&json!({"id": "x", "renderer": "graph",
                "extractor": "repository-map", "comparator": {"file": file}})),
            "comparator.file must name a comparator file",
        );
    }
    error_contains(
        validate_definition(&json!({"id": "x", "renderer": "graph",
            "extractor": "repository-map", "comparator": {"file": "x.comparator.yaml", "module": "y.wasm"}})),
        "Module comparators were removed",
    );
    // Comparator files are the only custom comparators; a module comparator says how to migrate.
    for module in ["tools/compare.wasm", "tools/compare.js"] {
        error_contains(
            validate_definition(&json!({"id": "x", "renderer": "graph",
                "extractor": "repository-map", "comparator": {"module": module}})),
            "name a comparator file instead",
        );
    }
    // The `rules` key was renamed; the message says how to migrate.
    for rules in ["tools/order.rules.yaml", "tools/order.comparator.yaml"] {
        let error = validate_definition(&json!({"id": "x", "renderer": "graph",
            "extractor": "repository-map", "comparator": {"rules": rules, "options": {"a": 1}}}))
        .unwrap_err();
        assert_eq!(
            projections_cli::artifact::error_pointer(&error).as_deref(),
            Some("/comparator/rules")
        );
        let message = error.to_string();
        assert!(
            message.starts_with("`comparator.rules` was renamed: name the file directly, `\"comparator\": \"<path>.comparator.yaml\"`, or `{\"file\": \"<path>.comparator.yaml\", \"options\": {...}}`; comparator files end in `.comparator.yaml`. See https://"),
            "{message}"
        );
    }
}

#[test]
fn rules_comparators_run_in_the_embedded_interpreter_and_are_validated() {
    if projections_cli::assets::rules_comparator_module().is_none() {
        eprintln!("The rules comparator module is not embedded; build it with npm run build");
        return;
    }
    let rules = fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../examples/comparators/priority-order/priority-order.comparator.yaml"
    ))
    .unwrap();
    let (before, after) = (
        ruled(&saved("metric", "Before"), json!({"priority": ["size"]})),
        ruled(&saved("metric", "After"), json!({"priority": ["size"]})),
    );
    let comparison = compare_extractions_with(&before, &after, Some(&rules)).unwrap();
    assert_eq!(comparison["comparator"]["id"], "tools/order.comparator.yaml");
    assert_eq!(comparison["comparison"]["changes"][0]["status"], "modified");
    let digest = comparison["comparator"]["digest"].as_str().unwrap().to_owned();
    assert_ne!(digest, format!("sha256:{}", byte_sha256(&rules)));
    assert_eq!(validate_comparison_with(&comparison, Some(&rules)).unwrap(), comparison);
    // Without the rules the Engine still checks consistency, so a saved
    // comparison can't hide or invent changes.
    assert_eq!(validate_comparison(&comparison).unwrap(), comparison);
    let mut hidden = comparison.clone();
    hidden["comparison"]["changes"] = json!([]);
    hidden["comparison"]["steps"] = json!([]);
    assert!(validate_comparison(&hidden).is_err());
    let mut forged = comparison.clone();
    forged["comparator"]["digest"] = json!(format!("sha256:{}", "0".repeat(64)));
    error_contains(validate_comparison_with(&forged, Some(&rules)), "different comparator");
    error_contains(
        compare_extractions_with(&saved("metric", "Before"), &saved("metric", "After"), Some(&rules)),
        "supplied unnecessarily",
    );
    // Comments and layout don't change what the rules mean, or their digest.
    let mut commented = b"# Reformatted\n".to_vec();
    commented.extend_from_slice(&rules);
    commented.extend_from_slice(b"\n\n");
    assert_eq!(validate_comparison_with(&comparison, Some(&commented)).unwrap(), comparison);
    // A change to what they mean does.
    let edited = String::from_utf8(rules.clone())
        .unwrap()
        .replace("most\n  important", "most\n  urgent");
    assert_ne!(edited.as_bytes(), rules.as_slice());
    error_contains(
        validate_comparison_with(&comparison, Some(edited.as_bytes())),
        "different comparator",
    );
    // The rules' own checks reject invalid options.
    error_contains(
        compare_extractions_with(
            &ruled(&saved("metric", "Before"), json!({"priorities": []})),
            &ruled(&saved("metric", "After"), json!({"priorities": []})),
            Some(&rules),
        ),
        "unknown field `priorities`",
    );
    // Invalid rules are reported with the YAML line and column.
    error_contains(
        compare_extractions_with(
            &before,
            &after,
            Some(b"format: projections.comparator\nversion: 0\nmetadata:\n  values:\n    n: size(chnages)\n"),
        ),
        "Line 5, column",
    );
    error_contains(compare_extractions_with(&before, &after, Some(b"format: \xff")), "UTF-8");
}
