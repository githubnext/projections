//! Collection jobs: their outputs, limits, cancellation and shutdown.

use std::{fs, time::Duration};

use serde_json::json;
use tokio::time::{sleep, timeout};

use crate::common::{Fixture, alive};

#[tokio::test]
async fn native_collection_comparison_outputs_and_four_retained_jobs() {
    let fixture = Fixture::new(true, false, false).await;
    let first = fixture.job(json!({"projectionId":"example","before":"HEAD"})).await;
    let first_id = first["id"].as_str().unwrap().to_owned();
    let result = fixture.finished(&first_id).await;
    assert_eq!(result["status"], "completed", "{result}");
    assert_eq!(result["extraction"]["format"], "projections.extraction");
    assert_eq!(result["outputs"].as_array().unwrap().len(), 1);
    assert!(result["outputs"][0]["stdout"].as_str().unwrap().contains("Native fixture"));
    assert_eq!(result["outputs"][0]["stderr"], "fixture diagnostic");
    let comparison = fixture
        .job(json!({
            "projectionId":"example","before":"HEAD","after":"working-tree"
        }))
        .await;
    let result = fixture.finished(comparison["id"].as_str().unwrap()).await;
    assert_eq!(result["status"], "completed", "{result}");
    assert_eq!(result["comparison"]["format"], "projections.comparison");
    assert_eq!(result["outputs"].as_array().unwrap().len(), 2);
    for _ in 0..3 {
        let created = fixture.job(json!({"projectionId":"example","before":"HEAD"})).await;
        assert_eq!(fixture.finished(created["id"].as_str().unwrap()).await["status"], "completed");
    }
    let expired = fixture.request("GET", &format!("/api/jobs/{first_id}"), fixture.auth(), b"").await;
    assert_eq!(expired.status, 404);
    fixture.close().await;
}

#[tokio::test]
async fn concurrent_posts_are_bounded_and_cancel_waits_for_process_cleanup() {
    let fixture = Fixture::new(true, false, true).await;
    let body = br#"{"projectionId":"example","before":"HEAD"}"#;
    let (first, second) = tokio::join!(
        fixture.request("POST", "/api/jobs", fixture.auth(), body),
        fixture.request("POST", "/api/jobs", fixture.auth(), body)
    );
    // Both are accepted: the second waits for the first, as jobs from every client queue.
    assert_eq!([first.status, second.status], [202, 202]);
    let (created, queued) = (first.json(), second.json());
    let pid = collector_pid(&fixture).await;
    let cancelled = fixture
        .request(
            "POST",
            &format!("/api/jobs/{}/cancel", created["id"].as_str().unwrap()),
            fixture.auth(),
            b"{}",
        )
        .await;
    assert_eq!(cancelled.status, 200, "{}", cancelled.text());
    assert_eq!(cancelled.json()["status"], "cancelled");
    assert!(!alive(pid), "collector {pid} survived cancellation");
    // The waiting job runs next; cancelling it stops it too.
    let second = fixture
        .request(
            "POST",
            &format!("/api/jobs/{}/cancel", queued["id"].as_str().unwrap()),
            fixture.auth(),
            b"{}",
        )
        .await;
    assert_eq!(second.json()["status"], "cancelled");
    fixture.close().await;
}

#[tokio::test]
async fn shutdown_cancels_native_process_before_returning() {
    let fixture = Fixture::new(true, false, true).await;
    fixture.job(json!({"projectionId":"example","before":"HEAD"})).await;
    let pid = collector_pid(&fixture).await;
    fixture.close().await;
    assert!(!alive(pid), "collector {pid} survived shutdown");
}

/// The slow collector's process ID, once it has started and written it.
async fn collector_pid(fixture: &Fixture) -> i32 {
    let path = fixture.root.join("collector.pid");
    timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(text) = fs::read_to_string(&path) {
                return text.parse().unwrap_or_else(|error| panic!("collector.pid holds {text:?}: {error}"));
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the collector wrote its pid within 10 s")
}
