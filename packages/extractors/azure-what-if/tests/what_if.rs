//! What-if results for a Bicep deployment, compiled with Bicep 0.48.
//!
//! `base/` and `head/` hold the Bicep source, its `bicep build` output and the
//! `az deployment group what-if --no-pretty-print` result for that revision:
//! the base is deployed, and the head adds a private-endpoints subnet with its
//! network security group and a Key Vault private endpoint, resizes the VM and
//! disables the vault's public access. The extractions are goldens
//! (`PROJECTIONS_UPDATE_GOLDEN=1` rewrites them) and the graph renderer's Azure
//! scenario.

use projections_extractor_azure_what_if::collect;
use projections_extractor_sdk::testing::{Process, golden};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const RG: &str = "/subscriptions/4f6c2b1e-9a3d-4c57-8e21-6b0d9f3a7c45/resourcegroups/rg-shop-prod";

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn id(path: &str) -> String {
    format!("{RG}/providers/{path}").to_lowercase()
}

fn extract(inputs: Value) -> anyhow::Result<Value> {
    let root = fixtures();
    let definition = json!({"id":"azure","extractor":"azure-what-if","inputs":inputs});
    let extraction = collect(&Process::new(&root).context(&root, Value::clone(&definition)).with_files(vec![]))?;
    projections_engine::normalize(&extraction, "").unwrap();
    Ok(extraction)
}

fn revision(side: &str) -> Value {
    extract(json!({"whatIfJsonPath":format!("{side}/what-if.json"),"templateJsonPath":format!("{side}/main.json")})).unwrap()
}

fn entity<'a>(extraction: &'a Value, id: &str) -> &'a Value {
    extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id)
        .unwrap_or_else(|| panic!("no entity {id}"))
}

