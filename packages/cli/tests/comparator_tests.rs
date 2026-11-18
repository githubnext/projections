//! Comparator tests: `projections check` runs the `*.comparator.test.yaml`
//! beside a projection's comparator file, and every such file in this repository (the
//! examples, the first-party comparators and the `init` template) passes, run
//! by the same code. `UPDATE_COMPARATOR_TESTS=1` writes this repository's
//! snapshots instead, as `projections check --update` does.

use projections_cli::comparator_tests::{self, Context};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

fn walk(directory: &Path, files: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory).unwrap().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if entry.file_type().unwrap().is_dir() {
            if !["node_modules", "target", "dist", ".git", "storybook-static"].contains(&name.as_str()) {
                walk(&path, files);
            }
        } else if name.ends_with(".comparator.test.yaml") || name.ends_with(".comparator.test.yml") {
            files.push(path);
        }
    }
}

#[test]
fn every_comparator_test_file_in_the_repository_passes() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    let mut files = Vec::new();
    walk(&root, &mut files);
    files.sort();
    let found: Vec<String> = files
        .iter()
        .map(|file| file.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/"))
        .collect();
    let update = std::env::var_os("UPDATE_COMPARATOR_TESTS").is_some();
    let mut problems = String::new();
    for file in &files {
        let report = comparator_tests::run_file(
            file,
            &Context {
                update,
                ..Context::new(&root)
            },
        );
        let step = comparator_tests::step(&report);
        // Revision cases need a projection; the repository's own tests use fixtures.
        if step["status"] != "pass" || report.cases.iter().any(|case| case["status"] != "pass") {
            problems.push_str(&format!(
                "{}: {}\n{}",
                report.path,
                step["message"].as_str().unwrap_or_default(),
                comparator_tests::text(&step)
            ));
        }
        for written in &report.written {
            eprintln!("wrote {written}");
        }
    }
    assert!(problems.is_empty(), "{problems}");
    for expected in [
        "packages/cli/templates/starter.comparator.test.yaml",
        "packages/comparators/api-compatibility/api-compatibility.comparator.test.yaml",
        "packages/comparators/runtime-policy/runtime-policy.comparator.test.yaml",
        "packages/comparators/agentic-workflows/agentic-workflows.comparator.test.yaml",
        "examples/comparators/moved-components/moved-components.comparator.test.yaml",
        "examples/comparators/priority-order/priority-order.comparator.test.yaml",
    ] {
        assert!(found.contains(&expected.to_owned()), "{expected} is missing: {found:?}");
    }
}

fn git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "user.name=Comparator tests",
            "-c",
            "user.email=tests@example.invalid",
        ])
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

fn cli(root: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_projections"))
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .unwrap()
}

const EXAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/comparators/priority-order");

/// A repository with two projections: `deps` uses the priority order rules
/// (and their fixtures) in `tools/`, `plain` the default comparator.
fn repository() -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "--template=", "--quiet"]);
    fs::create_dir_all(root.join("tools/fixtures")).unwrap();
    fs::create_dir_all(root.join(".projections")).unwrap();
    fs::copy(
        format!("{EXAMPLE}/priority-order.comparator.yaml"),
        root.join("tools/priority.comparator.yaml"),
    )
    .unwrap();
    for name in ["before.json", "after.json"] {
        fs::copy(format!("{EXAMPLE}/fixtures/{name}"), root.join("tools/fixtures").join(name)).unwrap();
    }
    for (id, comparator) in [
        (
            "deps",
            json!({"file": "tools/priority.comparator.yaml", "options": {"priority": ["package:@acme/core"]}}),
        ),
        ("plain", Value::Null),
    ] {
        let mut definition = json!({"id": id, "renderer": "graph",
            "extractor": {"command": ["node", "extract.mjs"]}});
        if !comparator.is_null() {
            definition["comparator"] = comparator;
        }
        fs::write(
            root.join(format!(".projections/{id}.json")),
            serde_json::to_vec(&definition).unwrap(),
        )
        .unwrap();
    }
    git(root, &["add", "."]);
    git(root, &["commit", "--quiet", "-m", "Start"]);
    directory
}

/// The `comparator-tests` step of `projections check -p <id> --no-render --json`, and the text report.
fn step(root: &Path, id: &str, extra: &[&str]) -> (Value, String) {
    let mut args = vec!["check", "-p", id, "--no-render", "--json"];
    args.extend(extra);
    let output = cli(root, &args);
    let report: Value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        panic!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    });
    let step = report["projections"][0]["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| step["id"] == "comparator-tests")
        .cloned()
        .unwrap();
    let text_args: Vec<&str> = args.iter().copied().filter(|arg| *arg != "--json").collect();
    let text = String::from_utf8(cli(root, &text_args).stdout).unwrap();
    (step, text)
}

const TESTS: &str = "format: projections.comparator-tests
version: 0
cases:
  - name: core leads
    before: fixtures/before.json
    after: {file: fixtures/after.json}
    expect:
      order: [package:@acme/core, package:@acme/docs-site]
      changes:
        - {item: package:@acme/billing, status: added}
  - name: whole comparison
    before: fixtures/before.json
    after: fixtures/after.json
    options: {}
    snapshot: snapshots/plain.json
