//! Upstream extractions: a custom extractor receives the built-in extractions
//! its definition's `extractor.upstream` names.

#![cfg(unix)]

use projections_cli::runtime::Runner;
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, path::Path, process::Command};

fn git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false"])
        .args(["-c", "user.name=Upstream", "-c", "user.email=upstream@example.invalid"])
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

const EXTRACTION: &str =
    r#"{"protocolVersion":0,"schema":"graph/v0","entities":[{"id":"one","kind":"item","label":"one"}],"relationships":[]}"#;

/// A repository whose projection `composed` saves its request to `$PROBE`,
/// with `extractor` merged into its extractor and `execution` as given.
fn repository(extractor: Value, execution: Value) -> (tempfile::TempDir, tempfile::TempDir) {
    let root = tempfile::tempdir().unwrap();
    let requests = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "--template=", "--quiet"]);
    for (file, text) in [("a/one.txt", "one"), ("b/two.txt", "two")] {
        fs::create_dir_all(root.path().join(file).parent().unwrap()).unwrap();
        fs::write(root.path().join(file), text).unwrap();
    }
    let mut command = json!({"command":["/bin/sh","-c",format!("cat > \"$PROBE\"; printf '%s' '{EXTRACTION}'")]});
    command.as_object_mut().unwrap().extend(extractor.as_object().unwrap().clone());
    let mut execution = execution;
    execution["environment"] = json!(["PROBE"]);
    fs::create_dir_all(root.path().join(".projections")).unwrap();
    fs::write(
        root.path().join(".projections/composed.json"),
        serde_json::to_vec(&json!({"id":"composed","renderer":"graph","extractor":command,"execution":execution})).unwrap(),
    )
    .unwrap();
    git(root.path(), &["add", "--all"]);
    git(root.path(), &["commit", "--quiet", "-m", "start"]);
    (root, requests)
}

fn show(root: &Path, requests: &Path) -> anyhow::Result<Value> {
    let probe = requests.join("request.json");
    Runner::new(root.into(), true)
        .with_executable(env!("CARGO_BIN_EXE_projections"))
        .with_variables(BTreeMap::from([("PROBE".to_owned(), probe.to_string_lossy().into_owned())]))
        .show("composed", "working-tree", None)?;
    Ok(serde_json::from_slice(&fs::read(probe)?)?)
}

#[test]
fn the_command_receives_each_upstream_extraction_by_name_within_its_scope() {
    let (root, requests) = repository(
        json!({"upstream": {"files": {"extractor": "repository-map", "inputs": {}}}}),
        json!({"scope": ["a"]}),
    );
    let request = show(root.path(), requests.path()).unwrap();
    let files = &request["upstream"]["files"];
    assert_eq!(files["schema"], "graph/v0", "{request:#}");
    let text = files.to_string();
    assert!(text.contains("a/one.txt"), "{text}");
    // The downstream scope bounds what the upstream built-in reads.
    assert!(!text.contains("b/two.txt"), "{text}");
    assert_eq!(
        request["projection"]["definition"]["extractor"]["upstream"]["files"]["extractor"],
        "repository-map"
    );
}

#[test]
fn a_definition_without_upstream_sends_none_and_an_unknown_built_in_is_refused() {
    let (root, requests) = repository(json!({}), json!({}));
    assert!(show(root.path(), requests.path()).unwrap().get("upstream").is_none());
    let (root, requests) = repository(json!({"upstream": {"x": {"extractor": "no-such-extractor"}}}), json!({}));
    let error = format!("{:#}", show(root.path(), requests.path()).unwrap_err());
    assert!(error.contains("must name a built-in extractor, not no-such-extractor"), "{error}");
}
