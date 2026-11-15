//! Pairs from history, and sweeps across recent commits.

use std::{fs, time::Duration};

use serde_json::{Value, json};

use crate::common::{Fixture, commit, git};

#[tokio::test]
async fn pairs_list_history_and_choose_a_default_with_changes() {
    let fixture = Fixture::new(true, false, false).await;
    let repo = fixture.root.join("repo");
    // One commit: nothing to compare, so the default is HEAD alone.
    let first = fixture.get("/api/pairs?projection=example").await.json();
    assert_eq!(first["default"]["after"], "HEAD");
    assert!(first["default"].get("before").is_none());

    git(&repo, &["tag", "v1"]);
    fs::write(repo.join("data.txt"), "a\n").unwrap();
    git(&repo, &["add", "data.txt"]);
    commit(&repo, "Add data");
    git(&repo, &["tag", "v2"]);
    // HEAD is tagged: the previous tag to it.
    let tagged = fixture.get("/api/pairs?projection=example").await.json();
    assert_eq!(tagged["default"]["source"], "tag");
    assert_eq!(
        (tagged["default"]["before"].as_str(), tagged["default"]["after"].as_str()),
        (Some("v1"), Some("v2"))
    );
    assert_eq!(tagged["tags"].as_array().unwrap().len(), 2);
    assert!(
        tagged["suggestions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["source"] == "parent")
    );

    // A commit that changes no file: its pairs would compare identical sides.
    commit(&repo, "Empty");
    let empty = fixture.get("/api/pairs?projection=example").await.json();
    assert!(
        empty["suggestions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["identical"] == false),
        "{}",
        empty["suggestions"]
    );
    assert_eq!(empty["default"]["source"], "head");

    // On a feature branch: since the merge base with the default branch.
    git(&repo, &["checkout", "--quiet", "-b", "feature"]);
    fs::write(repo.join("data.txt"), "b\n").unwrap();
    git(&repo, &["add", "data.txt"]);
    commit(&repo, "Change data");
    let feature = fixture.get("/api/pairs?projection=example").await.json();
    assert_eq!(feature["head"]["branch"], "feature");
    assert_eq!(feature["defaultBranch"], "master");
    assert_eq!(feature["default"]["source"], "merge-base");
    assert_eq!(feature["default"]["before"], feature["mergeBase"]);
    assert_eq!(feature["default"]["after"], "working-tree");
    assert_eq!(feature["default"]["label"], "feature since master");
    assert!(
        feature["branches"]
            .as_array()
            .unwrap()
            .iter()
            .any(|branch| branch["name"] == "feature" && branch["current"] == true)
    );

    // Bookmarks come first, except one whose sides are identical; other projections' are listed, not suggested.
    fs::write(
        repo.join(".projections-bookmarks.json"),
        serde_json::to_vec(&json!({"format": "projections.bookmarks", "version": 0, "bookmarks": [
            {"id": "same", "title": "Same", "projectionId": "example", "before": "v2", "after": "v2"},
            {"id": "release", "title": "v1 → v2", "projectionId": "example", "before": "v1", "after": "v2"},
            {"id": "other", "title": "Other", "projectionId": "other", "before": "v1", "after": "v2"},
        ]}))
        .unwrap(),
    )
    .unwrap();
    let bookmarked = fixture.get("/api/pairs?projection=example").await.json();
    assert_eq!(bookmarked["bookmarks"].as_array().unwrap().len(), 3);
    assert_eq!(bookmarked["default"]["bookmark"], "release");
    assert_eq!(bookmarked["default"]["label"], "v1 → v2");
    let suggested: Vec<&Value> = bookmarked["suggestions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["source"] == "bookmark")
        .collect();
    assert_eq!(suggested.len(), 2);
    let same = suggested.iter().find(|item| item["bookmark"] == "same").unwrap();
    assert_eq!(same["identical"], true, "{}", bookmarked["suggestions"]);

    // A bookmark that runs backwards (After older than Before) is listed and flagged, but never the default.
    fs::write(
        repo.join(".projections-bookmarks.json"),
        serde_json::to_vec(&json!({"format": "projections.bookmarks", "version": 0, "bookmarks": [
            {"id": "reversed", "title": "v2 → v1", "projectionId": "example", "before": "v2", "after": "v1"},
        ]}))
        .unwrap(),
    )
    .unwrap();
    let reversed = fixture.get("/api/pairs?projection=example").await.json();
    let listed = reversed["suggestions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["bookmark"] == "reversed")
        .unwrap();
    assert_eq!(listed["backwards"], true, "{}", reversed["suggestions"]);
    assert_ne!(reversed["default"]["bookmark"], "reversed");
    assert!(reversed["default"].get("backwards").is_none());
    assert!(
        reversed["suggestions"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|item| item["source"] != "bookmark")
            .all(|item| item.get("backwards").is_none()),
        "{}",
        reversed["suggestions"]
    );

    // Offline review has no history.
    let offline = Fixture::new(false, true, false).await;
    assert_eq!(offline.get("/api/pairs").await.status, 403);
}

async fn finished_sweep(fixture: &Fixture, body: Value) -> Value {
    let started = fixture
        .request("POST", "/api/sweep", fixture.auth(), &serde_json::to_vec(&body).unwrap())
        .await;
    assert_eq!(started.status, 202);
    let id = started.json()["id"].as_str().unwrap().to_owned();
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    loop {
        let sweep = fixture.get("/api/sweep").await.json()["sweep"].clone();
        assert_eq!(sweep["id"], id.as_str());
        if sweep["status"] != "running" {
            return sweep;
        }
        assert!(std::time::Instant::now() < deadline, "the sweep never finished: {sweep}");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[tokio::test]
async fn sweeps_run_projections_across_recent_commits() {
    let fixture = Fixture::new(true, false, false).await;
    assert_eq!(fixture.get("/api/sweep").await.json()["sweep"], Value::Null);
    let repo = fixture.root.join("repo");
    for (index, message) in ["Add data", "Change data (#4)"].into_iter().enumerate() {
        fs::write(repo.join("data.txt"), format!("{index}\n")).unwrap();
        git(&repo, &["add", "data.txt"]);
        commit(&repo, message);
    }
    let sweep = finished_sweep(&fixture, json!({"projections": ["example"], "last": 5})).await;
    assert_eq!(sweep["status"], "completed", "{sweep}");
    let changes = sweep["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 2, "{changes:?}");
    assert_eq!(changes[0]["number"], 4);
    assert_eq!(changes[0]["kind"], "commit");
    assert_eq!(sweep["projections"][0]["status"], "ready");
    let cells = sweep["cells"].as_array().unwrap();
    assert_eq!(cells.len(), 2);
    // The fixture extractor prints the same state every time.
    assert!(cells.iter().all(|cell| cell["status"] == "unchanged"), "{cells:?}");
    // Only changed cells have a thumbnail.
    let query = format!(
        "/api/sweep/thumbnail?projection=example&before={}&after={}",
        changes[0]["before"].as_str().unwrap(),
        changes[0]["after"].as_str().unwrap()
    );
    assert_eq!(fixture.get(&query).await.status, 404);
    assert_eq!(fixture.get("/api/sweep/thumbnail").await.status, 400);
    // A colour mode: light (the default) or dark, nothing else.
    assert_eq!(fixture.get(&format!("{query}&theme=dark")).await.status, 404);
    assert_eq!(fixture.get(&format!("{query}&theme=purple")).await.status, 400);

    // Bad requests are refused before any work.
    for body in [json!({"last": 0}), json!({"last": 101}), json!({"projections": "example"})] {
        let refused = fixture
            .request("POST", "/api/sweep", fixture.auth(), &serde_json::to_vec(&body).unwrap())
            .await;
        assert_eq!(refused.status, 400, "{body}");
    }
}

#[tokio::test]
async fn sweeps_take_pairs_and_stop_when_asked() {
    let fixture = Fixture::new(true, false, false).await;
    let repo = fixture.root.join("repo");
    for (index, message) in ["One", "Two", "Three"].into_iter().enumerate() {
        fs::write(repo.join("data.txt"), format!("{index}\n")).unwrap();
        git(&repo, &["add", "data.txt"]);
        commit(&repo, message);
    }
    // Only the pairs (a bookmark, say), at their commits; one that names no commit here is left out.
    let sweep = finished_sweep(
        &fixture,
        json!({"projections": ["example"], "last": 0, "pairs": [
            {"before": "HEAD~2", "after": "HEAD", "title": "Two steps"},
            {"before": "no-such-ref", "after": "HEAD"},
        ]}),
    )
    .await;
    assert_eq!(sweep["status"], "completed", "{sweep}");
    let changes = sweep["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 1, "{changes:?}");
    assert_eq!(changes[0]["kind"], "pair");
    assert_eq!(changes[0]["title"], "Two steps");
    assert_eq!(changes[0]["after"].as_str().unwrap().len(), 40);
    assert_eq!(sweep["cells"].as_array().unwrap().len(), 1);
    // Cancel answers with the sweep as it stands.
    let cancelled = fixture
        .request(
            "POST",
            "/api/sweep",
            fixture.auth(),
            &serde_json::to_vec(&json!({"cancel": true})).unwrap(),
        )
        .await;
    assert_eq!(cancelled.status, 202);
    assert_eq!(cancelled.json()["sweep"]["id"], sweep["id"]);
    for body in [json!({"pairs": [{"before": "HEAD"}]}), json!({"last": 0}), json!({"pairs": "HEAD"})] {
        let refused = fixture
            .request("POST", "/api/sweep", fixture.auth(), &serde_json::to_vec(&body).unwrap())
            .await;
        assert_eq!(refused.status, 400, "{body}");
    }
}

#[tokio::test]
async fn sweeps_skip_projections_that_need_trust() {
    let fixture = Fixture::new(false, false, false).await;
    commit(&fixture.root.join("repo"), "Second");
    let sweep = finished_sweep(&fixture, json!({"projections": ["example"]})).await;
    assert_eq!(sweep["status"], "completed", "{sweep}");
    assert_eq!(sweep["projections"][0]["status"], "trust");
    assert_eq!(sweep["cells"], json!([]));
}
