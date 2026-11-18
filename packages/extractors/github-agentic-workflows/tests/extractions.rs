//! Golden extractions of the fixtures (see `scripts/fixtures.mjs`) and the
//! facts a reviewer relies on. Regenerate goldens with
//! `PROJECTIONS_UPDATE_GOLDEN=1 cargo test -p projections-extractor-github-agentic-workflows`.

use projections_extractor_github_agentic_workflows::collect;
use projections_extractor_sdk::testing::{self, golden};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn extract(root: &Path, inputs: Value) -> anyhow::Result<Value> {
    let root = root.canonicalize().unwrap();
    let definition = json!({"id": "agentic-workflows", "extractor": "github-agentic-workflows", "inputs": inputs});
    collect(&testing::context(&root, definition))
}

/// The Engine accepts the extraction: identities, endpoints, vocabulary and domain rules.
fn normalize(extraction: &Value) -> Value {
    let request = json!({"version": 0, "operation": "normalize", "extraction": extraction});
    let response = projections_engine::handle(request.to_string().as_bytes());
    assert_eq!(response["ok"], true, "{response}");
    response["result"].clone()
}

/// The case's extraction of `side` (or of `repo` when it has one revision), checked against its golden.
fn case(name: &str, side: &str) -> Value {
    let directory = fixtures().join(name);
    let inputs: Value = serde_json::from_str(&fs::read_to_string(directory.join("inputs.json")).unwrap()).unwrap();
    let (root, file) = if side.is_empty() {
        (directory.clone(), "expected.json".to_owned())
    } else {
        (directory.join(side), format!("{side}.expected.json"))
    };
    let extraction = extract(&root, inputs).unwrap();
    golden(&directory.join(file), &extraction);
    normalize(&extraction);
    extraction
}

fn workflow<'a>(extraction: &'a Value, label: &str) -> &'a Value {
    extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entity| entity["kind"] == "workflow" && entity["label"] == label)
        .unwrap_or_else(|| panic!("no workflow {label}"))
}

#[test]
fn public_workflows_read_with_their_imports_and_current_locks() {
    let extraction = case("public", "");
    let firewall = &workflow(&extraction, "firewall")["data"];
    assert_eq!(firewall["lock"]["status"], "current");
    assert_eq!(
        firewall["network"]["allowed"],
        json!(["*.grafana.net", "*.sentry.io", "defaults", "node"])
    );
    assert_eq!(firewall["sources"]["network:*.sentry.io"], json!(["shared/otlp.md"]));
    assert_eq!(firewall["bash"], json!(["curl*"]));
    assert!(
        firewall["secrets"]
            .as_array()
            .unwrap()
            .contains(&json!("GH_AW_OTEL_SENTRY_ENDPOINT"))
    );
    let diagram = &workflow(&extraction, "daily-documentation-diagram")["data"];
    assert_eq!(diagram["lock"]["status"], "current");
    assert_eq!(diagram["engine"]["id"], "codex");
    assert_eq!(diagram["unrecognized"], json!([]));
    let checker = &workflow(&extraction, "link-checker")["data"];
    // Compiled by an earlier gh-aw release, and still current.
    assert_eq!(
        checker["lock"],
        json!({"path": ".github/workflows/link-checker.lock.yml", "status": "current", "compiler": "v0.93.3"})
    );
    // Shared components aren't workflows of their own.
    assert_eq!(extraction["metadata"]["workflows"], 3);
}

#[test]
fn repo_ask_pull_request_widens_network_and_outputs() {
    let before = case("repo-ask", "before");
    let after = case("repo-ask", "after");
    let (before, after) = (&workflow(&before, "repo-ask")["data"], &workflow(&after, "repo-ask")["data"]);
    assert_eq!(before["network"]["allowed"], json!(["defaults"]));
    assert_eq!(after["network"]["allowed"], json!(["*.readthedocs.io", "defaults", "python"]));
    assert_eq!(after["github"]["toolsets"], json!(["actions", "default", "discussions"]));
    assert_eq!(after["triggers"], json!([{"event": "slash_command", "detail": "repo-ask"}]));
    assert_eq!(after["lock"]["status"], "current");
    assert_eq!(after["lock"]["compiler"], "v1.3.0");
}

