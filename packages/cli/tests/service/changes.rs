//! Working-tree changes: what changed, and reading a save whole.

use std::fs;

use projections_cli::scaffold;

use crate::common::Fixture;

#[tokio::test]
async fn working_tree_changes_name_the_projection_parts_that_changed() {
    let fixture = Fixture::new(false, false, false).await;
    let repo = fixture.root.join("repo");
    let script = repo.join(if cfg!(windows) { "collector.ps1" } else { "collector.sh" });
    // Generations start at 1, so this answers at once with the current one.
    let first = fixture.request("GET", "/api/changes?since=0", fixture.auth(), b"").await;
    assert_eq!(first.status, 200);
    let start = first.json()["generation"].as_u64().unwrap();
    // The watcher's first state was taken when the server started, so the edit
    // is a change whenever the next poll runs. Long-poll until every expected
    // kind is reported: a slow machine may split the edit over generations.
    let mut source = fs::read_to_string(&script).unwrap();
    source.push_str("\n# edited\n");
    fs::write(&script, source).unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    let mut since = start;
    let mut changes = std::collections::BTreeSet::new();
    while !(changes.contains("extractor:example") && changes.contains("working-tree")) {
        assert!(std::time::Instant::now() < deadline, "the edit was not reported: {changes:?}");
        let changed = fixture
            .request("GET", &format!("/api/changes?since={since}"), fixture.auth(), b"")
            .await
            .json();
        assert_eq!(changed["complete"], true);
        let generation = changed["generation"].as_u64().unwrap();
        assert!(generation >= since);
        since = generation;
        for kind in changed["changes"].as_array().unwrap() {
            changes.insert(kind.as_str().unwrap().to_owned());
        }
        if since > start {
            // A changed generation carries the working tree's new identity.
            assert_eq!(
                changed["tree"],
                fixture.get("/api/identity?projection=example").await.json()["tree"]
            );
        }
    }
    assert!(since > start);
    assert_eq!(fixture.request("GET", "/api/changes", fixture.auth(), b"").await.status, 400);

    // A working tree without projections of its own says how to make one.
    let definitions = fixture
        .request("GET", "/api/definitions?ref=working-tree", fixture.auth(), b"")
        .await
        .json();
    assert!(definitions.get("setup").is_none());
    fs::remove_file(repo.join(".projections/example.json")).unwrap();
    let definitions = fixture
        .request("GET", "/api/definitions?ref=working-tree", fixture.auth(), b"")
        .await
        .json();
    assert_eq!(definitions["setup"]["command"], "projections init <id>");
    assert_eq!(definitions["setup"]["prompt"], scaffold::agent_prompt(None).as_str());

    let offline = Fixture::new(false, true, false).await;
    assert_eq!(
        offline.request("GET", "/api/changes?since=0", offline.auth(), b"").await.status,
        404
    );
}