fn edges(extraction: &Value, kind: &str) -> BTreeSet<(String, String)> {
    extraction["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["kind"] == kind)
        .map(|r| {
            let short = |v: &Value| {
                let text = v.as_str().unwrap();
                text.rsplit_once("/providers/")
                    .map_or(text.rsplit('/').next().unwrap(), |(_, p)| p)
                    .to_owned()
            };
            (short(&r["from"]), short(&r["to"]))
        })
        .collect()
}

fn pairs(list: &[(&str, &str)]) -> BTreeSet<(String, String)> {
    list.iter().map(|(a, b)| ((*a).to_lowercase(), (*b).to_lowercase())).collect()
}

#[test]
fn bicep_change_adds_a_subnet_and_its_nsg_and_modifies_the_vm() {
    let base = revision("base");
    let head = revision("head");
    golden(&fixtures().join("base/expected.json"), &base);
    golden(&fixtures().join("head/expected.json"), &head);
    // The graph renderer's Azure scenario is this extraction pair.
    let scenario = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../renderers/graph/fixtures");
    golden(&scenario.join("azure-before.json"), &base);
    golden(&scenario.join("azure-after.json"), &head);

    let group = entity(&head, RG);
    assert_eq!(group["kind"], "resource-group");
    assert_eq!(group["label"], "rg-shop-prod");
    let vm = entity(&head, &id("Microsoft.Compute/virtualMachines/vm-api"));
    assert_eq!(vm["label"], "vm-api");
    assert_eq!(vm["data"]["type"], "Microsoft.Compute/virtualMachines");
    assert_eq!(vm["data"]["provider"], "Microsoft.Compute");
    assert_eq!(vm["data"]["action"], "update");
    assert_eq!(vm["data"]["changedProperties"], json!(["properties.hardwareProfile.vmSize"]));
    let subnet = entity(&head, &id("Microsoft.Network/virtualNetworks/vnet-shop/subnets/private-endpoints"));
    assert_eq!(subnet["label"], "private-endpoints");
    assert_eq!(subnet["data"]["action"], "create");
    let disk = entity(&head, &id("Microsoft.Compute/disks/vm-api_OsDisk_1_8c3f0e2a"));
    assert_eq!(disk["data"]["managed"], false);
    assert!(disk["data"].get("action").is_none());

    // Resource IDs in properties, in the direction of use; read-only back-references are dropped.
    let expected = pairs(&[
        (
            "Microsoft.Compute/virtualMachines/vm-api",
            "Microsoft.Compute/disks/vm-api_OsDisk_1_8c3f0e2a",
        ),
        (
            "Microsoft.Compute/virtualMachines/vm-api",
            "Microsoft.Network/networkInterfaces/nic-api",
        ),
        (
            "Microsoft.KeyVault/vaults/kv-shop-prod",
            "Microsoft.Network/virtualNetworks/vnet-shop/subnets/app",
        ),
        (
            "Microsoft.Network/networkInterfaces/nic-api",
            "Microsoft.Network/publicIPAddresses/pip-api",
        ),
        (
            "Microsoft.Network/networkInterfaces/nic-api",
            "Microsoft.Network/virtualNetworks/vnet-shop/subnets/app",
        ),
        (
            "Microsoft.Network/privateEndpoints/pe-kv-shop-prod",
            "Microsoft.KeyVault/vaults/kv-shop-prod",
        ),
        (
            "Microsoft.Network/privateEndpoints/pe-kv-shop-prod",
            "Microsoft.Network/virtualNetworks/vnet-shop/subnets/private-endpoints",
        ),
        (
            "Microsoft.Network/virtualNetworks/vnet-shop/subnets/app",
            "Microsoft.Network/networkSecurityGroups/nsg-app",
        ),
        (
            "Microsoft.Network/virtualNetworks/vnet-shop/subnets/data",
            "Microsoft.Network/virtualNetworks/vnet-shop/subnets/app",
        ),
        (
            "Microsoft.Network/virtualNetworks/vnet-shop/subnets/private-endpoints",
            "Microsoft.Network/networkSecurityGroups/nsg-private-endpoints",
        ),
        (
            "Microsoft.Network/virtualNetworks/vnet-shop/subnets/private-endpoints",
            "Microsoft.Network/virtualNetworks/vnet-shop/subnets/data",
        ),
        (
            "Microsoft.Storage/storageAccounts/stshopprod",
            "Microsoft.Network/virtualNetworks/vnet-shop/subnets/data",
        ),
    ]);
    assert_eq!(edges(&head, "references"), expected);
    let explicit = head["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| {
            r["from"] == id("Microsoft.Network/virtualNetworks/vnet-shop/subnets/data")
                && r["to"] == id("Microsoft.Network/virtualNetworks/vnet-shop/subnets/app")
        })
        .unwrap();
    assert_eq!(explicit["data"], json!({"dependsOn":true}));
    let nic = head["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["from"] == id("Microsoft.Network/networkInterfaces/nic-api") && r["to"].as_str().unwrap().ends_with("/subnets/app"))
        .unwrap();
    assert_eq!(nic["data"], json!({"attributes":["ipConfigurations.subnet"],"dependsOn":true}));
    assert!(edges(&head, "contains").contains(&(
        "Microsoft.Network/virtualNetworks/vnet-shop".to_lowercase(),
        "Microsoft.Network/virtualNetworks/vnet-shop/subnets/private-endpoints".to_lowercase()
    )));
    assert_eq!(head["metadata"]["externalReferences"], 0);
    assert_eq!(head["metadata"]["unmatchedTemplateDependencies"], 0);

    let comparison = projections_comparator_default::compare(&base, &head, &json!({})).unwrap();
    let status = |entity: &str| {
        comparison["changes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["collection"] == "entities" && c["after"].as_array().unwrap().iter().any(|a| a == entity))
            .map_or("unchanged", |c| c["status"].as_str().unwrap())
    };
    assert_eq!(
        status(&id("Microsoft.Network/virtualNetworks/vnet-shop/subnets/private-endpoints")),
        "added"
    );
    assert_eq!(
        status(&id("Microsoft.Network/networkSecurityGroups/nsg-private-endpoints")),
        "added"
    );
    assert_eq!(status(&id("Microsoft.Compute/virtualMachines/vm-api")), "modified");
    // Back-references would have changed these; they don't.
    assert_eq!(status(&id("Microsoft.Network/virtualNetworks/vnet-shop")), "unchanged");
    assert_eq!(status(&id("Microsoft.Network/networkSecurityGroups/nsg-app")), "unchanged");
}

#[test]
fn what_if_alone_derives_the_graph_from_resource_ids() {
    let head = extract(json!({"whatIfJsonPath":"head/what-if.json"})).unwrap();
    assert!(head["metadata"].get("unmatchedTemplateDependencies").is_none());
    // Without the template, sibling ordering is unknown but property references remain.
    assert!(!edges(&head, "references").contains(&(
        "Microsoft.Network/virtualNetworks/vnet-shop/subnets/data".to_lowercase(),
        "Microsoft.Network/virtualNetworks/vnet-shop/subnets/app".to_lowercase()
    )));
    assert_eq!(edges(&head, "references").len(), 10);
    let storage = entity(&head, &id("Microsoft.Storage/storageAccounts/stshopprod"));
    assert_eq!(storage["data"]["values"]["kind"], "StorageV2");
    assert_eq!(storage["data"]["values"]["properties"]["keyCreationTime"], "(sensitive value)");
}

#[test]
fn failed_results_and_unknown_change_types_are_errors() {
    let root = std::env::temp_dir().join(format!("azure-what-if-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let write = |name: &str, value: Value| {
        std::fs::write(root.join(name), value.to_string()).unwrap();
    };
    write(
        "failed.json",
        json!({"status":"Failed","error":{"code":"InvalidTemplate","message":"Deployment template validation failed"}}),
    );
    write(
        "unknown.json",
        json!({"status":"Succeeded","changes":[{"resourceId":format!("{RG}/providers/Microsoft.Web/sites/app"),"changeType":"Explode"}]}),
    );
    // The REST response nests the result under `properties`; Delete only lists the resource as destroyed.
    write(
        "rest.json",
        json!({"status":"Succeeded","properties":{"changes":[{"resourceId":format!("{RG}/providers/Microsoft.Web/sites/old"),"changeType":"Delete","before":{},"after":null}]}}),
    );
    let run = |file: &str| {
        let definition = json!({"id":"azure","extractor":"azure-what-if","inputs":{"whatIfJsonPath":file}});
        collect(&Process::new(&root).context(&root, Value::clone(&definition)).with_files(vec![]))
    };
    let failed = format!("{:#}", run("failed.json").unwrap_err());
    assert!(failed.contains("Deployment template validation failed"), "{failed}");
    assert!(format!("{:#}", run("unknown.json").unwrap_err()).contains("Explode"));
    let rest = run("rest.json").unwrap();
    assert_eq!(rest["entities"], json!([]));
    assert_eq!(
        rest["metadata"]["destroyed"],
        json!([format!("{RG}/providers/Microsoft.Web/sites/old")])
    );
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn the_azure_cli_is_not_run_without_trust() {
    let root = fixtures();
    let definition = json!({"id":"azure","extractor":"azure-what-if","inputs":{"templateFile":"head/main.bicep","resourceGroup":"rg-shop-prod","azPath":"/bin/sh"}});
    let error = collect(&Process::new(&root).context(&root, Value::clone(&definition)).with_files(vec![])).unwrap_err();
    assert!(format!("{error:#}").contains("--trust"), "{error:#}");
    assert!(projections_extractor_azure_what_if::requires_trust(&definition["inputs"]));
    assert!(!projections_extractor_azure_what_if::requires_trust(
        &json!({"whatIfJsonPath":"head/what-if.json"})
    ));
}

#[test]
fn native_what_if_runs_the_users_azure_cli_with_the_deployment_scope() {
    let root = fixtures();
    let calls = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
    let recorded = calls.clone();
    let mut host = Process::new(&root);
    host.trusted = true;
    host.runner = Some(std::sync::Arc::new(move |argv: &[String], _cwd: &Path| {
        recorded.lock().unwrap().push(argv.to_vec());
        let file = if argv.iter().any(|a| a == "what-if") {
            "head/what-if.json"
        } else {
            "head/main.json"
        };
        Ok(projections_extractor_sdk::Output {
            stdout: std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(file)).unwrap(),
            stderr: String::new(),
        })
    }));
    let definition = json!({"id":"azure","extractor":"azure-what-if","inputs":{
        "templateFile":"head/main.bicep","resourceGroup":"rg-shop-prod","subscription":"shop-prod","parameters":["adminPassword=unused"]}});
    let native = collect(&host.context(&root, Value::clone(&definition)).with_files(vec![])).unwrap();
    assert_eq!(native["entities"], revision("head")["entities"]);
    let calls = calls.lock().unwrap();
    // The extractor resolves the template under the canonical root, one component at a time.
    let template = projections_extractor_sdk::canonical(&root)
        .unwrap()
        .join("head")
        .join("main.bicep")
        .to_string_lossy()
        .into_owned();
    assert_eq!(
        calls[0],
        [
            "az",
            "deployment",
            "group",
            "what-if",
            "--template-file",
            &template,
            "--no-pretty-print",
            "--result-format",
            "FullResourcePayloads",
            "--only-show-errors",
            "--resource-group",
            "rg-shop-prod",
            "--subscription",
            "shop-prod",
            "--parameters",
            "adminPassword=unused",
        ]
    );
    assert_eq!(calls[1], ["az", "bicep", "build", "--file", &template, "--stdout"]);
    let missing = json!({"id":"azure","extractor":"azure-what-if","inputs":{"templateFile":"head/main.bicep","scope":"sub"}});
    assert!(
        format!(
            "{:#}",
            collect(&host.context(&root, Value::clone(&missing)).with_files(vec![])).unwrap_err()
        )
        .contains("inputs.location")
    );
}