#[test]
fn docs_bot_groups_workflows_classifies_gates_and_flags_a_stale_lock() {
    let before = case("docs-bot", "before");
    let after = case("docs-bot", "after");
    let group = after["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entity| entity["id"] == "group:docs-bot")
        .unwrap();
    assert_eq!(
        group["data"]["workflows"],
        json!(["docs-bot", "docs-bot-digest", "docs-bot-examples", "docs-bot-links"])
    );
    let bot = &workflow(&before, "docs-bot")["data"];
    assert_eq!(bot["group"], "docs-bot");
    assert_eq!(bot["skills"][1]["classes"], json!(["guardrail"]));
    assert_eq!(bot["limits"]["maxAiCredits"], json!({"value": 2000, "declared": true}));
    assert_eq!(bot["github"]["repos"], json!(["${{ github.repository }}"]));
    let dispatches: Vec<&Value> = after["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|edge| edge["kind"] == "dispatches")
        .collect();
    assert_eq!(dispatches.len(), 3);
    let triage = &workflow(&after, "issue-triage")["data"];
    assert_eq!(triage["lock"]["status"], "stale");
    assert_eq!(triage["findings"][0]["kind"], "lock-stale");
    assert_eq!(workflow(&before, "issue-triage")["data"]["lock"]["status"], "current");
    assert!(workflow(&after, "issue-triage")["data"].get("group").is_none());
}

#[test]
fn unknown_and_renamed_fields_are_reported_and_extraction_is_deterministic() {
    let root = tempfile::tempdir().unwrap();
    let workflows = root.path().join(".github/workflows");
    fs::create_dir_all(&workflows).unwrap();
    fs::write(
        workflows.join("future.md"),
        "---\non:\n  command:\n    name: ask\ntimeout_minutes: 9\nhologram: {limit: 1}\nimports: [shared/extra.md]\ntools:\n  github:\n    toolset: [issues]\n    telepathy: true\n---\nHi\n",
    )
    .unwrap();
    fs::create_dir_all(workflows.join("shared")).unwrap();
    fs::write(
        workflows.join("shared/extra.md"),
        "---\ntools:\n  github:\n    repos: [octo/a]\n    telepathy: 2\n---\n",
    )
    .unwrap();
    fs::write(workflows.join("broken.md"), "---\non: [push\n---\n").unwrap();
    fs::write(workflows.join("README.md"), "---\non: push\n---\n").unwrap();
    std::process::Command::new("git")
        .args(["init", "-q"])
        .current_dir(root.path())
        .status()
        .unwrap();
    let first = extract(root.path(), json!({})).unwrap();
    assert_eq!(first, extract(root.path(), json!({})).unwrap());
    normalize(&first);
    let future = &workflow(&first, "future")["data"];
    assert_eq!(
        future["unrecognized"],
        json!(["hologram", "tools.github.telepathy", "shared/extra.md: tools.github.telepathy"])
    );
    assert_eq!(
        future["unrecognizedValues"][2],
        json!({"field": "tools.github.telepathy", "value": 2, "via": "shared/extra.md"})
    );
    assert_eq!(future["deprecated"][3]["via"], "shared/extra.md");
    assert_eq!(future["triggers"], json!([{"event": "slash_command", "detail": "ask"}]));
    assert_eq!(future["limits"]["timeoutMinutes"], json!({"value": 9, "declared": true}));
    assert_eq!(future["github"]["toolsets"], json!(["default", "issues"]));
    let kinds: Vec<&str> = future["findings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|finding| finding["kind"].as_str().unwrap())
        .collect();
    assert_eq!(
        kinds,
        [
            "lock-missing",
            "unrecognized",
            "deprecated",
            "deprecated",
            "deprecated",
            "unrecognized",
            "deprecated"
        ]
    );
    let imported = future["findings"][5]["message"].as_str().unwrap();
    assert!(imported.contains("`tools.github.telepathy` in `shared/extra.md`"), "{imported}");
    assert_eq!(workflow(&first, "broken")["data"]["findings"][0]["kind"], "invalid");
    assert_eq!(first["metadata"]["workflows"], 2);
    // A change to an unknown field's value alone still changes the workflow.
    let source = fs::read_to_string(workflows.join("future.md")).unwrap();
    fs::write(workflows.join("future.md"), source.replace("limit: 1", "limit: 2")).unwrap();
    let second = extract(root.path(), json!({})).unwrap();
    let changed = &workflow(&second, "future")["data"];
    assert_eq!(changed["unrecognized"], future["unrecognized"]);
    assert_eq!(
        changed["unrecognizedValues"][0],
        json!({"field": "hologram", "value": {"limit": 2}})
    );
}