";

#[test]
fn check_runs_the_tests_beside_comparator_files() {
    let directory = repository();
    let root = directory.path();

    let (built_in, _) = step(root, "plain", &[]);
    assert_eq!(built_in["status"], "skip", "{built_in}");

    // Without tests, a warning says where they go.
    let (missing, _) = step(root, "deps", &[]);
    assert_eq!(missing["status"], "warn");
    assert_eq!(missing["file"], "tools/priority.comparator.test.yaml");
    assert_eq!(
        missing["message"],
        "No tests beside tools/priority.comparator.yaml: add tools/priority.comparator.test.yaml (projections help authoring)"
    );

    // A missing snapshot fails until --update writes it.
    fs::write(root.join("tools/priority.comparator.test.yaml"), TESTS).unwrap();
    let (unwritten, _) = step(root, "deps", &[]);
    assert_eq!(unwritten["status"], "fail", "{unwritten}");
    assert_eq!(unwritten["message"], "1 of 2 cases failed: whole comparison");
    assert_eq!(unwritten["cases"][0]["status"], "pass");
    let case = &unwritten["cases"][1];
    assert_eq!(case["id"], "whole comparison");
    assert_eq!(
        case["location"],
        json!({"path": "tools/priority.comparator.test.yaml", "line": 11, "column": 11})
    );
    assert!(case["durationMs"].is_u64());
    assert_eq!(
        case["failures"],
        json!([{"expectation": "/cases/1/snapshot",
            "message": "No snapshot snapshots/plain.json yet; run projections check --update to write it",
            "location": {"path": "tools/priority.comparator.test.yaml", "line": 15, "column": 15}}])
    );

    let (updated, _) = step(root, "deps", &["--update"]);
    assert_eq!(updated["status"], "pass", "{updated}");
    assert_eq!(updated["written"], json!(["tools/snapshots/plain.json"]));
    assert_eq!(updated["message"], "2 cases pass; wrote tools/snapshots/plain.json");
    let snapshot = fs::read_to_string(root.join("tools/snapshots/plain.json")).unwrap();
    assert!(snapshot.starts_with("{\n  \"changes\": [\n"));
    assert!(snapshot.ends_with("}\n"));
    let (passing, text) = step(root, "deps", &[]);
    assert_eq!(passing["status"], "pass");
    assert_eq!(passing["message"], "2 cases pass");
    assert!(text.contains("  pass Comparator tests: 2 cases pass\n"), "{text}");

    // --coverage reports which of the rules the cases ran, and where the rest are.
    let (covered, text) = step(root, "deps", &["--coverage"]);
    assert_eq!(covered["status"], "pass", "{covered}");
    let coverage = &covered["coverage"];
    assert_eq!(coverage["comparator"], "tools/priority.comparator.yaml");
    assert_eq!(coverage["entries"]["format"], "projections.rules-coverage");
    let expressions = &coverage["summary"]["expressions"];
    assert!(
        expressions["covered"].as_u64().unwrap() < expressions["total"].as_u64().unwrap(),
        "{coverage}"
    );
    assert!(
        covered["message"]
            .as_str()
            .unwrap()
            .starts_with("2 cases pass; coverage: functions 0/0 (100.0%), expressions "),
        "{covered}"
    );
    // The options checks never fail in these cases, so their messages never run.
    assert!(
        coverage["uncovered"]
            .as_array()
            .unwrap()
            .contains(&json!({"category": "expressions",
            "path": "/checks/0/message", "line": 14, "column": 7, "message": "/checks/0/message never ran"})),
        "{coverage}"
    );
    assert!(
        text.contains("         uncovered tools/priority.comparator.yaml:14:7 /checks/0/message never ran\n"),
        "{text}"
    );

    // A failed expectation names its place in the file and shows the difference.
    fs::write(
        root.join("tools/priority.comparator.test.yaml"),
        TESTS.replace("status: added", "status: removed"),
    )
    .unwrap();
    let (failing, text) = step(root, "deps", &[]);
    assert_eq!(failing["status"], "fail");
    let failure = &failing["cases"][0]["failures"][0];
    assert_eq!(failure["expectation"], "/cases/0/expect/changes/0/status");
    assert_eq!(
        failure["message"],
        "Change `package:@acme/billing` has status \"added\"; expected \"removed\""
    );
    assert_eq!(
        failure["location"],
        json!({"path": "tools/priority.comparator.test.yaml", "line": 10, "column": 49})
    );
    assert_eq!((&failure["expected"], &failure["actual"]), (&json!("removed"), &json!("added")));
    assert_eq!(failure["diff"], "--- expected\n+++ actual\n-\"removed\"\n+\"added\"");
    assert!(
        text.contains("  fail Comparator tests: 1 of 2 cases failed: core leads\n         fail core leads (tools/priority.comparator.test.yaml:4:11)\n           tools/priority.comparator.test.yaml:10:49 /cases/0/expect/changes/0/status: Change `package:@acme/billing` has status \"added\"; expected \"removed\"\n             --- expected\n"),
        "{text}"
    );
    let exit = cli(root, &["check", "-p", "deps", "--no-render"]);
    assert!(!exit.status.success());

    // A snapshot that no longer matches shows the diff.
    fs::write(root.join("tools/priority.comparator.test.yaml"), TESTS).unwrap();
    fs::write(
        root.join("tools/snapshots/plain.json"),
        snapshot.replace("\"kind\": \"add\"", "\"kind\": \"restructure\""),
    )
    .unwrap();
    let (stale, _) = step(root, "deps", &[]);
    let failure = &stale["cases"][1]["failures"][0];
    assert!(
        failure["message"]
            .as_str()
            .unwrap()
            .starts_with("The comparison differs from the snapshot snapshots/plain.json"),
        "{failure}"
    );
    assert!(
        failure["diff"]
            .as_str()
            .unwrap()
            .contains("-      \"kind\": \"restructure\"\n+      \"kind\": \"add\""),
        "{failure}"
    );

    // A test file that isn't valid reports where.
    fs::write(
        root.join("tools/priority.comparator.test.yaml"),
        TESTS.replace("    options: {}\n", "    option: {}\n"),
    )
    .unwrap();
    let (invalid, text) = step(root, "deps", &[]);
    assert_eq!(invalid["status"], "fail");
    assert_eq!(
        invalid["diagnostics"],
        json!([{"pointer": "/cases/1/option",
            "message": "Unknown field `option` in A case; expected `name`, `before`, `after`, `options`, `expect`, `snapshot`",
            "location": {"path": "tools/priority.comparator.test.yaml", "line": 14, "column": 13}}])
    );
    assert!(
        text.contains("         tools/priority.comparator.test.yaml:14:13: Unknown field `option`"),
        "{text}"
    );
}

