//! The infrastructure graph against real Terraform and OpenTofu output and a
//! realistic AWS change.
//!
//! `opentofu-*.json` and `terraform-1.14-plan.json` are unedited `show -json`
//! output of the configurations in `terraform/`. `aws/*.plan.json` follow the
//! same format for a production-like change: the database is replaced to
//! encrypt its storage, its dependents update, a secret arrives, the bastion
//! is destroyed and a DNS record is moved. Their extractions are goldens
//! (`PROJECTIONS_UPDATE_GOLDEN=1` rewrites them) and are the graph
//! renderer's Terraform scenario.

use projections_extractor_sdk::testing::{Process, golden};
use projections_extractor_terraform_infrastructure::collect;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn extract(file: &str) -> Value {
    let root = fixtures();
    let definition = json!({"id":"infrastructure","extractor":"terraform-infrastructure","inputs":{"planJsonPath":file}});
    let extraction = collect(&Process::new(&root).context(&root, Value::clone(&definition)).with_files(vec![])).unwrap();
    projections_engine::normalize(&extraction, "").unwrap();
    extraction
}

fn entity<'a>(extraction: &'a Value, id: &str) -> &'a Value {
    extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id)
        .unwrap_or_else(|| panic!("no entity {id}"))
}

fn references(extraction: &Value) -> BTreeSet<(String, String)> {
    extraction["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["kind"] == "references")
        .map(|r| (r["from"].as_str().unwrap().to_owned(), r["to"].as_str().unwrap().to_owned()))
        .collect()
}

/// Everything that transitively references `id`.
fn dependents(extraction: &Value, id: &str) -> BTreeSet<String> {
    let edges = references(extraction);
    let mut found = BTreeSet::new();
    let mut next = vec![id.to_owned()];
    while let Some(target) = next.pop() {
        for (from, to) in &edges {
            if *to == target && found.insert(from.clone()) {
                next.push(from.clone());
            }
        }
    }
    found
}

fn change<'a>(comparison: &'a Value, id: &str) -> &'a Value {
    comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["collection"] == "entities"
                && (c["after"].as_array().unwrap().iter().any(|a| a == id) || c["before"].as_array().unwrap().iter().any(|b| b == id))
        })
        .unwrap_or_else(|| panic!("no change for {id}"))
}

#[test]
fn aws_database_replacement_is_a_modification_with_its_dependents() {
    let base = extract("aws/base.plan.json");
    let head = extract("aws/head.plan.json");
    golden(&fixtures().join("aws/base.expected.json"), &base);
    golden(&fixtures().join("aws/head.expected.json"), &head);
    // The graph renderer's Terraform scenario is this extraction pair.
    let scenario = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../renderers/graph/fixtures");
    golden(&scenario.join("terraform-before.json"), &base);
    golden(&scenario.join("terraform-after.json"), &head);
    for extraction in [&base, &head] {
        let text = extraction.to_string();
        assert!(!text.contains("fixture-db-password-never-persist"));
        assert!(text.contains("(sensitive value)"));
    }
    // The base revision is applied: nothing has an action.
    assert!(
        base["entities"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["data"].get("action").is_none())
    );
    let database = entity(&head, "module.database.aws_db_instance.main");
    assert_eq!(database["kind"], "resource");
    assert_eq!(database["label"], "main");
    assert_eq!(database["data"]["type"], "aws_db_instance");
    assert_eq!(database["data"]["action"], "replace");
    assert_eq!(database["data"]["replaceOrder"], "destroy-before-create");
    assert_eq!(database["data"]["replaceReason"], "replace_because_cannot_update");
    assert_eq!(database["data"]["replacePaths"], json!(["storage_encrypted"]));
    assert_eq!(database["data"]["values"]["endpoint"], "(known after apply)");
    assert_eq!(head["metadata"]["destroyed"], json!(["aws_instance.bastion"]));
    // Module outputs and input variables are followed to the resources behind them.
    assert_eq!(
        dependents(&head, "module.database.aws_db_instance.main"),
        [
            "aws_cloudwatch_metric_alarm.database_cpu",
            "aws_iam_role_policy.read_config",
            "aws_route53_record.database",
            "aws_secretsmanager_secret_version.database",
            "aws_ssm_parameter.database_url",
            "module.database.aws_db_instance.replica",
        ]
        .map(String::from)
        .into()
    );
    assert!(references(&head).contains(&(
        "module.database.aws_db_instance.main".into(),
        "module.network.aws_security_group.database".into()
    )));
    assert!(references(&head).contains(&(
        "aws_instance.api[1]".into(),
        r#"module.network.aws_subnet.private["us-east-1b"]"#.into()
    )));
    assert_eq!(head["metadata"]["unresolvedReferences"], 0);

    let comparison = projections_comparator_default::compare(&base, &head, &json!({})).unwrap();
    assert_eq!(change(&comparison, "module.database.aws_db_instance.main")["status"], "modified");
    assert_eq!(change(&comparison, "aws_instance.bastion")["status"], "removed");
    assert_eq!(change(&comparison, "aws_secretsmanager_secret.database")["status"], "added");
    let moved = change(&comparison, "aws_route53_record.database");
    assert_eq!(moved["before"], json!(["aws_route53_record.db"]));
    // Its relationships move with it: one renamed relationship, not a removal and an addition.
    let reference = comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["collection"] == "relationships"
                && c["after"].as_array().unwrap().iter().any(|a| {
                    a.as_str()
                        .is_some_and(|id| id.starts_with("references:aws_route53_record.database:"))
                })
        })
        .unwrap();
    assert_eq!(
        reference["before"].as_array().unwrap()[0].as_str().unwrap(),
        "references:aws_route53_record.db:module.database.aws_db_instance.main"
    );
    let vpc = comparison["changes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["collection"] == "entities" && c["after"].as_array().unwrap().iter().any(|a| a == "module.network.aws_vpc.main"));
    assert!(vpc.is_none_or(|c| c["status"] == "unchanged"));
}

