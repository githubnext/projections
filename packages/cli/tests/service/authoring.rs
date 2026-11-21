//! Writes: saving definition parts, adopting, and comparator tests.

use std::{fs, path::Path};

use serde_json::{Value, json};

use crate::{
    common::{Fixture, post},
    conformance::conforms,
};

#[tokio::test]
async fn saving_parts_previews_then_writes_the_definition_with_trust() {
    let fixture = Fixture::new(true, false, false).await;
    let file = fixture.root.join("repo/.projections/example.json");
    let original = fs::read_to_string(&file).unwrap();
    let preview = post(
        &fixture,
        json!({"projectionId": "example", "parts": {"renderer": "dag"}, "dryRun": true}),
    )
    .await;
    assert_eq!(preview.status, 200);
    let preview = preview.json();
    conforms("definitionSave", &preview);
    assert_eq!(preview["path"], ".projections/example.json");
    assert_eq!(preview["written"], false);
    assert_eq!(preview["before"], original.as_str());
    assert!(preview["after"].as_str().unwrap().contains("\"renderer\": \"dag\""));
    assert_eq!(fs::read_to_string(&file).unwrap(), original);

    // Saving needs the preview's digest, and refuses a stale one.
    assert_eq!(
        post(&fixture, json!({"projectionId": "example", "parts": {"renderer": "dag"}}))
            .await
            .status,
        400
    );
    let stale = post(
        &fixture,
        json!({"projectionId": "example", "parts": {"renderer": "dag"}, "digest": "sha256:00"}),
    )
    .await;
    assert_eq!(stale.status, 409);
    let saved = post(
        &fixture,
        json!({"projectionId": "example", "parts": {"renderer": "dag"}, "digest": preview["digest"]}),
    )
    .await;
    assert_eq!(saved.status, 200);
    conforms("definitionSave", &saved.json());
    assert_eq!(saved.json()["written"], true);
    assert_eq!(fs::read_to_string(&file).unwrap(), preview["after"].as_str().unwrap());
    let definitions = fixture.get("/api/definitions?ref=working-tree").await.json();
    assert_eq!(definitions["definitions"][0]["renderer"], "dag");

    // Only parts, only valid results.
    assert_eq!(
        post(&fixture, json!({"projectionId": "example", "parts": {"id": "x"}, "dryRun": true}))
            .await
            .status,
        400
    );
    assert_eq!(
        post(
            &fixture,
            json!({"projectionId": "example", "parts": {"extractor": null}, "dryRun": true})
        )
        .await
        .status,
        400
    );

    // Without --trust it previews but never writes.
    let untrusted = Fixture::new(false, false, false).await;
    let previewed = post(
        &untrusted,
        json!({"projectionId": "example", "parts": {"renderer": "dag"}, "dryRun": true}),
    )
    .await;
    assert_eq!(previewed.status, 200);
    let refused = post(
        &untrusted,
        json!({"projectionId": "example", "parts": {"renderer": "dag"}, "digest": previewed.json()["digest"]}),
    )
    .await;
    assert_eq!(refused.status, 403);
}

