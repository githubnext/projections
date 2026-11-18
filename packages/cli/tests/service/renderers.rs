//! Assets and renderer bundles: what is served, and under which trust.

use std::{fs, path::Path};

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

/// The renderer `ui` with its manifest and this page, and the projection `custom` that uses it.
fn custom_renderer(repo: &Path, html: &str) {
    fs::create_dir_all(repo.join("ui")).unwrap();
    fs::write(
        repo.join("ui/renderer.json"),
        r#"{"format":"projections.renderer","version":0,"name":"flags","title":"Flags","handles":[]}"#,
    )
    .unwrap();
    fs::write(repo.join("ui/index.html"), html).unwrap();
    fs::write(
        repo.join(".projections/custom.json"),
        serde_json::to_vec(&json!({"id": "custom", "extractor": "repository-map", "renderer": {"bundle": "ui"}})).unwrap(),
    )
    .unwrap();
}

/// Makes `commit` the default branch, as a clone's `refs/remotes/origin/HEAD` names it.
fn default_branch(repo: &Path, commit: &str) {
    git(repo, &["update-ref", "refs/remotes/origin/main", commit]);
    git(repo, &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
}

/// The status of each revision's `custom/index.html` from the service.
async fn renderer_statuses(fixture: &Fixture, revisions: &[&str]) -> Vec<u16> {
    let prefix = fixture.get("/api/renderers").await.json()["customRendererBase"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut statuses = Vec::new();
    for revision in revisions {
        let response = fixture
            .request("GET", &format!("{prefix}{revision}/custom/index.html"), vec![], b"")
            .await;
        statuses.push(response.status);
    }
    statuses
}

#[tokio::test]
async fn custom_renderers_need_trust_unless_they_match_the_default_branch() {
    let fixture = Fixture::new(false, false, false).await;
    let repo = fixture.root.join("repo");
    custom_renderer(&repo, "<!doctype html><p>base</p>");
    let base = commit_all(&repo);
    git(&repo, &["checkout", "--quiet", "-b", "side"]);
    custom_renderer(&repo, "<!doctype html><p>side</p>");
    let side = commit_all(&repo);
    git(&repo, &["checkout", "--quiet", &base]);

    // Without a default branch to compare with, every custom renderer is withheld.
    let policy = |definitions: &Value| definitions["policies"][0].clone();
    let definitions = fixture.get("/api/definitions").await.json();
    assert_eq!(definitions["executionAuthorized"], false);
    assert_eq!(
        policy(&definitions),
        json!({"id": "custom", "requiresTrust": false, "rendererRequiresTrust": true})
    );
    let revisions = ["working-tree", base.as_str(), side.as_str()];
    assert_eq!(renderer_statuses(&fixture, &revisions).await, [403, 403, 403]);

    default_branch(&repo, &base);
    assert_eq!(
        fixture.get("/api/definitions").await.json()["policies"],
        json!([
            {"id": "custom", "requiresTrust": false, "rendererRequiresTrust": false},
            {"id": "example", "requiresTrust": true, "rendererRequiresTrust": false},
        ])
    );
    let definitions = fixture.get(&format!("/api/definitions?ref={side}")).await.json();
    assert_eq!(
        policy(&definitions),
        json!({"id": "custom", "requiresTrust": false, "rendererRequiresTrust": true})
    );
    assert_eq!(renderer_statuses(&fixture, &revisions).await, [200, 200, 403]);
    let prefix = fixture.get("/api/renderers").await.json()["customRendererBase"].clone();
    let response = fixture
        .request("GET", &format!("{}{side}/custom/index.html", prefix.as_str().unwrap()), vec![], b"")
        .await;
    assert!(response.text().contains("--trust"), "{}", response.text());

    // A built-in extractor that runs no repository code needs no --trust.
    let job = fixture.job(json!({"projectionId": "custom", "before": "HEAD"})).await;
    let job = fixture.finished(job["id"].as_str().unwrap()).await;
    assert_eq!(job["status"], "completed", "{job}");

    // A symbolic revision isn't a renderer URL segment: its definitions name the commit, which is.
    let head = fixture.get("/api/definitions?ref=HEAD").await.json();
    assert_eq!(head["ref"], "HEAD");
    assert_eq!(head["commit"], base.as_str());
    assert_eq!(definitions["commit"], json!(side));
    assert!(fixture.get("/api/definitions").await.json().get("commit").is_none());
    assert_eq!(
        renderer_statuses(&fixture, &["HEAD", head["commit"].as_str().unwrap()]).await,
        [400, 200]
    );

    // Uncommitted changes to the renderer are repository code the default branch doesn't have.
    custom_renderer(&repo, "<!doctype html><p>edited</p>");
    assert_eq!(policy(&fixture.get("/api/definitions").await.json())["rendererRequiresTrust"], true);
    assert_eq!(renderer_statuses(&fixture, &["working-tree"]).await, [403]);
    git(&repo, &["checkout", "--quiet", "--", "."]);

    // A checked-out pull request head is HEAD and the working tree, and still differs from the default branch.
    git(&repo, &["checkout", "--quiet", "side"]);
    assert_eq!(policy(&fixture.get("/api/definitions").await.json())["rendererRequiresTrust"], true);
    assert_eq!(renderer_statuses(&fixture, &revisions).await, [403, 200, 403]);
    // One that leaves the renderer alone runs it.
    git(&repo, &["checkout", "--quiet", "-b", "unchanged", &base]);
    fs::write(repo.join("unrelated.txt"), "unrelated").unwrap();
    let unchanged = commit_all(&repo);
    assert_eq!(renderer_statuses(&fixture, &["working-tree", unchanged.as_str()]).await, [200, 200]);
    fixture.close().await;
}

#[tokio::test]
async fn trusted_services_run_every_custom_renderer() {
    let fixture = Fixture::new(true, false, false).await;
    let repo = fixture.root.join("repo");
    custom_renderer(&repo, "<!doctype html><p>base</p>");
    let base = commit_all(&repo);
    git(&repo, &["checkout", "--quiet", "-b", "side"]);
    custom_renderer(&repo, "<!doctype html><p>side</p>");
    let side = commit_all(&repo);
    // The pull request head checked out, with no default branch at all.
    let definitions = fixture.get("/api/definitions").await.json();
    assert_eq!(definitions["executionAuthorized"], true);
    assert_eq!(definitions["policies"][0]["rendererRequiresTrust"], true);
    let statuses = renderer_statuses(&fixture, &["working-tree", base.as_str(), side.as_str()]).await;
    assert_eq!(statuses, [200, 200, 200]);
    fixture.close().await;
}

/// A renderer development server serves the package's live sources, not the
/// bundle the trust policy compared, so the Inspector is offered one only with --trust.
#[tokio::test]
async fn renderer_development_servers_need_trust() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        use std::io::{Read, Write};
        let manifest = r#"{"format":"projections.renderer","version":0,"name":"flags","title":"Flags","handles":[]}"#;
        for mut stream in listener.incoming().flatten() {
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request);
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{manifest}",
                manifest.len()
            );
        }
    });
    for trust in [false, true] {
        let fixture = Fixture::new(trust, false, false).await;
        let repo = fixture.root.join("repo");
        custom_renderer(&repo, "<!doctype html><p>built</p>");
        // The bundle as a renderer package's build output: `ui/dist` beside its package.json.
        fs::rename(repo.join("ui"), repo.join("dist")).unwrap();
        fs::create_dir_all(repo.join("ui")).unwrap();
        fs::rename(repo.join("dist"), repo.join("ui/dist")).unwrap();
        fs::write(repo.join("ui/package.json"), r#"{"name":"flags","private":true}"#).unwrap();
        fs::write(
            repo.join(".projections/custom.json"),
            serde_json::to_vec(&json!({"id": "custom", "extractor": "repository-map", "renderer": {"bundle": "ui/dist"}})).unwrap(),
        )
        .unwrap();
        let commit = commit_all(&repo);
        default_branch(&repo, &commit);
        fs::create_dir_all(repo.join("ui/node_modules/.projections")).unwrap();
        fs::write(
            repo.join("ui/node_modules/.projections/renderer-dev-server.json"),
            serde_json::to_vec(&json!({"format": "projections.renderer-dev-server", "version": 0,
                "url": format!("http://127.0.0.1:{port}/"), "name": "flags"}))
            .unwrap(),
        )
        .unwrap();
        // The CLI gives a development server 300 ms to answer; under load a trusted read may miss it, so it is retried.
        let mut policy = Value::Null;
        for _ in 0..10 {
            policy = fixture.get("/api/definitions").await.json()["policies"][0].clone();
            if !trust || policy.get("rendererDevServer").is_some() {
                break;
            }
        }
        assert_eq!(
            policy["rendererRequiresTrust"], false,
            "the built bundle matches the default branch's"
        );
        assert_eq!(policy.get("rendererDevServer").is_some(), trust, "{trust}: {policy}");
        fixture.close().await;
    }
}