#[test]
fn opentofu_state_and_plan_agree_on_unchanged_resources() {
    let state = extract("opentofu-state.json");
    let plan = extract("opentofu-plan.json");
    for extraction in [&state, &plan] {
        assert!(!extraction.to_string().contains("native-secret-never-persist"));
    }
    assert_eq!(
        entity(&state, "module.net.terraform_data.vpc"),
        entity(&plan, "module.net.terraform_data.vpc")
    );
    assert_eq!(entity(&state, "module.net")["kind"], "module");
    assert_eq!(entity(&plan, "terraform_data.db")["data"]["action"], "replace");
    assert_eq!(
        entity(&plan, "terraform_data.db")["data"]["replacePaths"],
        json!(["triggers_replace"])
    );
    assert_eq!(entity(&plan, "terraform_data.cache")["data"]["action"], "create");
    assert_eq!(entity(&plan, "terraform_data.app[0]")["data"]["action"], "update");
    assert_eq!(entity(&plan, "terraform_data.app[0]")["label"], "app[0]");
    assert_eq!(plan["metadata"]["destroyed"], json!(["terraform_data.old"]));
    let edges = references(&plan);
    // `module.net.subnet` is the subnet resource behind the output.
    assert!(edges.contains(&("terraform_data.db".into(), "module.net.terraform_data.subnet".into())));
    // `depends_on = [module.net]` means every resource in the module.
    for target in ["module.net.terraform_data.subnet", "module.net.terraform_data.vpc"] {
        assert!(edges.contains(&("terraform_data.cache".into(), target.into())));
    }
    let explicit = plan["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["from"] == "terraform_data.cache" && r["to"] == "module.net.terraform_data.vpc")
        .unwrap();
    assert_eq!(explicit["data"]["dependsOn"], true);
    assert_eq!(explicit["confidence"], "derived");
    let comparison = projections_comparator_default::compare(&state, &plan, &json!({})).unwrap();
    assert_eq!(change(&comparison, "terraform_data.old")["status"], "removed");
    assert_eq!(change(&comparison, "terraform_data.db")["status"], "modified");
}

#[test]
fn terraform_masks_hide_sensitive_values_and_mark_unknown_ones() {
    let plan = extract("terraform-1.14-plan.json");
    let text = plan.to_string();
    assert!(!text.contains("native-secret-never-persist"));
    assert!(text.contains("(sensitive value)"));
    assert!(text.contains("(known after apply)"));
    assert!(references(&plan).contains(&("terraform_data.second".into(), "terraform_data.first".into())));
}

#[test]
fn plans_and_tools_are_not_run_without_trust() {
    let root = fixtures();
    for inputs in [
        json!({"planPath":"opentofu-plan.json","terraformPath":"/bin/sh"}),
        json!({"terraformPath":"/bin/sh"}),
    ] {
        let definition = json!({"id":"infrastructure","extractor":"terraform-infrastructure","inputs":inputs});
        let error = collect(&Process::new(&root).context(&root, Value::clone(&definition)).with_files(vec![])).unwrap_err();
        assert!(format!("{error:#}").contains("--trust"), "{error:#}");
    }
    let definition = json!({"id":"infrastructure","extractor":"terraform-infrastructure","inputs":{"planJsonPath":"aws/base.plan.json"}});
    assert!(!projections_extractor_terraform_infrastructure::requires_trust(
        &definition["inputs"]
    ));
}
