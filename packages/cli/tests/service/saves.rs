//! Saves in progress: a save written in chunks, or half-written, is one change
//! and is read whole. Their extractors are `/bin/sh` scripts, so not on Windows.

use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::time::sleep;

use crate::common::Fixture;

/// Long-polls `/api/changes` after `since` until a generation reports `kind`;
/// returns that generation and every kind reported on the way.
async fn change_reported(fixture: &Fixture, since: u64, kind: &str) -> (u64, Vec<String>) {
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    let mut since = since;
    let mut kinds = Vec::new();
    loop {
        assert!(std::time::Instant::now() < deadline, "{kind} was not reported: {kinds:?}");
        let changed = fixture
            .request("GET", &format!("/api/changes?since={since}"), fixture.auth(), b"")
            .await
            .json();
        since = changed["generation"].as_u64().unwrap();
        let reported: Vec<String> = changed["changes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|kind| kind.as_str().unwrap().to_owned())
            .collect();
        let found = reported.iter().any(|reported| reported == kind);
        kinds.extend(reported);
        if found {
            return (since, kinds);
        }
    }
}

/// An editor's non-atomic save: truncate, then the content in `chunks` writes
/// with `pause` between them. Returns the longest time between two writes (a
/// loaded runner can oversleep a pause).
/// The writes run on their own thread, as an editor's would: on the test's
/// single-threaded runtime, the service under test could otherwise hold them up.
/// They aren't synced: readers see them at once, and on a loaded runner an fsync
/// can stall past the quiet period, which really is a quiet file.
async fn save_in_chunks(path: &Path, content: &[u8], chunks: usize, pause: Duration) -> Duration {
    let (path, content) = (path.to_path_buf(), content.to_vec());
    tokio::task::spawn_blocking(move || {
        use std::io::Write;
        let mut file = fs::File::create(&path).unwrap();
        let mut last = std::time::Instant::now();
        let mut longest = Duration::ZERO;
        for chunk in content.chunks(content.len().div_ceil(chunks)) {
            std::thread::sleep(pause);
            file.write_all(chunk).unwrap();
            longest = longest.max(last.elapsed());
            last = std::time::Instant::now();
        }
        longest
    })
    .await
    .unwrap()
}

/// The working tree's definition for `example`, running `collector-v2.sh`,
/// whose extraction is labelled "Full content".
async fn prepare_full_content(fixture: &Fixture) -> (PathBuf, Vec<u8>, u64) {
    let repo = fixture.root.join("repo");
    let state =
        r#"{"protocolVersion":0,"schema":"graph/v0","entities":[{"id":"a","kind":"item","label":"Full content"}],"relationships":[]}"#;
    fs::write(repo.join("collector-v2.sh"), format!("cat >/dev/null\nprintf '%s\\n' '{state}'\n")).unwrap();
    // The new script is reported first, so the save below is a change of its own.
    let (start, _) = change_reported(fixture, 1, "working-tree").await;
    let definition = serde_json::to_vec_pretty(&json!({
        "id": "example", "title": "Saved in chunks", "renderer": "graph",
        "extractor": {"command": ["/bin/sh", "collector-v2.sh"]},
        "execution": {"timeoutMs": 300000},
    }))
    .unwrap();
    (repo.join(".projections/example.json"), definition, start)
}

fn labels(job: &Value) -> String {
    job["extraction"].to_string()
}

#[tokio::test]
async fn a_save_in_chunks_is_one_change_and_read_whole() {
    let fixture = Fixture::new(true, false, false).await;
    let (path, definition, start) = prepare_full_content(&fixture).await;
    // Chunks closer together than the quiet period are one change, however long
    // the save takes: spread over several polls, the watcher never reports the
    // empty or half-written definition.
    let longest = save_in_chunks(&path, &definition, 20, Duration::from_millis(40)).await;
    // Past the next poll and its quiet period, every generation for the save exists.
    sleep(Duration::from_millis(1500)).await;
    let (generation, kinds) = change_reported(&fixture, start, "definitions").await;
    // A loaded runner can oversleep a 40 ms pause past the quiet period; then that pause
    // really was quiet, and the save may be reported in more than one change.
    if longest + Duration::from_millis(20) < projections_cli::workspace::QUIET {
        assert_eq!(generation, start + 1, "one generation for the save: {kinds:?}");
    }
    let definitions = fixture.get("/api/definitions?ref=working-tree").await;
    assert_eq!(definitions.status, 200, "{}", definitions.text());
    assert!(definitions.text().contains("Saved in chunks"));

    // A run started mid-save waits for the files to settle and reads them whole.
    let saving = std::time::Instant::now();
    let writer = {
        let (path, definition) = (path.clone(), definition.clone());
        tokio::spawn(async move { save_in_chunks(&path, &definition, 20, Duration::from_millis(40)).await })
    };
    sleep(Duration::from_millis(100)).await;
    let started = fixture
        .job(json!({"projectionId": "example", "before": "working-tree", "definitionRevision": "working-tree"}))
        .await;
    let longest = writer.await.unwrap();
    let saved = saving.elapsed();
    let job = fixture.finished(started["id"].as_str().unwrap()).await;
    // As above, a loaded runner can stall a chunk (its fsync, or the pause) past the
    // quiet period; then the files really were quiet, and the run may read them half
    // written. A save slower than the settle limit is read as it is. Only a save
    // that never paused that long, and finished within the limit, must be read whole.
    if longest + Duration::from_millis(20) < projections_cli::workspace::QUIET && saved < projections_cli::workspace::SETTLE_LIMIT {
        assert_eq!(job["status"], "completed", "{job:#}");
        assert!(labels(&job).contains("Full content"), "{job:#}");
    } else if job["status"] != "completed" {
        assert!(job.to_string().contains("invalid-json"), "{job:#}");
    }
    fixture.close().await;
}

#[tokio::test]
async fn a_half_written_definition_is_transient_and_the_last_replay_reads_it_whole() {
    let fixture = Fixture::new(true, false, false).await;
    let (path, definition, start) = prepare_full_content(&fixture).await;
    // A writer that pauses longer than the quiet period: the half-written
    // definition may be reported and fail to parse, but the watcher carries on,
    // and the replay after the last change uses the full content.
    let writer = {
        let (path, definition) = (path.clone(), definition.clone());
        tokio::spawn(async move { save_in_chunks(&path, &definition, 2, Duration::from_millis(700)).await })
    };
    // As the Inspector does: replay the working tree on every reported change
    // until the definition is whole.
    let mut since = start;
    let mut replays = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    loop {
        assert!(std::time::Instant::now() < deadline, "no complete replay: {replays:#?}");
        let (generation, _) = change_reported(&fixture, since, "definitions").await;
        since = generation;
        let started = fixture
            .job(json!({"projectionId": "example", "before": "working-tree", "definitionRevision": "working-tree"}))
            .await;
        let job = fixture.finished(started["id"].as_str().unwrap()).await;
        let whole = job["status"] == "completed" && labels(&job).contains("Full content");
        replays.push(job);
        if whole {
            break;
        }
        assert_eq!(replays.last().unwrap()["status"], "failed", "{replays:#?}");
    }
    writer.await.unwrap();
    assert_eq!(fs::read(&path).unwrap(), definition);
    fixture.close().await;
}