#[tokio::test]
async fn exploring_proposes_a_conforming_candidate_per_workflow() {
    let fixture = Fixture::new(true, false, false).await;
    let workflows = fixture.root.join("repo/.github/workflows");
    fs::create_dir_all(&workflows).unwrap();
    fs::write(workflows.join("ci.yml"), "on: push\njobs: {}\n").unwrap();
    let candidates = fixture.get("/api/explore").await.json();
    conforms("explore", &candidates);
    let workflow = candidates["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|candidate| candidate["extractor"] == "github-actions-jobs")
        .expect("a candidate for the workflow");
    assert_eq!(workflow["basis"]["file"], ".github/workflows/ci.yml");
}

#[tokio::test]
async fn adopting_previews_then_writes_with_trust() {
    let fixture = Fixture::new(true, false, false).await;
    let repo = fixture.root.join("repo");
    let write = |path: &'static str, body: Value| {
        let fixture = &fixture;
        async move {
            fixture
                .request("POST", path, fixture.auth(), &serde_json::to_vec(&body).unwrap())
                .await
        }
    };
    // The fixture repository's files suggest the file map, among others.
    let candidates = fixture.get("/api/explore").await.json();
    conforms("explore", &candidates);
    assert_eq!(candidates["session"], false);
    assert!(
        candidates["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|candidate| candidate["id"] == "repository-map")
    );
    let preview = write("/api/adopt", json!({"projections": ["repository-map"], "dryRun": true})).await;
    assert_eq!(preview.status, 200);
    let preview = preview.json();
    conforms("adopt", &preview);
    // The definitions directory the repository already uses.
    assert_eq!(preview["files"][0]["path"], ".projections/repository-map.json");
    assert!(!repo.join(".projections/repository-map.json").exists());
    assert_eq!(write("/api/adopt", json!({"projections": ["repository-map"]})).await.status, 400);
    let stale = write("/api/adopt", json!({"projections": ["repository-map"], "digest": "sha256:00"})).await;
    assert_eq!(stale.status, 409);
    let written = write(
        "/api/adopt",
        json!({"projections": ["repository-map"], "digest": preview["digest"]}),
    )
    .await;
    assert_eq!(written.status, 200);
    conforms("adopt", &written.json());
    assert!(repo.join(".projections/repository-map.json").is_file());
    let candidates = fixture.get("/api/explore").await.json();
    conforms("explore", &candidates);
    let map = candidates["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|candidate| candidate["id"] == "repository-map")
        .unwrap()
        .clone();
    assert_eq!(map["adopted"], "repository-map");
    // Nothing writes a CI workflow: where the step goes is the person's decision.
    assert_eq!(write("/api/publish", json!({"dryRun": true})).await.status, 404);
    assert!(!repo.join(".github/workflows/projections.yml").exists());
}

#[tokio::test]
async fn onboarding_writes_need_an_explore_session_or_trust() {
    let fixture = Fixture::new(false, false, false).await;
    let body = serde_json::to_vec(&json!({"projections": ["repository-map"], "digest": "sha256:00"})).unwrap();
    let refused = fixture.request("POST", "/api/adopt", fixture.auth(), &body).await;
    assert_eq!(refused.status, 403);
    // Previews are always allowed.
    let body = serde_json::to_vec(&json!({"projections": ["repository-map"], "dryRun": true})).unwrap();
    assert_eq!(fixture.request("POST", "/api/adopt", fixture.auth(), &body).await.status, 200);
}

/// The example priority order comparator beside the fixture's definition, with a
/// test file of two cases, one writing a snapshot.
fn comparator_tests_repository(repo: &Path) {
    let example = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/comparators/priority-order");
    fs::create_dir_all(repo.join("tools/fixtures")).unwrap();
    fs::copy(
        example.join("priority-order.comparator.yaml"),
        repo.join("tools/order.comparator.yaml"),
    )
    .unwrap();
    for name in ["before.json", "after.json"] {
        fs::copy(example.join("fixtures").join(name), repo.join("tools/fixtures").join(name)).unwrap();
    }
    fs::write(
        repo.join("tools/order.comparator.test.yaml"),
        "format: projections.comparator-tests\nversion: 0\ncases:\n  - name: core leads\n    before: fixtures/before.json\n    after: fixtures/after.json\n    options: {priority: [package:@acme/core]}\n    expect: {order: [package:@acme/core, package:@acme/docs-site]}\n  - name: snapshot\n    before: fixtures/before.json\n    after: fixtures/after.json\n    snapshot: snapshots/order.json\n",
    )
    .unwrap();
    let definition = repo.join(".projections/example.json");
    let mut value: Value = serde_json::from_slice(&fs::read(&definition).unwrap()).unwrap();
    value["comparator"] = json!("tools/order.comparator.yaml");
    fs::write(definition, serde_json::to_vec(&value).unwrap()).unwrap();
}

#[tokio::test]
async fn comparator_tests_are_listed_and_run_sandboxed() {
    let fixture = Fixture::new(false, false, false).await;
    let repo = fixture.root.join("repo");
    comparator_tests_repository(&repo);
    let run = |body: Value| {
        let fixture = &fixture;
        async move {
            fixture
                .request(
                    "POST",
                    "/api/comparator-tests/run",
                    fixture.auth(),
                    &serde_json::to_vec(&body).unwrap(),
                )
                .await
        }
    };

    let listed = fixture.get("/api/comparator-tests").await;
    assert_eq!(listed.status, 200, "{}", listed.text());
    assert_eq!(
        listed.json(),
        json!({"files": [{
            "path": "tools/order.comparator.test.yaml", "comparator": "tools/order.comparator.yaml",
            "projections": ["example"], "diagnostics": [],
            "cases": [
                {"id": "core leads", "name": "core leads", "location": {"path": "tools/order.comparator.test.yaml", "line": 4, "column": 11}},
                {"id": "snapshot", "name": "snapshot", "location": {"path": "tools/order.comparator.test.yaml", "line": 9, "column": 11}},
            ],
        }]})
    );

    // Running needs no trust: comparators run sandboxed.
    let response = run(json!({})).await;
    assert_eq!(response.status, 200, "{}", response.text());
    let results = response.json()["results"].clone();
    assert_eq!(results.as_array().unwrap().len(), 1);
    assert_eq!(results[0]["path"], "tools/order.comparator.test.yaml");
    assert_eq!(results[0]["projection"], "example");
    assert_eq!(results[0]["cases"][0]["status"], "pass");
    assert_eq!(results[0]["cases"][1]["status"], "fail");
    assert_eq!(results[0]["cases"][1]["failures"][0]["expectation"], "/cases/1/snapshot");

    let one = run(json!({"path": "tools/order.comparator.test.yaml", "cases": ["core leads"], "projection": "example"})).await;
    assert_eq!(one.status, 200, "{}", one.text());
    let cases = one.json()["results"][0]["cases"].clone();
    assert_eq!(cases.as_array().unwrap().len(), 1);
    assert_eq!(cases[0]["id"], "core leads");
    assert!(one.json()["results"][0].get("coverage").is_none());

    // `coverage` adds the comparator file's rule coverage.
    let covered = run(json!({"path": "tools/order.comparator.test.yaml", "cases": ["core leads"], "coverage": true})).await;
    assert_eq!(covered.status, 200, "{}", covered.text());
    let coverage = covered.json()["results"][0]["coverage"].clone();
    assert_eq!(coverage["comparator"], "tools/order.comparator.yaml");
    assert_eq!(coverage["entries"]["format"], "projections.rules-coverage");
    assert!(coverage["summary"]["branches"]["total"].as_u64().unwrap() > 0, "{coverage}");
    assert!(coverage["uncovered"].is_array());

    // Writing snapshots writes repository files.
    let update = run(json!({"update": true})).await;
    assert_eq!(update.status, 403, "{}", update.text());
    assert!(update.text().contains("--trust"));
    assert!(!repo.join("tools/snapshots/order.json").exists());
    for invalid in [
        json!({"path": "tools/order.comparator.yaml"}),
        json!({"cases": ["core leads"]}),
        json!({"update": "yes"}),
        json!({"coverage": 1}),
        json!({"projection": "example", "extra": 1}),
    ] {
        assert_eq!(run(invalid.clone()).await.status, 400, "{invalid}");
    }

    // A test file that isn't valid is listed with where it is wrong.
    fs::write(
        repo.join("tools/order.comparator.test.yaml"),
        "format: projections.comparator-tests\nversion: 0\ncases:\n  - name: x\n    before: a.json\n    after: b.json\n",
    )
    .unwrap();
    let listed = fixture.get("/api/comparator-tests").await.json();
    assert_eq!(listed["files"][0]["cases"], json!([]));
    assert_eq!(
        listed["files"][0]["diagnostics"],
        json!([{"pointer": "/cases/0",
            "message": "A case asserts nothing: give it `expect`, a `snapshot`, or both",
            "location": {"path": "tools/order.comparator.test.yaml", "line": 4, "column": 11}}])
    );
    fixture.close().await;

    let trusted = Fixture::new(true, false, false).await;
    let repo = trusted.root.join("repo");
    comparator_tests_repository(&repo);
    let response = trusted
        .request("POST", "/api/comparator-tests/run", trusted.auth(), br#"{"update": true}"#)
        .await;
    assert_eq!(response.status, 200, "{}", response.text());
    let result = &response.json()["results"][0];
    assert_eq!(result["written"], json!(["tools/snapshots/order.json"]));
    assert_eq!(result["cases"][1]["status"], "pass");
    assert!(repo.join("tools/snapshots/order.json").is_file());
    trusted.close().await;
}
