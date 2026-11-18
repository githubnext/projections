//! The lock check against a real gh-aw checkout: every workflow gh-aw's own
//! repository compiled must read as current. It needs a checkout, so it runs
//! only when `GH_AW_CHECKOUT` names one (at the release `vendor/gh-aw/vendor.json` pins):
//!
//! ```sh
//! git clone --depth 1 --branch v1.3.0 https://github.com/github/gh-aw /tmp/gh-aw
//! GH_AW_CHECKOUT=/tmp/gh-aw cargo test -p projections-extractor-github-agentic-workflows --test corpus -- --ignored --nocapture
//! ```

use projections_extractor_github_agentic_workflows::collect;
use projections_extractor_sdk::testing;
use serde_json::json;
use std::path::Path;

#[test]
#[ignore = "needs a gh-aw checkout in GH_AW_CHECKOUT"]
fn every_compiled_workflow_of_a_gh_aw_checkout_is_current() {
    let root = std::env::var("GH_AW_CHECKOUT").expect("GH_AW_CHECKOUT names a gh-aw checkout");
    let root = Path::new(&root).canonicalize().unwrap();
    let definition = json!({"id": "agentic-workflows", "extractor": "github-agentic-workflows", "inputs": {}});
    let extraction = collect(&testing::context(&root, definition)).unwrap();
    let mut counts = std::collections::BTreeMap::<String, usize>::new();
    let mut failures = Vec::new();
    for entity in extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entity| entity["kind"] == "workflow")
    {
        let lock = &entity["data"]["lock"];
        let status = lock["status"].as_str().unwrap_or("invalid").to_owned();
        if status != "current" && status != "missing" {
            failures.push(format!("{} {status} {}", entity["label"], lock["reason"]));
        }
        *counts.entry(status).or_default() += 1;
        // gh-aw compiled every workflow at the pinned tag, so none of it, or of what it imports, is unknown.
        for field in entity["data"]["unrecognized"].as_array().unwrap() {
            failures.push(format!("{} uses unknown {field}", entity["label"]));
        }
    }
    println!("{counts:?}");
    assert!(
        failures.is_empty(),
        "{} workflows aren't current or use unknown fields:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