#[test]
fn a_nested_project_s_comparator_tests_and_coverage_resolve_within_it() {
    // The same projection, moved with its rules and tests into a nested project: its paths stay as written.
    let directory = repository();
    let root = directory.path();
    fs::write(root.join("tools/priority.comparator.test.yaml"), TESTS).unwrap();
    fs::create_dir_all(root.join("app")).unwrap();
    for name in ["tools", ".projections"] {
        fs::rename(root.join(name), root.join("app").join(name)).unwrap();
    }
    let app = root.join("app");
    let (written, _) = step(&app, "deps", &["--update"]);
    assert_eq!(written["status"], "pass", "{written}");
    assert_eq!(written["written"], json!(["app/tools/snapshots/plain.json"]));
    let (covered, text) = step(&app, "deps", &["--coverage"]);
    assert_eq!(covered["status"], "pass", "{covered}");
    assert_eq!(covered["file"], "app/tools/priority.comparator.test.yaml");
    assert_eq!(covered["coverage"]["comparator"], "app/tools/priority.comparator.yaml");
    assert!(
        text.contains("         uncovered app/tools/priority.comparator.yaml:14:7 /checks/0/message never ran\n"),
        "{text}"
    );
}

#[test]
fn revision_cases_extract_with_the_working_tree_definition_or_are_skipped() {
    let directory = repository();
    let root = directory.path();
    fs::write(
        root.join("tools/priority.comparator.test.yaml"),
        "format: projections.comparator-tests\nversion: 0\ncases:\n  - name: since HEAD\n    before: {revision: HEAD}\n    after: {revision: working-tree}\n    expect: {count: {changes: 0}}\n  - name: fixtures\n    before: fixtures/before.json\n    after: fixtures/before.json\n    expect: {count: {changes: 0}}\n",
    )
    .unwrap();
    // The extractor is repository code, which runs only with --trust.
    let (untrusted, _) = step(root, "deps", &[]);
    assert_eq!(untrusted["status"], "pass", "{untrusted}");
    assert_eq!(untrusted["cases"][0]["status"], "skip");
    assert!(
        untrusted["message"].as_str().unwrap().starts_with(
            "1 case passes; 1 skipped: Extracting HEAD runs repository code (deps's extractor); trust the repository (--trust)"
        ),
        "{untrusted}"
    );
    #[cfg(unix)]
    {
        fs::write(
            root.join("extract.sh"),
            "cat >/dev/null\nprintf '%s' '{\"protocolVersion\":0,\"schema\":\"graph/v0\",\"entities\":[{\"id\":\"a\",\"kind\":\"item\",\"label\":\"A\"}],\"relationships\":[]}'\n",
        )
        .unwrap();
        let definition = json!({"id": "deps", "renderer": "graph",
            "extractor": {"command": ["/bin/sh", "extract.sh"], "sources": ["extract.sh"]},
            "comparator": "tools/priority.comparator.yaml"});
        fs::write(root.join(".projections/deps.json"), serde_json::to_vec(&definition).unwrap()).unwrap();
        git(root, &["add", "."]);
        git(root, &["commit", "--quiet", "-m", "Extractor"]);
        let (trusted, _) = step(root, "deps", &["--trust"]);
        assert_eq!(trusted["status"], "pass", "{trusted}");
        assert_eq!(trusted["message"], "2 cases pass");
    }
}
