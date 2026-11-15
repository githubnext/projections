//! Helpers the suites share: selection, scratch repositories, running
//! extractors, and reading their results.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use projections_cli::{collectors, engine, runtime::Runner};
use serde_json::{Value, json};

pub(super) fn selected(switches: &[&str]) -> bool {
    switches.iter().any(|name| std::env::var(name).is_ok_and(|value| value == "1"))
}

pub(super) fn tool(variable: &str, default: &str) -> String {
    std::env::var(variable).unwrap_or_else(|_| default.into())
}

pub(super) fn fixtures(id: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../extractors")
        .join(id)
        .join("tests/fixtures")
        .canonicalize()
        .unwrap()
}

pub(super) struct Scratch(pub(super) PathBuf);

impl Scratch {
    pub(super) fn new() -> Self {
        let parent = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/native-tool-tests");
        fs::create_dir_all(&parent).unwrap();
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        // Parallel tests can read the same clock value.
        static SEQUENCE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let sequence = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = parent.join(format!("{}-{stamp}-{sequence}", std::process::id()));
        fs::create_dir(&root).unwrap();
        Self(root.canonicalize().unwrap())
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(super) fn copy(source: &Path, destination: &Path, skip: &[&str]) {
    fs::create_dir_all(destination).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().to_string_lossy().into_owned();
        if skip.iter().any(|pattern| name == *pattern || name.starts_with(pattern)) {
            continue;
        }
        if entry.file_type().unwrap().is_dir() {
            copy(&entry.path(), &destination.join(&name), skip);
        } else {
            fs::copy(entry.path(), destination.join(&name)).unwrap();
        }
    }
}

pub(super) fn definition(id: &str, inputs: Value, execution: Value) -> Value {
    json!({"id":"native-tool-test","extractor":id,"renderer":"graph","inputs":inputs,"execution":execution})
}

pub(super) fn collect(root: &Path, definition: &Value, trusted: bool) -> anyhow::Result<Value> {
    collectors::collect(
        root,
        definition,
        &Runner::new(root.to_owned(), trusted).with_executable(env!("CARGO_BIN_EXE_projections")),
    )
}

pub(super) fn canonical(state: &Value) -> Value {
    engine("canonicalize", json!({"extraction":state})).unwrap()["canonical"].clone()
}

pub(super) fn compare(before: &Value, after: &Value) -> Value {
    projections_comparator_default::compare(before, after, &json!({})).unwrap()
}

/// After-side entities of the comparison's modified entity changes.
pub(super) fn modified_entities<'a>(comparison: &Value, after: &'a Value) -> Vec<&'a Value> {
    comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|change| change["collection"] == "entities" && change["status"] == "modified")
        .flat_map(|change| change["after"].as_array().unwrap().clone())
        .filter_map(|id| items(after, "entities").iter().find(|item| item["id"] == id))
        .collect()
}

pub(super) fn status_count(comparison: &Value, status: &str) -> usize {
    comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|change| change["status"] == status)
        .count()
}

pub(super) fn items<'a>(state: &'a Value, field: &str) -> &'a Vec<Value> {
    state[field].as_array().unwrap()
}

pub(super) fn count(state: &Value, field: &str, kind: &str) -> usize {
    items(state, field).iter().filter(|item| item["kind"] == kind).count()
}

/// A minimal explicit tool environment, like the one the CLI grants collectors.
pub(super) fn tool_command(program: &str, cwd: &Path, names: &[&str]) -> Command {
    let mut command = Command::new(program);
    command.current_dir(cwd).env_clear();
    for (name, value) in [("LANG", "C.UTF-8"), ("LC_ALL", "C.UTF-8"), ("TZ", "UTC")] {
        command.env(name, value);
    }
    for name in std::iter::once(&"PATH").chain(names) {
        if let Ok(value) = std::env::var(name) {
            command.env(name, value);
        }
    }
    command
}

pub(super) fn succeed(command: &mut Command) {
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{command:?} failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

pub(super) const ECOSYSTEM_ENVIRONMENT: [&str; 5] = ["RUSTUP_HOME", "CARGO_HOME", "GOCACHE", "GOMODCACHE", "GOPROXY"];

pub(super) fn ecosystem(id: &str, inputs: Value) -> Value {
    definition(
        id,
        inputs,
        json!({"timeoutMs":300000,"environment":ECOSYSTEM_ENVIRONMENT,"network":true}),
    )
}

/// The api-compatibility rules' comparison, run in the embedded rules
/// interpreter as every host runs them and validated by the Engine.
pub(super) fn api_compatibility(before: &Value, after: &Value) -> Value {
    let path = "packages/comparators/api-compatibility/api-compatibility.comparator.yaml";
    let rules = std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(path)).unwrap();
    projections_cli::artifact::run_custom_comparator(path, &rules, before, after, &json!({}))
        .unwrap_or_else(|failure| panic!("{failure:#}"))
        .0
}

/// `(label, level, rules)` of every classified entity change.
pub(super) fn verdicts(comparison: &Value, before: &Value, after: &Value) -> Vec<(String, String, Vec<String>)> {
    let label = |id: &Value| {
        items(after, "entities")
            .iter()
            .chain(items(before, "entities"))
            .find(|entity| entity["id"] == *id)
            .map(|entity| entity["label"].as_str().unwrap().to_owned())
            .unwrap()
    };
    comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|change| change["collection"] == "entities")
        .map(|change| {
            let id = change["after"].get(0).unwrap_or(&change["before"][0]);
            let classified = &comparison["metadata"]["compatibility"]["changes"][change["id"].as_str().unwrap()];
            (
                label(id),
                classified["level"].as_str().unwrap().to_owned(),
                classified["findings"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|finding| finding["rule"].as_str().unwrap().to_owned())
                    .collect(),
            )
        })
        .collect()
}
