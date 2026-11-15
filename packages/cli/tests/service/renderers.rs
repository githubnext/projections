//! Assets and renderer bundles: what is served, and under which trust.

use std::fs;

use projections_cli::service;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::common::{Fixture, assets, commit_all, git};

#[tokio::test]
async fn renderer_traversal_symlinks_and_size_are_rejected() {
    let fixture = Fixture::new(false, true, false).await;
    let renderers = fixture.root.join("viewer/renderers");
    fs::create_dir_all(renderers.join("basic")).unwrap();
    fs::write(renderers.join("basic/index.html"), "<!doctype html>").unwrap();
    for path in [
        "/renderers/%2e%2e/secret",
        "/renderers/a/%2e/secret",
        "/renderers/a//secret",
        "/renderers/a%5csecret",
        "/renderers/%00",
        "/renderers/%ff",
        "/renderers/%xx",
    ] {
        assert_eq!(fixture.request("GET", path, vec![], b"").await.status, 400, "{path}");
    }
    assert_eq!(fixture.get("/renderers/absent/index.html").await.status, 404);
    assert_eq!(
        fixture
            .request("POST", "/renderers/basic/index.html", fixture.auth(), b"{}")
            .await
            .status,
        405
    );
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("basic/index.html", renderers.join("link.html")).unwrap();
        std::os::unix::fs::symlink("basic", renderers.join("link")).unwrap();
        assert_eq!(fixture.get("/renderers/link.html").await.status, 403);
        assert_eq!(fixture.get("/renderers/link/index.html").await.status, 403);
    }
    fs::File::create(renderers.join("large.html"))
        .unwrap()
        .set_len(16 * 1024 * 1024 + 1)
        .unwrap();
    assert_eq!(fixture.get("/renderers/large.html").await.status, 404);
    fixture.close().await;
}

#[tokio::test]
async fn missing_source_and_incompatible_browser_assets_fail_before_startup() {
    let root = std::env::current_dir()
        .unwrap()
        .join("target")
        .join(format!("inspector-assets-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let options = || service::InspectorOptions {
        repo: root.clone(),
        trust: false,
        document: Some(Value::Null),
        custom_renderers: false,
        assets: root.clone(),
        fixtures: None,
        executable: Some(env!("CARGO_BIN_EXE_projections").into()),
        explore: None,
        candidates: Vec::new(),
        execution: Default::default(),
    };
    assert!(service::Service::new(options()).await.is_err());
    assets(&root);
    // The mountable bundle hosts load must be a prebuilt script.
    fs::write(root.join("mount.js"), "").unwrap();
    assert!(service::Service::new(options()).await.is_err());
    assets(&root);
    fs::remove_file(root.join("mount.css")).unwrap();
    assert!(service::Service::new(options()).await.is_err());
    assets(&root);
    fs::write(root.join("engine/engine.wasm"), b"not Wasm").unwrap();
    assert!(service::Service::new(options()).await.is_err());
    assets(&root);
    fs::remove_file(root.join("engine/worker-entry.js")).unwrap();
    assert!(service::Service::new(options()).await.is_err());
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn trust_policies_and_renderers_outside_the_checkout() {
    let fixture = Fixture::new(false, false, false).await;
    let repo = fixture.root.join("repo");
    let renderer = |html: &str| {
        fs::create_dir_all(repo.join("ui")).unwrap();
        fs::write(
            repo.join("ui/renderer.json"),
            r#"{"format":"projections.renderer","version":0,"name":"flags","title":"Flags","handles":[]}"#,
        )
        .unwrap();
        fs::write(repo.join("ui/index.html"), html).unwrap();
    };
    renderer("<!doctype html><p>base</p>");
    fs::write(
        repo.join(".projections/custom.json"),
        serde_json::to_vec(&json!({"id": "custom", "extractor": "repository-map",
            "renderer": {"bundle": "ui"}}))
        .unwrap(),
    )
    .unwrap();
    let base = commit_all(&repo);
    git(&repo, &["checkout", "--quiet", "-b", "side"]);
    renderer("<!doctype html><p>side</p>");
    let side = commit_all(&repo);
    git(&repo, &["checkout", "--quiet", &base]);

    let definitions = fixture.get("/api/definitions").await.json();
    assert_eq!(definitions["executionAuthorized"], false);
    assert_eq!(
        definitions["policies"],
        json!([
            {"id": "custom", "requiresTrust": false, "rendererRequiresTrust": false},
            {"id": "example", "requiresTrust": true, "rendererRequiresTrust": false},
        ])
    );
    let definitions = fixture.get(&format!("/api/definitions?ref={side}")).await.json();
    assert_eq!(
        definitions["policies"][0],
        json!({"id": "custom", "requiresTrust": false, "rendererRequiresTrust": true})
    );

    // A built-in extractor that runs no repository code needs no --trust.
    let job = fixture.job(json!({"projectionId": "custom", "before": "HEAD"})).await;
    let job = fixture.finished(job["id"].as_str().unwrap()).await;
    assert_eq!(job["status"], "completed", "{job}");

    let prefix = fixture.get("/api/renderers").await.json()["customRendererBase"]
        .as_str()
        .unwrap()
        .to_owned();
    for (revision, status) in [("working-tree", 200), (base.as_str(), 200), (side.as_str(), 403)] {
        let response = fixture
            .request("GET", &format!("{prefix}{revision}/custom/index.html"), vec![], b"")
            .await;
        assert_eq!(response.status, status, "{revision}: {}", response.text());
    }
    // A symbolic revision isn't a renderer URL segment: its definitions name the commit, which is.
    let head = fixture.get("/api/definitions?ref=HEAD").await.json();
    assert_eq!(head["ref"], "HEAD");
    assert_eq!(head["commit"], base.as_str());
    assert_eq!(definitions["commit"], json!(side));
    assert!(fixture.get("/api/definitions").await.json().get("commit").is_none());
    for (revision, status) in [("HEAD", 400), (head["commit"].as_str().unwrap(), 200)] {
        let response = fixture
            .request("GET", &format!("{prefix}{revision}/custom/index.html"), vec![], b"")
            .await;
        assert_eq!(response.status, status, "{revision}: {}", response.text());
    }
    fixture.close().await;
}
