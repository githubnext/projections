//! Definitions, revisions, comparators and the requests the service accepts.

use std::fs;

use projections_cli::artifact;
use serde_json::json;

use crate::common::Fixture;

#[tokio::test]
async fn the_service_lists_definitions_and_revisions_and_serves_no_page() {
    let fixture = Fixture::new(false, false, false).await;
    // No page: the API, renderer bundles and, under /inspector/, the Inspector's
    // scripts and styles for a host that doesn't ship them (never a document).
    for path in [
        "/",
        "/index.html",
        "/mount.js",
        "/engine/engine.wasm",
        "/inspector/index.html",
        "/inspector/renderers/index.json",
        "/inspector/missing.js",
    ] {
        assert_eq!(fixture.get(path).await.status, 404, "{path}");
    }
    let mount = fixture.get("/inspector/mount.js").await;
    assert_eq!(mount.status, 200);
    assert_eq!(mount.text(), "export {};");
    assert!(mount.headers["content-type"].contains("javascript"));
    assert!(mount.headers["content-security-policy"].contains("script-src 'self'"));
    assert_eq!(fixture.get("/inspector/engine/engine.wasm").await.status, 200);
    let definitions = fixture.request("GET", "/api/definitions", fixture.auth(), b"").await;
    assert_eq!(definitions.status, 200, "{}", definitions.text());
    assert_eq!(definitions.json()["executionAuthorized"], false);
    assert!(
        definitions.json()["definitions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == "example")
    );
    let revisions = fixture.request("GET", "/api/revisions", fixture.auth(), b"").await;
    assert_eq!(revisions.json()["revisions"][0]["ref"], "working-tree");
    assert_eq!(revisions.json()["revisions"][1]["title"], "Native fixture");
    assert_eq!(revisions.json()["revisions"][1]["kind"], "commit");
    // The working tree's identity for a projection, matching what an
    // extraction of it records.
    let identity = fixture.get("/api/identity?projection=example").await;
    assert_eq!(identity.status, 200, "{}", identity.text());
    let identity = identity.json();
    assert!(identity["tree"].as_str().unwrap().len() >= 40);
    assert!(identity["definitionDigest"].as_str().unwrap().starts_with("sha256:"));
    assert_eq!(fixture.get("/api/identity?projection=missing").await.status, 400);
    assert_eq!(fixture.get("/api/identity").await.status, 400);
    fixture.close().await;
}

#[tokio::test]
async fn strict_json_limits_fields_and_startup_trust() {
    let fixture = Fixture::new(false, false, false).await;
    for body in [
        br#"{"projectionId":"example","before":"HEAD","trust":true}"#.as_slice(),
        br#"{"projectionId":"example","before":"HEAD","before":"working-tree"}"#,
        br#"{"projectionId":"../example","before":"HEAD"}"#,
        br#"{"projectionId":"example","before":""}"#,
        br#"{"projectionId":"example","before":"HEAD","after":null}"#,
        br#"[]"#,
        br#"{"projectionId":"\ud800","before":"HEAD"}"#,
        b"\xff",
    ] {
        let response = fixture.request("POST", "/api/jobs", fixture.auth(), body).await;
        assert_eq!(response.status, 400, "{}", response.text());
        assert_eq!(response.json()["diagnostics"][0]["code"], "RUNNER_ERROR");
    }
    let headers = vec![("Content-Type", "text/plain".to_owned())];
    assert_eq!(fixture.request("POST", "/api/jobs", headers, b"{}").await.status, 415);
    let too_large = vec![b' '; 4097];
    assert_eq!(fixture.request("POST", "/api/jobs", fixture.auth(), &too_large).await.status, 413);
    let request = json!({"projectionId": "example", "before": "HEAD"});
    let created = fixture.job(request).await;
    let result = fixture.finished(created["id"].as_str().unwrap()).await;
    assert_eq!(result["status"], "failed");
    assert!(result["diagnostics"][0]["message"].as_str().unwrap().contains("--trust"));
    assert_eq!(result["outputs"], json!([]));
    fixture.close().await;
}

#[tokio::test]
async fn offline_review_cannot_execute_or_touch_missing_repository() {
    let fixture = Fixture::new(true, true, false).await;
    let document = fixture.request("GET", "/api/document", fixture.auth(), b"").await.json();
    assert_eq!(document["document"]["format"], "offline-fixture");
    let definitions = fixture.request("GET", "/api/definitions", fixture.auth(), b"").await.json();
    assert_eq!(definitions["definitions"], json!([]));
    assert_eq!(definitions["executionAuthorized"], false);
    assert_eq!(
        fixture.request("GET", "/api/revisions", fixture.auth(), b"").await.json(),
        json!({"revisions":[]})
    );
    assert_eq!(
        fixture
            .request(
                "POST",
                "/api/jobs",
                fixture.auth(),
                br#"{"projectionId":"example","before":"HEAD"}"#
            )
            .await
            .status,
        403
    );
    fixture.close().await;
}

#[tokio::test]
async fn comparators_revisions_renderers_and_definition_selection() {
    let fixture = Fixture::new(true, false, false).await;
    let repo = fixture.root.join("repo");
    fs::create_dir_all(repo.join("tools")).unwrap();
    let rules = "format: projections.comparator\nversion: 0\nsteps:\n  rank: 'null'\n";
    fs::write(repo.join("tools/order.comparator.yaml"), rules).unwrap();
    fs::create_dir_all(repo.join("ui/dist")).unwrap();
    fs::write(
        repo.join("ui/dist/renderer.json"),
        r#"{"format":"projections.renderer","version":0,"name":"flags","title":"Flags","handles":["graph/v0"]}"#,
    )
    .unwrap();
    fs::write(
        repo.join("ui/dist/index.html"),
        "<!doctype html><script src=\"./assets/app.js\"></script>",
    )
    .unwrap();
    fs::write(
        repo.join(".projections/custom.json"),
        serde_json::to_vec(&json!({"id": "custom", "extractor": "repository-map",
            "renderer": {"bundle": "ui/dist", "sources": ["ui/dist"]},
            "comparator": "tools/order.comparator.yaml"}))
        .unwrap(),
    )
    .unwrap();

    let default = fixture.get("/api/comparator?projection=example").await;
    assert_eq!(default.status, 200, "{}", default.text());
    assert_eq!(default.json(), json!({"default": true}));
    assert_eq!(fixture.get("/api/comparator").await.status, 400);

    // Comparator files: a projection's own, and any in the repository, by path.
    if projections_cli::assets::rules_comparator_module().is_some() {
        let own = fixture.get("/api/comparator?projection=custom").await.json();
        assert_eq!(own["rules"], artifact::base64(rules.as_bytes()));
        assert!(own["digest"].as_str().unwrap().starts_with("sha256:"));
        let listed = fixture.get("/api/definitions").await.json();
        assert_eq!(listed["rules"], json!(["tools/order.comparator.yaml"]));
        let by_path = fixture.get("/api/comparator?rules=tools/order.comparator.yaml").await.json();
        assert_eq!(by_path, own);
        for invalid in ["tools/order.wasm", "../outside.comparator.yaml", "missing.comparator.yaml"] {
            let response = fixture.get(&format!("/api/comparator?rules={invalid}")).await;
            assert_ne!(response.status, 200, "{invalid}");
        }
    }
    assert_eq!(fixture.get("/api/comparator?projection=custom&ref=HEAD").await.status, 400);

    let revisions = fixture.get("/api/revisions?limit=1").await.json()["revisions"].clone();
    assert_eq!(revisions.as_array().unwrap().len(), 2);
    assert_eq!(revisions[0]["kind"], "working-tree");
    assert_eq!(revisions[0]["dirty"], true);
    assert_eq!(revisions[1]["kind"], "commit");
    assert_eq!(revisions[1]["title"], "Native fixture");
    assert_eq!(fixture.get("/api/revisions?limit=0").await.status, 400);

    assert_eq!(fixture.get("/api/renderers").await.json()["renderers"], json!([]));
    let viewer = fixture.root.join("viewer/renderers");
    fs::create_dir_all(viewer.join("basic")).unwrap();
    fs::write(viewer.join("basic/index.html"), "<!doctype html>").unwrap();
    let manifest = json!({"format":"projections.renderer","version":0,"name":"basic","title":"Basic","handles":["graph"]});
    fs::write(
        viewer.join("index.json"),
        serde_json::to_vec(&json!({"format":"projections.renderers","version":0,"renderers":[manifest]})).unwrap(),
    )
    .unwrap();
    let renderers = fixture.get("/api/renderers").await.json();
    assert_eq!(renderers["renderers"], json!([manifest]));
    let builtin_frame = fixture.request("GET", "/renderers/basic/index.html", vec![], b"").await;
    assert_eq!(builtin_frame.status, 200);
    assert_eq!(
        builtin_frame.headers["content-security-policy"],
        "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"
    );
    assert_eq!(builtin_frame.headers["x-content-type-options"], "nosniff");
    let base = renderers["customRendererBase"].as_str().unwrap().to_owned();
    assert!(base.starts_with("/custom-renderers/") && base.len() > 80);
    let frame = fixture
        .request("GET", &format!("{base}working-tree/custom/index.html"), vec![], b"")
        .await;
    assert_eq!(frame.status, 200, "{}", frame.text());
    let policy = &frame.headers["content-security-policy"];
    assert!(policy.contains("connect-src 'none'") && policy.ends_with("sandbox allow-scripts"));
    assert_eq!(frame.headers["content-type"], "text/html; charset=utf-8");
    let manifest_file = fixture
        .request("GET", &format!("{base}working-tree/custom/renderer.json"), vec![], b"")
        .await;
    assert_eq!(manifest_file.status, 200);
    assert_eq!(manifest_file.headers["content-type"], "application/json");
    for (path, status) in [
        ("/custom-renderers/0000/working-tree/custom/index.html".to_owned(), 404),
        (format!("{base}working-tree/custom/../renderer.json"), 400),
        (format!("{base}main/custom/index.html"), 400),
        (format!("{base}working-tree/example/index.html"), 404),
        (format!("{base}working-tree/custom/missing.js"), 404),
        ("/renderers/missing/index.html".to_owned(), 404),
    ] {
        assert_eq!(fixture.request("GET", &path, vec![], b"").await.status, status, "{path}");
    }
    // A bundle the repository ignores isn't in the working tree, and the error says why.
    fs::write(repo.join("ui/.gitignore"), "dist/\n").unwrap();
    let ignored = fixture
        .request("GET", &format!("{base}working-tree/custom/index.html"), vec![], b"")
        .await;
    assert_eq!(ignored.status, 404);
    assert!(
        ignored.text().contains("ui/dist/index.html is ignored by Git"),
        "{}",
        ignored.text()
    );
    fs::remove_file(repo.join("ui/.gitignore")).unwrap();

    let shared = fixture
        .job(json!({"projectionId": "example", "before": "HEAD", "definitionRevision": "working-tree"}))
        .await;
    let shared = fixture.finished(shared["id"].as_str().unwrap()).await;
    assert_eq!(shared["status"], "completed", "{shared}");
    let compared = fixture
        .job(json!({"projectionId": "example", "before": "HEAD", "after": "working-tree", "definition": "head"}))
        .await;
    let compared = fixture.finished(compared["id"].as_str().unwrap()).await;
    assert_eq!(compared["status"], "completed", "{compared}");
    assert_eq!(compared["notices"], json!([]));
    // One definition revision for both sides, as the agent viewer compares.
    let using = fixture
        .job(json!({"projectionId": "example", "before": "HEAD", "after": "working-tree", "definitionRevision": "working-tree"}))
        .await;
    let using = fixture.finished(using["id"].as_str().unwrap()).await;
    assert_eq!(using["status"], "completed", "{using}");
    assert!(
        using["notices"][0].as_str().unwrap().contains("working tree's definition"),
        "{using}"
    );
    for invalid in [
        json!({"projectionId": "example", "before": "HEAD", "definition": "head"}),
        json!({"projectionId": "example", "before": "HEAD", "after": "HEAD", "definition": "head", "definitionRevision": "HEAD"}),
        json!({"projectionId": "example", "before": "HEAD", "after": "HEAD", "definition": "other"}),
    ] {
        let response = fixture
            .request("POST", "/api/jobs", fixture.auth(), &serde_json::to_vec(&invalid).unwrap())
            .await;
        assert_eq!(response.status, 400, "{invalid}");
    }
    fixture.close().await;
}
