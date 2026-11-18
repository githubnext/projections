//! Fixtures mode: renderer scenarios without a repository.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::Result;
use axum::{body::Body, extract::Request};
use projections_cli::service;
use serde_json::{Value, json};
use tokio::time::{sleep, timeout};
use uuid::Uuid;

use crate::common::{Fixture, HttpResponse, assets};

const PROBE: &str = "globalThis.projectionsProbe = 0;";

/// The fixtures-mode assets: the check probe and one built-in renderer.
fn fixture_assets(viewer: &Path) {
    fs::create_dir_all(viewer.join("fixtures")).unwrap();
    fs::write(viewer.join("fixtures/probe.js"), PROBE).unwrap();
    fs::create_dir_all(viewer.join("renderers/basic")).unwrap();
    let manifest = json!({"format": "projections.renderer", "version": 0, "name": "basic",
        "title": "Basic", "handles": ["graph"]});
    fs::write(
        viewer.join("renderers/index.json"),
        serde_json::to_vec(&json!({"format": "projections.renderers", "version": 0, "renderers": [manifest]})).unwrap(),
    )
    .unwrap();
    fs::write(
        viewer.join("renderers/basic/index.html"),
        "<!doctype html><HTML><HEAD><title>basic</title></HEAD><body></body></HTML>",
    )
    .unwrap();
    fs::write(viewer.join("renderers/basic/renderer.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
}

fn scenario_extraction(label: &str) -> Value {
    json!({"protocolVersion": 0, "schema": "graph/v0",
        "entities": [{"id": "a", "kind": "item", "label": label}], "relationships": []})
}

/// A scenarios directory `graph` with a file extraction and a renderer bundle.
fn scenario_files(root: &Path) -> PathBuf {
    let graph = root.join("graph");
    fs::create_dir_all(graph.join("dist")).unwrap();
    fs::write(
        graph.join("before.json"),
        serde_json::to_vec(&scenario_extraction("Before")).unwrap(),
    )
    .unwrap();
    fs::write(
        graph.join("dist/index.html"),
        "<!doctype html><head><title>custom</title></head><body>custom</body>",
    )
    .unwrap();
    fs::write(
        graph.join("dist/renderer.json"),
        r#"{"format":"projections.renderer","version":0,"name":"custom","title":"Custom","handles":["graph"]}"#,
    )
    .unwrap();
    fs::write(
        graph.join("scenarios.json"),
        serde_json::to_vec(&json!({
            "format": "projections.scenarios", "version": 0, "title": "Graph", "renderer": "graph",
            "scenarios": [
                {"id": "change", "title": "Change", "before": "before.json",
                    "after": scenario_extraction("After")},
                {"id": "custom", "title": "Custom", "extraction": "before.json",
                    "renderer": {"bundle": "dist"}},
            ],
        }))
        .unwrap(),
    )
    .unwrap();
    graph
}

#[tokio::test]
async fn fixtures_mode_serves_scenarios_and_renderers_without_a_repository() {
    let fixture = Fixture::fixtures(|_| {}).await.unwrap();
    let response = fixture.get("/api/fixtures").await;
    assert_eq!(response.status, 200, "{}", response.text());
    let fixtures = response.json();
    assert_eq!(fixtures["generation"], 1);
    assert_eq!(fixtures["sources"][0]["key"], "graph");
    assert_eq!(fixtures["sources"][0]["title"], "Graph");
    let change = &fixtures["scenarios"][0];
    assert_eq!(change["key"], "graph/change");
    assert_eq!(change["group"], "Graph");
    assert_eq!(change["renderer"], "graph");
    assert_eq!(change["subject"]["before"]["entities"][0]["label"], "Before");
    assert_eq!(change["subject"]["after"]["entities"][0]["label"], "After");
    assert_eq!(change["comparator"], json!({"default": true, "options": {}}));
    let custom = &fixtures["scenarios"][1];
    assert_eq!(custom["subject"]["mode"], "extraction");
    let renderer = &fixtures["renderers"][0];
    assert_eq!(custom["renderer"]["bundle"], renderer["key"]);
    assert_eq!(renderer["manifest"]["name"], "custom");
    let url = renderer["url"].as_str().unwrap().to_owned();
    let (path, query) = url.split_once('?').unwrap();
    assert!(path.starts_with("/custom-renderers/") && path.ends_with("/index.html"));
    assert!(query.starts_with("v=") && query.len() == 18);

    // Renderer documents get the check probe and the renderer CSP; frames
    // can't send the bearer token, so the capability path authorizes them.
    let document = fixture.request("GET", &url, vec![], b"").await;
    assert_eq!(document.status, 200, "{}", document.text());
    assert_eq!(document.headers["content-security-policy"], service::RENDERER_CSP);
    assert_eq!(document.headers["content-type"], "text/html; charset=utf-8");
    assert_eq!(
        document.text(),
        format!("<!doctype html><head><title>custom</title><script>{PROBE}</script></head><body>custom</body>")
    );
    let base = path.strip_suffix("index.html").unwrap();
    let manifest = fixture.request("GET", &format!("{base}renderer.json"), vec![], b"").await;
    assert_eq!(manifest.status, 200);
    assert_eq!(manifest.json()["name"], "custom");
    assert!(!manifest.text().contains(PROBE));
    let key = renderer["key"].as_str().unwrap();
    let capability_base = base.strip_suffix(&format!("{key}/")).unwrap();
    for path in [
        format!("{capability_base}0000000000000000/index.html"),
        format!("{base}other.js"),
        format!("{base}assets/index.html"),
        format!("{base}%2e%2e/index.html"),
        format!("/custom-renderers/{}/index.html", "0".repeat(64)),
        format!("{capability_base}{key}"),
        url.replace("/fixtures/", "/working-tree/"),
    ] {
        let response = fixture.request("GET", &path, vec![], b"").await;
        assert!([400, 404].contains(&response.status), "{path}: {}", response.status);
    }

    let builtin = fixture.request("GET", "/renderers/basic/index.html", vec![], b"").await;
    assert_eq!(builtin.status, 200);
    assert_eq!(builtin.headers["content-security-policy"], service::RENDERER_CSP);
    assert_eq!(
        builtin.text(),
        format!("<!doctype html><HTML><HEAD><title>basic</title><script>{PROBE}</script></HEAD><body></body></HTML>")
    );
    let builtin_manifest = fixture.request("GET", "/renderers/basic/renderer.json", vec![], b"").await;
    assert!(!builtin_manifest.text().contains(PROBE));

    for (method, path) in [
        ("GET", "/api/definitions"),
        ("GET", "/api/revisions"),
        ("GET", "/api/comparator?projection=example"),
        ("POST", "/api/jobs"),
        ("GET", "/api/jobs/0123"),
    ] {
        let response = fixture
            .request(method, path, fixture.auth(), br#"{"projectionId":"example","before":"HEAD"}"#)
            .await;
        assert_eq!(response.status, 403, "{path}");
        assert!(response.text().contains("Fixtures mode has no repository"));
    }
    let renderers = fixture.get("/api/renderers").await.json();
    assert_eq!(renderers["renderers"][0]["name"], "basic");
    assert_eq!(renderers["customRendererBase"], Value::Null);
    assert_eq!(fixture.get("/api/document").await.json()["document"], Value::Null);
    let started = std::time::Instant::now();
    let changes = fixture.get("/api/fixtures/changes?since=0").await;
    assert_eq!(changes.json(), json!({"generation": 1}));
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(fixture.get("/api/fixtures/changes").await.status, 400);
    assert_eq!(fixture.get("/api/fixtures/changes?since=x").await.status, 400);

    // A symlinked bundle file is never served. Creating one on Windows needs
    // Developer Mode or administrator rights, so the check runs on Unix.
    #[cfg(unix)]
    {
        let dist = fixture.root.join("graph/dist");
        fs::rename(dist.join("renderer.json"), dist.join("real.json")).unwrap();
        std::os::unix::fs::symlink(dist.join("real.json"), dist.join("renderer.json")).unwrap();
        assert_eq!(
            fixture.request("GET", &format!("{base}renderer.json"), vec![], b"").await.status,
            404
        );
    }
    fixture.close().await;
}

/// A bundle the scenarios name is repository code: without --trust it is served
/// only when named with --renderer, and otherwise withheld with why.
#[tokio::test]
async fn bundles_the_scenarios_name_need_trust_or_renderer() {
    for (trust, named, served) in [(false, false, false), (false, true, true), (true, false, true)] {
        let fixture = Fixture::fixtures_with(trust, named, |_| {}).await.unwrap();
        let fixtures = fixture.get("/api/fixtures").await.json();
        let custom = &fixtures["scenarios"][1];
        let renderer = fixtures["renderers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|renderer| renderer["key"] == custom["renderer"]["bundle"])
            .unwrap()
            .clone();
        assert_eq!(renderer["url"].is_string(), served, "{trust} {named}: {renderer}");
        if served {
            let document = fixture.request("GET", renderer["url"].as_str().unwrap(), vec![], b"").await;
            assert_eq!(document.status, 200);
        } else {
            assert!(renderer["withheld"].as_str().unwrap().contains("--trust"), "{renderer}");
            assert!(renderer.get("manifest").is_none());
        }
        fixture.close().await;
    }
}

#[tokio::test]
async fn fixtures_mode_reloads_changed_files_and_wakes_long_polls() {
    let fixture = Fixture::fixtures(|_| {}).await.unwrap();
    let before = fixture.root.join("graph/before.json");
    let started = std::time::Instant::now();
    let (changes, ()) = tokio::join!(fixture.get("/api/fixtures/changes?since=1"), async {
        sleep(Duration::from_millis(400)).await;
        fs::write(&before, serde_json::to_vec(&scenario_extraction("Edited before")).unwrap()).unwrap();
    });
    assert_eq!(changes.status, 200);
    assert_eq!(changes.json(), json!({"generation": 2}));
    assert!(started.elapsed() < Duration::from_secs(5));
    let fixtures = fixture.get("/api/fixtures").await.json();
    assert_eq!(fixtures["generation"], 2);
    assert_eq!(
        fixtures["scenarios"][0]["subject"]["before"]["entities"][0]["label"],
        "Edited before"
    );
    assert_eq!(
        fixtures["scenarios"][1]["subject"]["extraction"]["entities"][0]["label"],
        "Edited before"
    );

    // A broken file becomes an error entry, and fixing it recovers.
    fs::write(&before, "{").unwrap();
    let changes = fixture.get("/api/fixtures/changes?since=2").await.json();
    assert_eq!(changes["generation"], 3);
    let fixtures = fixture.get("/api/fixtures").await.json();
    assert!(fixtures["scenarios"][0]["error"].is_string());
    assert!(fixtures["scenarios"][0].get("subject").is_none());
    let old_url = fixtures["renderers"][0]["url"].as_str().unwrap().to_owned();
    fs::write(fixture.root.join("graph/dist/index.html"), "<!doctype html><body>edited</body>").unwrap();
    let changes = fixture.get("/api/fixtures/changes?since=3").await.json();
    assert_eq!(changes["generation"], 4);
    let fixtures = fixture.get("/api/fixtures").await.json();
    let url = fixtures["renderers"][0]["url"].as_str().unwrap();
    assert_ne!(url, old_url);
    let document = fixture.request("GET", url, vec![], b"").await;
    assert_eq!(
        document.text(),
        format!("<script>{PROBE}</script><!doctype html><body>edited</body>")
    );

    // Shutdown ends a pending long poll promptly.
    let service = fixture.service.clone();
    let pending = tokio::spawn(async move {
        let request = Request::builder().uri("/api/fixtures/changes?since=4").body(Body::empty()).unwrap();
        HttpResponse::read(service.handle(request).await).await
    });
    sleep(Duration::from_millis(200)).await;
    let closing = std::time::Instant::now();
    fixture.close().await;
    assert!(closing.elapsed() < Duration::from_secs(5));
    let response = timeout(Duration::from_secs(5), pending).await.unwrap().unwrap();
    assert_eq!(response.status, 200);
    assert_eq!(response.json(), json!({"generation": 4}));
}

#[tokio::test]
async fn fixtures_mode_requires_a_safe_probe_and_existing_paths() {
    assert!(
        Fixture::fixtures(|viewer| fs::remove_file(viewer.join("fixtures/probe.js")).unwrap())
            .await
            .is_err()
    );
    assert!(
        Fixture::fixtures(|viewer| fs::write(viewer.join("fixtures/probe.js"), "document.write('</SCRIPT>')").unwrap())
            .await
            .is_err()
    );
    let root = std::env::current_dir()
        .unwrap()
        .join("target")
        .join(format!("inspector-fixtures-{}", Uuid::new_v4()));
    let viewer = root.join("viewer");
    assets(&viewer);
    fixture_assets(&viewer);
    for (sources, renderers) in [
        (vec![root.join("missing.json")], vec![]),
        (vec![root.clone()], vec![]),
        (vec![scenario_files(&root)], vec![root.join("missing")]),
    ] {
        let error = service::Service::new(service::InspectorOptions {
            repo: root.clone(),
            trust: false,
            document: None,
            custom_renderers: false,
            assets: viewer.clone(),
            fixtures: Some(service::FixturesOptions {
                sources,
                renderers,
                trust: false,
            }),
            executable: Some(env!("CARGO_BIN_EXE_projections").into()),
            explore: None,
            candidates: Vec::new(),
            execution: Default::default(),
        })
        .await
        .err()
        .unwrap();
        let message = error.to_string();
        assert!(
            message.contains("does not exist") || message.contains("no scenarios.json"),
            "{message}"
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn repository_mode_has_no_fixtures_api_or_probe() {
    let fixture = Fixture::new(false, false, false).await;
    fixture_assets(&fixture.root.join("viewer"));
    let response = fixture.get("/api/fixtures").await;
    assert_eq!(response.status, 404);
    assert!(response.text().contains("Unknown Inspector API route"));
    assert_eq!(fixture.get("/api/fixtures/changes?since=0").await.status, 404);
    let builtin = fixture.request("GET", "/renderers/basic/index.html", vec![], b"").await;
    assert_eq!(builtin.status, 200);
    assert!(!builtin.text().contains(PROBE));
    let prefix = fixture.get("/api/renderers").await.json()["customRendererBase"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_ne!(
        fixture
            .request("GET", &format!("{prefix}fixtures/0000000000000000/index.html"), vec![], b"")
            .await
            .status,
        200
    );
    fixture.close().await;
}

impl Fixture {
    /// Fixtures mode over the `graph` scenarios, trusted to serve the bundle they name.
    async fn fixtures(viewer_setup: impl FnOnce(&Path)) -> Result<Self> {
        Self::fixtures_with(true, false, viewer_setup).await
    }

    /// Fixtures mode over the `graph` scenarios; `named` passes their bundle as `--renderer`.
    async fn fixtures_with(trust: bool, named: bool, viewer_setup: impl FnOnce(&Path)) -> Result<Self> {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join(format!("inspector-fixtures-{}", Uuid::new_v4()));
        let viewer = root.join("viewer");
        assets(&viewer);
        fixture_assets(&viewer);
        viewer_setup(&viewer);
        let graph = scenario_files(&root);
        let started = service::Service::new(service::InspectorOptions {
            repo: root.join("absent-repository"),
            trust: false,
            document: None,
            custom_renderers: false,
            assets: viewer,
            fixtures: Some(service::FixturesOptions {
                renderers: if named { vec![graph.join("dist")] } else { Vec::new() },
                sources: vec![graph],
                trust,
            }),
            executable: Some(env!("CARGO_BIN_EXE_projections").into()),
            explore: None,
            candidates: Vec::new(),
            execution: Default::default(),
        })
        .await;
        match started {
            Ok(service) => Ok(Self {
                root,
                service: Arc::new(service),
            }),
            Err(error) => {
                let _ = fs::remove_dir_all(&root);
                Err(error)
            }
        }
    }
}
