//! The agent tools (`projections_cli::tools`) against fixture repositories,
//! through the Inspector service as `serve --stdio` and `mcp` call them.

use std::{fs, path::Path, process::Command};

use projections_cli::{
    explore,
    runtime::Runner,
    service::{InspectorOptions, Service},
    tools::{self, Host, Outcome},
};
use serde_json::{Value, json};

fn git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "user.name=Tools test",
            "-c",
            "user.email=tools@example.invalid",
        ])
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

/// Inspector assets good enough for a service that serves no pages.
fn assets(root: &Path) {
    fs::create_dir_all(root.join("assets")).unwrap();
    fs::create_dir_all(root.join("engine")).unwrap();
    fs::write(
        root.join("index.html"),
        r#"<!doctype html><title>Inspector</title><script type="module" src="./assets/client.js"></script><link rel="stylesheet" href="./assets/client.css">"#,
    )
    .unwrap();
    fs::write(root.join("assets/client.js"), "export {};").unwrap();
    fs::write(root.join("assets/client.css"), "body{margin:0}").unwrap();
    fs::write(root.join("mount.js"), "export {};").unwrap();
    fs::write(root.join("mount.css"), "body{margin:0}").unwrap();
    for name in ["worker-entry.js", "wasm-transport.js", "transport.js"] {
        fs::write(root.join("engine").join(name), "export {};").unwrap();
    }
    fs::write(root.join("engine/engine.wasm"), b"\0asm\x01\0\0\0").unwrap();
}

const EXAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/comparators/priority-order");

const TESTS: &str = "format: projections.comparator-tests
version: 0
cases:
  - name: whole comparison
    before: fixtures/before.json
    after: fixtures/after.json
    options: {}
    snapshot: snapshots/plain.json
";

/// A repository with `map` (the built-in repository map) and `deps`
/// (repository code, with the priority-order comparator and its tests), and two
/// commits: the second adds a file.
fn repository(root: &Path) {
    git(root, &["init", "--template=", "--quiet"]);
    fs::create_dir_all(root.join(".projections")).unwrap();
    fs::create_dir_all(root.join("tools/fixtures")).unwrap();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::copy(
        format!("{EXAMPLE}/priority-order.comparator.yaml"),
        root.join("tools/priority.comparator.yaml"),
    )
    .unwrap();
    for name in ["before.json", "after.json"] {
        fs::copy(format!("{EXAMPLE}/fixtures/{name}"), root.join("tools/fixtures").join(name)).unwrap();
    }
    fs::write(root.join("tools/priority.comparator.test.yaml"), TESTS).unwrap();
    fs::write(
        root.join(".projections/map.json"),
        "{\n  \"id\": \"map\",\n  \"title\": \"Repository map\",\n  \"extractor\": \"repository-map\",\n  \"renderer\": \"graph\"\n}\n",
    )
    .unwrap();
    fs::write(
        root.join(".projections/deps.json"),
        serde_json::to_vec_pretty(&json!({"id": "deps", "renderer": "graph",
            "extractor": {"command": ["node", "extract.mjs"]},
            "comparator": {"file": "tools/priority.comparator.yaml", "options": {"priority": ["package:@acme/core"]}}}))
        .unwrap(),
    )
    .unwrap();
    fs::write(root.join("src/a.txt"), "a\n").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "--quiet", "-m", "Start"]);
    fs::write(root.join("src/b.txt"), "b\n").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "--quiet", "-m", "Add b (#7)"]);
}

async fn service(root: &Path, trust: bool, explore_session: bool) -> Service {
    let viewer = root.join("../viewer");
    assets(&viewer);
    let root = fs::canonicalize(root).unwrap();
    let candidates = explore::candidates(&Runner::new(root.clone(), false), &root).unwrap();
    Service::new(InspectorOptions {
        repo: root,
        trust,
        document: None,
        custom_renderers: false,
        assets: viewer,
        fixtures: None,
        executable: Some(env!("CARGO_BIN_EXE_projections").into()),
        explore: explore_session.then(|| candidates.clone()),
        candidates,
        execution: Default::default(),
    })
    .await
    .unwrap()
}

