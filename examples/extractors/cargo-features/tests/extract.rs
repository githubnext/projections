//! Runs the example as the runner does: one request on stdin, one extraction on stdout.

use serde_json::{Value, json};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

fn extract(root: &Path) -> (bool, Value, String) {
    let request = json!({
        "protocolVersion": 0,
        "projection": {"id": "features", "definition": {"id": "features", "extractor": {"command": ["cargo-features"]}, "renderer": "graph"}},
        "repository": {"root": root, "revision": {"kind": "working-tree", "ref": "working-tree", "commit": "0000000000000000000000000000000000000000", "dirty": false}},
        "capabilities": {"trusted": false, "network": false}
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_cargo-features"))
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(request.to_string().as_bytes()).unwrap();
    let output = child.wait_with_output().unwrap();
    let stdout = String::from_utf8(output.stdout).unwrap();
    let value = serde_json::from_str(&stdout).unwrap_or(Value::Null);
    (output.status.success(), value, String::from_utf8(output.stderr).unwrap())
}

#[test]
fn maps_features_what_they_enable_and_the_dependencies_they_activate() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/workspace");
    let (succeeded, extraction, stderr) = extract(&root);
    assert!(succeeded, "{stderr}");
    assert_eq!(extraction["schema"], "graph/v0");
    let edges: Vec<(&str, &str, &str)> = extraction["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .map(|edge| {
            (
                edge["kind"].as_str().unwrap(),
                edge["from"].as_str().unwrap(),
                edge["to"].as_str().unwrap(),
            )
        })
        .collect();
    for edge in [
        ("declares", "crate:core", "feature:core:serde"),
        ("enables", "feature:core:default", "feature:core:std"),
        ("activates", "feature:core:serde", "dependency:core:serde"),
        ("enables", "feature:cli:json", "feature:core:serde"),
    ] {
        assert!(edges.contains(&edge), "{edge:?} in {edges:?}");
    }
}

#[test]
fn an_invalid_manifest_fails_with_its_path() {
    let root = std::env::temp_dir().join(format!("cargo-features-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("Cargo.toml"), "[package\n").unwrap();
    let (succeeded, _, stderr) = extract(&root.canonicalize().unwrap());
    std::fs::remove_dir_all(&root).unwrap();
    assert!(!succeeded);
    assert!(stderr.starts_with("Invalid manifest Cargo.toml"), "{stderr}");
}
