//! Terraform plans as an infrastructure graph.

use std::fs;

use serde_json::json;

use crate::common::{
    Scratch, collect, compare, copy, count, ecosystem, fixtures, items, modified_entities, selected, status_count, succeed, tool,
    tool_command,
};

/// The extractor runs `terraform plan` (never `init` or `apply`) and reads it with
/// `terraform show -json`. The test applies the first configuration itself (built-in
/// `terraform_data` only, so no infrastructure exists) to give the second plan a state.
/// `PROJECTIONS_TERRAFORM` may name OpenTofu.
#[test]
fn native_terraform_plans_each_revision_into_an_infrastructure_graph() {
    if !selected(&["PROJECTIONS_NATIVE_ECOSYSTEMS"]) {
        eprintln!(
            "Skipping the native Terraform test: set PROJECTIONS_NATIVE_ECOSYSTEMS=1 (and PROJECTIONS_TERRAFORM for a Terraform or OpenTofu not on PATH)"
        );
        return;
    }
    let scratch = Scratch::new();
    let root = &scratch.0;
    let configurations = fixtures("terraform-infrastructure").join("terraform");
    copy(&configurations.join("before"), root, &[]);
    let terraform = tool("PROJECTIONS_TERRAFORM", "terraform");
    for arguments in [
        &["init", "-input=false", "-no-color"][..],
        &["apply", "-auto-approve", "-input=false", "-no-color"],
    ] {
        succeed(tool_command(&terraform, root, &[]).args(arguments));
    }
    let definition = ecosystem("terraform-infrastructure", json!({"terraformPath":terraform}));
    let error = collect(root, &definition, false).unwrap_err();
    assert!(format!("{error:#}").contains("--trust"));
    let before = collect(root, &definition, true).unwrap();
    assert!(
        items(&before, "entities")
            .iter()
            .all(|entity| entity["data"].get("action").is_none())
    );
    assert_eq!(count(&before, "entities", "module"), 1);
    fs::copy(configurations.join("after/main.tf"), root.join("main.tf")).unwrap();
    let after = collect(root, &definition, true).unwrap();
    for state in [&before, &after] {
        assert!(!state.to_string().contains("native-secret-never-persist"));
    }
    assert!(after.to_string().contains("(known after apply)"));
    assert_eq!(after["metadata"]["destroyed"], json!(["terraform_data.old"]));
    let database = items(&after, "entities")
        .iter()
        .find(|entity| entity["id"] == "terraform_data.db")
        .unwrap();
    assert_eq!(database["data"]["action"], "replace");
    let comparison = compare(&before, &after);
    // The cache, its reference to the database and its explicit dependencies on both module resources.
    assert_eq!(status_count(&comparison, "added"), 4);
    assert!(
        modified_entities(&comparison, &after)
            .iter()
            .any(|entity| entity["id"] == "terraform_data.db")
    );
    // A saved plan is read with `terraform show -json` alone.
    succeed(tool_command(&terraform, root, &[]).args(["plan", "-input=false", "-no-color", "-out=saved.tfplan"]));
    let saved = collect(
        root,
        &ecosystem(
            "terraform-infrastructure",
            json!({"terraformPath":terraform,"planPath":"saved.tfplan"}),
        ),
        true,
    )
    .unwrap();
    assert_eq!(saved["entities"], after["entities"]);
    assert!(
        fs::read_dir(root)
            .unwrap()
            .all(|entry| { !entry.unwrap().file_name().to_string_lossy().starts_with(".projections-") })
    );
}
