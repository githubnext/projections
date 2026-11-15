//! Bases and the generation store's snapshot. The digests are the ones the
//! JavaScript helpers' tests expect (packages/sdk/test/extractor.test.ts), so both
//! implementations hash a basis the same way.

use projections_extractor_sdk::{Basis, Context, Generations, basis_digest};
use serde_json::json;

const CART_DIGEST: &str = "sha256:02c585f6060308c569e5b1258bb4fa5198e1dc491f9424f3687c5d58b2a8d8d9";

fn cart() -> Basis {
    Basis::new()
        .hash("input", "class Cart {}")
        .unwrap()
        .hash("prompt", "Summarize.")
        .unwrap()
        .keep("model", "fake-summarizer@1")
        .unwrap()
}

#[test]
fn a_basis_hashes_its_parts_like_the_javascript_helpers() {
    assert_eq!(
        cart().to_value(),
        json!({
            "input": "sha256:b6a57a5700a3228e12314dc29a611932d30a15d9a470859b7fa27d071bb07c8d",
            "prompt": "sha256:af639d92c6b7997ae8f55fee998ce444d8077f9bface7147a210656046b058ab",
            "model": "fake-summarizer@1",
        })
    );
    assert_eq!(cart().digest(), CART_DIGEST);
    assert_eq!(basis_digest(&cart().to_value()), CART_DIGEST);
    let context = Basis::new().hash_json("context", &json!({"files": ["a", "b"]})).unwrap();
    assert_eq!(
        context.to_value()["context"],
        "sha256:91ebe95a33b44a953051c279ae1082f32291926c51001f2d3d8db846ef56ba97"
    );
}

#[test]
fn a_basis_checks_its_limits() {
    assert!(Basis::new().hash("9lives", "x").is_err());
    assert!(Basis::new().keep("model", "").is_err());
    assert!(Basis::new().keep("model", &"x".repeat(257)).is_err());
    let full = (0..16).fold(Basis::new(), |basis, n| basis.keep(&format!("p{n}"), "x").unwrap());
    assert!(full.clone().keep("p17", "x").is_err());
    assert!(full.keep("p3", "y").is_ok());
}

#[test]
fn the_snapshot_reuses_values_by_declared_path_and_basis() {
    let snapshot = [
        json!({"path": "/data/summary", "basis": CART_DIGEST, "value": "Holds a cart."}).to_string(),
        "not json".to_owned(),
        json!({"path": "/data/title", "basis": CART_DIGEST, "value": {"short": "Cart"}}).to_string(),
    ]
    .join("\n");
    let store = Generations::parse(&snapshot);
    assert_eq!(store.len(), 2);
    assert_eq!(store.get("/data/summary", &cart()), Some(&json!("Holds a cart.")));
    assert_eq!(store.get("/data/other", &cart()), None);
    let mut calls = 0;
    let mut produce = || {
        calls += 1;
        Ok(json!("Fresh."))
    };
    assert_eq!(
        store.generate("/data/summary", &cart(), &mut produce).unwrap(),
        json!("Holds a cart.")
    );
    let bag = Basis::new().hash("input", "class Bag {}").unwrap();
    assert_eq!(store.generate("/data/summary", &bag, &mut produce).unwrap(), json!("Fresh."));
    assert_eq!(calls, 1);
}

#[test]
fn the_context_reads_the_snapshot_the_request_names() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("generations.jsonl");
    std::fs::write(
        &file,
        json!({"path": "/data/summary", "basis": CART_DIGEST, "value": "Holds a cart."}).to_string(),
    )
    .unwrap();
    let request = |generations: serde_json::Value| {
        json!({
            "protocolVersion": 0,
            "projection": {"id": "p", "definition": {}},
            "repository": {"mode": "materialized", "root": directory.path()},
            "capabilities": {"trusted": true, "network": false},
            "generations": generations,
        })
    };
    let context = Context::new("x", request(json!({"file": file}))).unwrap();
    assert_eq!(context.generations().len(), 1);
    let context = Context::new("x", request(json!(null))).unwrap();
    assert!(context.generations().is_empty());
}
