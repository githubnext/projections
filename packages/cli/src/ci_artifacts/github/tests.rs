use super::{candidate, signed_workflow};
use serde_json::json;

fn run(event: &str, head: &str, path: &str) -> serde_json::Value {
    json!({"id": 7, "event": event, "path": path,
        "repository": {"full_name": "acme/demo"}, "head_repository": {"full_name": head}})
}

#[test]
fn only_the_repository_own_push_and_pull_request_runs_are_candidates() {
    assert_eq!(
        candidate(&run("push", "acme/demo", ".github/workflows/ci.yml"), "acme/demo").as_deref(),
        Some(".github/workflows/ci.yml")
    );
    assert_eq!(
        candidate(
            &run("pull_request", "Acme/Demo", ".github/workflows/ci.yml@refs/heads/main"),
            "acme/demo"
        )
        .as_deref(),
        Some(".github/workflows/ci.yml")
    );
    // A fork's pull request runs the fork's own workflow files.
    assert_eq!(
        candidate(&run("pull_request", "mallory/demo", ".github/workflows/ci.yml"), "acme/demo"),
        None
    );
    assert_eq!(
        candidate(&json!({"event": "push", "path": ".github/workflows/ci.yml"}), "acme/demo"),
        None
    );
    for event in ["pull_request_target", "workflow_run", "workflow_dispatch", "schedule"] {
        assert_eq!(
            candidate(&run(event, "acme/demo", ".github/workflows/ci.yml"), "acme/demo"),
            None,
            "{event}"
        );
    }
    // Dynamic runs (such as Dependabot's or CodeQL's) have no workflow file.
    assert_eq!(
        candidate(&run("push", "acme/demo", "dynamic/dependabot/dependabot-updates"), "acme/demo"),
        None
    );
}

#[test]
fn an_attestation_names_the_workflow_of_its_run() {
    let certificate = json!({
        "sourceRepositoryURI": "https://github.com/Acme/Demo",
        "githubWorkflowTrigger": "push",
        "runInvocationURI": "https://github.com/acme/demo/actions/runs/4242/attempts/2",
        "buildConfigURI": "https://github.com/acme/demo/.github/workflows/ci.yml@refs/heads/main",
    });
    let prefix = "https://github.com/acme/demo";
    assert_eq!(
        signed_workflow(&certificate, prefix, 4242).as_deref(),
        Some(".github/workflows/ci.yml")
    );
    assert_eq!(signed_workflow(&certificate, prefix, 4243), None);
    let mut other = certificate.clone();
    other["sourceRepositoryURI"] = json!("https://github.com/mallory/demo");
    assert_eq!(signed_workflow(&other, prefix, 4242), None);
    let mut target = certificate.clone();
    target["githubWorkflowTrigger"] = json!("pull_request_target");
    assert_eq!(signed_workflow(&target, prefix, 4242), None);
    let mut elsewhere = certificate;
    elsewhere["runInvocationURI"] = json!("https://github.com/acme/demo-fork/actions/runs/4242/attempts/1");
    assert_eq!(signed_workflow(&elsewhere, prefix, 4242), None);
}