async fn call(service: &Service, name: &str, arguments: Value) -> Outcome {
    let outcome = tools::call(service, Host::Agent, name, &arguments).await.unwrap();
    // Every result is bounded text and JSON.
    assert!(outcome.text.len() <= tools::MAX_TEXT + 200, "{name}");
    assert!(outcome.json()["content"][0]["type"] == "text");
    outcome
}

fn directory() -> (tempfile::TempDir, std::path::PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("repo");
    fs::create_dir_all(&root).unwrap();
    (directory, root)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn read_only_tools_answer_from_the_repository() {
    let (_directory, root) = directory();
    repository(&root);
    let service = service(&root, false, false).await;

    let listed = call(&service, "list_projections", json!({})).await;
    assert!(!listed.error, "{}", listed.text);
    assert!(
        listed
            .text
            .contains("- map: Repository map. Extractor repository-map; renderer graph; comparator default"),
        "{}",
        listed.text
    );
    assert!(
        listed
            .text
            .contains("comparator custom tools/priority.comparator.yaml; runs repository code (needs trust)"),
        "{}",
        listed.text
    );
    assert!(listed.text.contains("Repository code doesn't run here"), "{}", listed.text);
    assert_eq!(listed.structured["projections"].as_array().unwrap().len(), 2);

    // The suggested pair is the last commit.
    let compared = call(&service, "compare", json!({"projection": "map"})).await;
    assert!(!compared.error, "{}", compared.text);
    assert!(compared.text.contains("the suggested pair \"HEAD~1 → HEAD\""), "{}", compared.text);
    assert!(compared.text.contains("Added entity"), "{}", compared.text);
    assert!(compared.text.contains("b.txt"), "{}", compared.text);
    assert!(compared.structured["counts"]["added"].as_u64().unwrap() >= 1);
    assert!(
        compared.structured["changes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|change| change["entities"].as_array().is_some_and(|ids| !ids.is_empty()))
    );
    let explicit = call(&service, "compare", json!({"projection": "map", "before": "HEAD", "after": "HEAD"})).await;
    assert!(explicit.text.contains("No changes"), "{}", explicit.text);
    let refused = call(
        &service,
        "compare",
        json!({"projection": "deps", "before": "HEAD~1", "after": "HEAD"}),
    )
    .await;
    assert!(refused.error);
    assert!(refused.text.contains("needs trust"), "{}", refused.text);
    let invalid = call(&service, "compare", json!({"projection": "map", "after": "HEAD"})).await;
    assert!(invalid.error && invalid.text.contains("Give before too"), "{}", invalid.text);
    let unknown = call(&service, "compare", json!({"projection": "map", "pair": 1})).await;
    assert!(unknown.error && unknown.text.contains("have no pair"), "{}", unknown.text);
    assert!(tools::call(&service, Host::Agent, "no_such_tool", &json!({})).await.is_err());
    // The view tools are answered by the surface that shows the view: VS Code, or projections mcp's viewer.
    let editor = tools::call(&service, Host::Editor, "open_projection", &json!({"projection": "map"}))
        .await
        .unwrap();
    assert!(editor.error && editor.text.contains("view action"));

    let explored = call(&service, "explore", json!({})).await;
    assert!(explored.text.contains("- repository-map: "), "{}", explored.text);
    assert!(explored.text.contains("Why: "), "{}", explored.text);

    let swept = call(&service, "sweep", json!({"projections": ["map", "deps"], "last": 2})).await;
    assert!(!swept.error, "{}", swept.text);
    assert!(swept.text.contains("Swept 1 recent change with 2 projections"), "{}", swept.text);
    assert!(
        swept
            .text
            .contains("- map: changed in 1 of 1 (median 2 changes); most on Add b (#7) (2: 2 added)"),
        "{}",
        swept.text
    );
    assert!(swept.text.contains("- deps: skipped."), "{}", swept.text);
    let latest = call(&service, "sweep", json!({"latest": true})).await;
    assert_eq!(latest.text, swept.text);

    let checked = call(&service, "check", json!({"projections": ["map"]})).await;
    assert!(!checked.error, "{}", checked.text);
    assert!(checked.text.contains("All checks passed"), "{}", checked.text);
    assert_eq!(checked.structured["ok"], true);

    // The snapshot isn't written yet, so the case fails, saying so.
    let tested = call(&service, "run_comparator_tests", json!({})).await;
    assert!(tested.error, "{}", tested.text);
    assert!(
        tested
            .text
            .contains("tools/priority.comparator.test.yaml (projection deps): 0 pass, 1 fail"),
        "{}",
        tested.text
    );
    assert!(tested.text.contains("No snapshot snapshots/plain.json yet"), "{}", tested.text);

    let described = call(&service, "describe_part", json!({"part": "extractor", "id": "repository-map"})).await;
    assert!(described.text.contains("[repository-map]"));
    service.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn writes_preview_then_confirm_and_refuse_a_stale_preview() {
    let (_directory, root) = directory();
    repository(&root);
    let definition = root.join(".projections/map.json");

    // Without trust, previews work and writes are refused.
    let untrusted = service(&root, false, false).await;
    let preview = call(&untrusted, "set_part", json!({"projection": "map", "renderer": "dag"})).await;
    assert!(!preview.error, "{}", preview.text);
    assert!(
        preview.text.contains("-   \"renderer\": \"graph\"\n+   \"renderer\": \"dag\""),
        "{}",
        preview.text
    );
    assert!(preview.text.contains("Writing it needs trust"), "{}", preview.text);
    let token = preview.structured["confirm"].as_str().unwrap().to_owned();
    assert!(preview.text.contains(&format!("confirm: \"{token}\"")), "{}", preview.text);
    let refused = call(
        &untrusted,
        "set_part",
        json!({"projection": "map", "renderer": "dag", "confirm": token}),
    )
    .await;
    assert!(refused.error && refused.text.contains("--trust"), "{}", refused.text);
    assert!(fs::read_to_string(&definition).unwrap().contains("\"graph\""));
    untrusted.close().await;

    let service = service(&root, true, false).await;
    let preview = call(&service, "set_part", json!({"projection": "map", "renderer": "dag"})).await;
    let token = preview.structured["confirm"].as_str().unwrap().to_owned();
    // A token for another change is refused, and the new preview offered.
    let other = call(
        &service,
        "set_part",
        json!({"projection": "map", "renderer": "architecture", "confirm": token}),
    )
    .await;
    assert!(other.error && other.text.starts_with("Not written"), "{}", other.text);
    assert!(fs::read_to_string(&definition).unwrap().contains("\"graph\""));
    // The file changed since the preview: refused.
    fs::write(
        &definition,
        fs::read_to_string(&definition).unwrap().replace("Repository map", "Map"),
    )
    .unwrap();
    let stale = call(
        &service,
        "set_part",
        json!({"projection": "map", "renderer": "dag", "confirm": token}),
    )
    .await;
    assert!(stale.error && stale.text.starts_with("Not written"), "{}", stale.text);
    assert!(fs::read_to_string(&definition).unwrap().contains("\"graph\""));
    let fresh = stale.structured["confirm"].as_str().unwrap();
    let written = call(
        &service,
        "set_part",
        json!({"projection": "map", "renderer": "dag", "confirm": fresh}),
    )
    .await;
    assert!(!written.error, "{}", written.text);
    assert_eq!(written.structured["written"], true);
    let saved = fs::read_to_string(&definition).unwrap();
    assert!(
        saved.contains("\"renderer\": \"dag\"") && saved.contains("\"title\": \"Map\""),
        "{saved}"
    );
    let unchanged = call(&service, "set_part", json!({"projection": "map", "renderer": "dag"})).await;
    assert!(unchanged.text.contains("nothing to change"), "{}", unchanged.text);
    let invalid = call(&service, "set_part", json!({"projection": "map", "renderer": {"nothing": 1}})).await;
    assert!(invalid.error, "{}", invalid.text);

    // Snapshots: the missing one is previewed, then written.
    let snapshots = call(&service, "update_snapshots", json!({})).await;
    assert!(snapshots.text.contains("1 snapshot differ"), "{}", snapshots.text);
    assert!(!root.join("tools/snapshots/plain.json").exists());
    let token = snapshots.structured["confirm"].as_str().unwrap();
    let updated = call(&service, "update_snapshots", json!({"confirm": token})).await;
    assert!(!updated.error, "{}", updated.text);
    assert!(updated.text.contains("tools/snapshots/plain.json"), "{}", updated.text);
    assert!(root.join("tools/snapshots/plain.json").is_file());
    let current = call(&service, "update_snapshots", json!({})).await;
    assert!(current.text.contains("nothing to update"), "{}", current.text);
    let tested = call(
        &service,
        "run_comparator_tests",
        json!({"path": "tools/priority.comparator.test.yaml"}),
    )
    .await;
    assert!(!tested.error && tested.text.contains("1 pass, 0 fail"), "{}", tested.text);
    service.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_explore_session_adopts_after_a_preview_and_leaves_ci_to_the_person() {
    let (_directory, root) = directory();
    git(&root, &["init", "--template=", "--quiet"]);
    fs::write(root.join("README.md"), "# Shop\n").unwrap();
    git(&root, &["add", "."]);
    git(&root, &["commit", "--quiet", "-m", "Start"]);
    let service = service(&root, false, true).await;

    let preview = call(&service, "adopt", json!({"projections": ["repository-map"], "bookmarks": 0})).await;
    assert!(!preview.error, "{}", preview.text);
    assert!(
        preview.text.contains("Would create .github/projections/repository-map.json"),
        "{}",
        preview.text
    );
    assert!(!root.join(".github/projections/repository-map.json").exists());
    let token = preview.structured["confirm"].as_str().unwrap();
    let wrong = call(
        &service,
        "adopt",
        json!({"projections": ["repository-map"], "bookmarks": 0, "confirm": "0000"}),
    )
    .await;
    assert!(wrong.error && wrong.text.starts_with("Not written"), "{}", wrong.text);
    let adopted = call(
        &service,
        "adopt",
        json!({"projections": ["repository-map"], "bookmarks": 0, "confirm": token}),
    )
    .await;
    assert!(!adopted.error, "{}", adopted.text);
    assert!(
        adopted.text.contains("Created .github/projections/repository-map.json"),
        "{}",
        adopted.text
    );
    assert!(root.join(".github/projections/repository-map.json").is_file());
    let again = call(&service, "adopt", json!({"projections": ["repository-map"], "confirm": token})).await;
    assert!(again.error && again.text.contains("already adopted"), "{}", again.text);

    // Adding them to CI is the person's decision, which the agent proposes from the guide.
    assert!(adopted.text.contains("projections help agents ci"), "{}", adopted.text);
    let removed = tools::call(&service, Host::Agent, "publish", &json!({})).await.err().unwrap();
    assert!(removed.contains("Unknown tool"), "{removed}");
    service.close().await;
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn prepare_runs_the_environment_through_the_service_and_environment_reports_it() {
    let (_directory, root) = directory();
    repository(&root);
    fs::write(root.join(".gitignore"), "deps/\n").unwrap();
    fs::write(root.join("deps.lock"), "one\n").unwrap();
    fs::write(
        root.join(".projections/environment.json"),
        serde_json::to_vec(&json!({"format": "projections.environment", "version": 0,
            "prepare": [{"id": "install", "run": ["/bin/sh", "-c", "mkdir -p deps && cp deps.lock deps/installed && echo installed"], "key": ["deps.lock"]}]}))
        .unwrap(),
    )
    .unwrap();
    git(&root, &["add", "."]);
    git(&root, &["commit", "--quiet", "-m", "Environment"]);
    let untrusted = service(&root, false, false).await;
    let refused = call(&untrusted, "prepare", json!({})).await;
    assert!(refused.error && refused.text.contains("trust"), "{}", refused.text);
    untrusted.close().await;

    let service = service(&root, true, false).await;
    let prepared = call(&service, "prepare", json!({})).await;
    assert!(!prepared.error, "{}", prepared.text);
    assert!(prepared.text.contains("install: ran"), "{}", prepared.text);
    assert!(root.join("deps/installed").is_file());
    let again = call(&service, "prepare", json!({})).await;
    assert!(again.text.contains("install: up to date"), "{}", again.text);
    // GET /api/environment: what is declared and prepared.
    let response = service
        .handle(
            axum::extract::Request::builder()
                .method("GET")
                .uri("/api/environment")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await;
    let body = axum::body::to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let environment: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(environment["declared"], ".projections/environment.json");
    assert_eq!(environment["prepare"][0]["state"], "current");
    service.close().await;
}
