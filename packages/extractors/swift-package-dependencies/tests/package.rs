//! The Harbor fixture is a real package: SwiftPM resolved it (writing its
//! `Package.resolved`) and built it, and `*.dump.json` are its manifests as
//! `swift package dump-package` printed them, with the fixtures' absolute
//! directory replaced by `/fixtures`. Regenerate the golden extraction with
//! `PROJECTIONS_UPDATE_GOLDEN=1 cargo test -p projections-extractor-swift-package-dependencies`.

use projections_extractor_sdk::repository_files;
use projections_extractor_sdk::testing::{self, golden};
use projections_extractor_swift_package_dependencies::collect;
use projections_extractor_swift_support::manifest::{dump, statics};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").canonicalize().unwrap()
}

fn extract(inputs: Value) -> anyhow::Result<Value> {
    let root = fixtures();
    let files: Vec<String> = repository_files(&root)
        .unwrap()
        .into_iter()
        .filter(|f| !f.ends_with(".expected.json"))
        .collect();
    let definition = json!({"id": "swift", "extractor": "swift-package-dependencies", "inputs": inputs});
    collect(&testing::context(&root, definition).with_files(files))
}

fn dumped(name: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(fixtures().join(name)).unwrap()).unwrap()
}

#[test]
fn reads_the_package_and_its_local_packages_without_running_them() {
    let extraction = extract(json!({"root": "harbor"})).unwrap();
    golden(&fixtures().join("harbor.expected.json"), &extraction);
    let ids: Vec<&str> = extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert!(ids.contains(&"swiftpm:Packages%2FTelemetry:product:Telemetry"), "{ids:?}");
    let edge = |from: &str, to: &str| {
        extraction["relationships"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["from"] == from && r["to"] == to)
            .unwrap_or_else(|| panic!("no {from} -> {to}"))
            .clone()
    };
    // The local package's product, not an external package.
    edge("swiftpm:.:target:Harbor", "swiftpm:Packages%2FTelemetry:product:Telemetry");
    let logging = edge("swiftpm:.:target:HarborCore", "swiftpm:package:swift-log");
    assert_eq!(logging["data"]["product"], "Logging");
    let tests = edge("swiftpm:.:target:HarborTests", "swiftpm:.:target:HarborCore");
    assert_eq!(tests["data"]["platforms"], json!(["macos", "linux"]));
    let log = extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "swiftpm:package:swift-log")
        .unwrap();
    assert_eq!(log["data"]["version"], "1.17.2");
    // Harbor and Telemetry require it differently.
    assert_eq!(log["data"]["requirement"], "1.5.0..<2.0.0");
    assert_eq!(extraction["metadata"]["unresolved"], json!([]));
}

#[test]
fn reads_the_same_manifests_swiftpm_evaluates() {
    for (manifest, dump) in [
        ("harbor/Package.swift", "harbor.dump.json"),
        ("harbor/Packages/Telemetry/Package.swift", "harbor-packages-telemetry.dump.json"),
    ] {
        let source = fs::read_to_string(fixtures().join(manifest)).unwrap();
        let mut read = statics::read(&source).unwrap();
        read.tools_version = None;
        let mut evaluated = dump::read(&dumped(dump)).unwrap();
        // Local dependencies' paths are relative to their package either way.
        evaluated.tools_version = None;
        assert_eq!(read, evaluated, "{manifest}");
    }
}

#[test]
fn imported_dump_package_output_gives_the_same_graph() {
    let read = extract(json!({"root": "harbor"})).unwrap();
    let imported = extract(json!({"root": "harbor", "manifestJsonPath": "harbor.dump.json"})).unwrap();
    assert_eq!(read["entities"], imported["entities"]);
    assert_eq!(read["relationships"], imported["relationships"]);
    assert_eq!(imported["metadata"]["packages"][0]["manifest"], "imported");
}

#[test]
fn a_manifest_that_computes_its_targets_needs_swiftpm() {
    let error = format!("{:#}", extract(json!({"root": "computed"})).unwrap_err());
    assert!(error.contains("computed/Package.swift line 9: code changes `targets`"), "{error}");
    assert!(error.contains("\"dump-package\""), "{error}");
    let imported = extract(json!({"root": "computed", "manifestJsonPath": "computed.dump.json"})).unwrap();
    let labels: Vec<&str> = imported["entities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["label"].as_str().unwrap())
        .collect();
    assert_eq!(labels, ["Port", "Port"]);
}

#[test]
fn a_revision_without_the_package_has_no_graph() {
    let extraction = extract(json!({"root": "missing"})).unwrap();
    assert_eq!(extraction["entities"], json!([]));
}
