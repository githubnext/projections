//! The Harbor app fixture is a real Xcode 16 project (object version 77) with
//! a synchronized folder, classic groups, an xcconfig, a remote and a local
//! Swift package, and explicit and implicit (linked) dependencies. Xcode
//! builds it, and wrote its `Package.resolved`; `xcodebuild -showBuildSettings`
//! reports the module names asserted here. Regenerate the golden extraction
//! with `PROJECTIONS_UPDATE_GOLDEN=1 cargo test -p projections-extractor-xcode-modules`.

use projections_extractor_sdk::repository_files;
use projections_extractor_sdk::testing::{self, golden};
use projections_extractor_xcode_modules::collect;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/harbor-app")
        .canonicalize()
        .unwrap()
}

fn extract(inputs: Value) -> Value {
    let root = fixture();
    let files = repository_files(&root).unwrap();
    let definition = json!({"id": "xcode", "extractor": "xcode-modules", "inputs": inputs});
    collect(&testing::context(&root, definition).with_files(files)).unwrap()
}

fn find<'a>(items: &'a Value, predicate: impl Fn(&Value) -> bool, what: &str) -> &'a Value {
    items
        .as_array()
        .unwrap()
        .iter()
        .find(|item| predicate(item))
        .unwrap_or_else(|| panic!("no {what}"))
}

const APP: &str = "xcode:Harbor.xcodeproj:target:Harbor";
const KIT: &str = "xcode:Harbor.xcodeproj:target:HarborKit";
const WIDGETS: &str = "xcode:Harbor.xcodeproj:target:Harbor%20Widgets";
const TESTS: &str = "xcode:Harbor.xcodeproj:target:HarborTests";

#[test]
fn reads_targets_modules_dependencies_and_imports() {
    let extraction = extract(json!({}));
    golden(&fixture().parent().unwrap().join("harbor-app.expected.json"), &extraction);
    let entity = |id: &str| find(&extraction["entities"], |e| e["id"] == id, id);
    assert_eq!(entity(WIDGETS)["data"]["module"], "Harbor_Widgets");
    assert_eq!(entity(KIT)["data"]["type"], "framework");
    assert_eq!(entity(KIT)["data"]["imports"], json!(["Foundation", "os"]));
    assert_eq!(entity(APP)["data"]["imports"], json!(["SwiftUI"]));
    let edge = |kind: &str, from: &str, to: &str| {
        find(
            &extraction["relationships"],
            |r| r["kind"] == kind && r["from"] == from && r["to"] == to,
            &format!("{kind} {from} {to}"),
        )["data"]
            .clone()
    };
    assert_eq!(
        edge("depends-on", APP, KIT),
        json!({"explicit": true, "linked": true, "imported": true})
    );
    // Linked without a target dependency: Xcode's implicit dependency.
    assert_eq!(
        edge("depends-on", APP, WIDGETS),
        json!({"explicit": false, "linked": true, "imported": true})
    );
    assert_eq!(
        edge("depends-on", TESTS, APP),
        json!({"explicit": true, "linked": false, "imported": true, "testable": true})
    );
    // Imported, with no declared or linked dependency.
    assert_eq!(
        edge("imports", TESTS, KIT),
        json!({"explicit": false, "linked": false, "imported": true, "testable": true})
    );
    assert_eq!(
        edge("depends-on", KIT, "swiftpm:package:swift-collections"),
        json!({"product": "OrderedCollections", "imported": true})
    );
    assert_eq!(
        edge("depends-on", APP, "swiftpm:package:telemetry"),
        json!({"product": "Telemetry", "imported": true})
    );
    let collections = entity("swiftpm:package:swift-collections");
    assert_eq!(collections["data"]["version"], "1.7.6");
    assert_eq!(collections["data"]["requirement"], "1.1.0..<2.0.0");
    assert_eq!(entity("swiftpm:package:telemetry")["data"]["location"], "Packages/Telemetry");
    // Telemetry's own dependency, pinned for the project.
    assert_eq!(entity("swiftpm:package:swift-log")["data"]["transitive"], true);
}

#[test]
fn imports_can_be_left_out_and_projects_named() {
    let extraction = extract(json!({"imports": false, "projects": ["Harbor.xcodeproj"], "configuration": "Debug"}));
    assert!(
        !extraction["relationships"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["kind"] == "imports")
    );
    let app = find(&extraction["entities"], |e| e["id"] == APP, APP);
    assert_eq!(app["data"]["configuration"], "Debug");
    assert!(app["data"].get("imports").is_none());
    let missing = extract(json!({"projects": ["Other.xcodeproj"]}));
    assert_eq!(missing["entities"], json!([]));
}

/// The fixture with its project file edited: `edit` rewrites project.pbxproj.
fn edited(edit: impl Fn(String) -> String) -> Value {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../target/xcode-modules-tests")
        .join(format!("{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    copy(&fixture(), &root);
    let project = root.join("Harbor.xcodeproj/project.pbxproj");
    std::fs::write(&project, edit(std::fs::read_to_string(&project).unwrap())).unwrap();
    let files = repository_files(&root).unwrap();
    let definition = json!({"id": "xcode", "extractor": "xcode-modules", "inputs": {}});
    let extraction = collect(&testing::context(&root, definition).with_files(files)).unwrap();
    std::fs::remove_dir_all(&root).unwrap();
    extraction
}

fn copy(source: &Path, destination: &Path) {
    std::fs::create_dir_all(destination).unwrap();
    for entry in std::fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        if entry.file_type().unwrap().is_dir() {
            copy(&entry.path(), &destination.join(entry.file_name()));
        } else {
            std::fs::copy(entry.path(), destination.join(entry.file_name())).unwrap();
        }
    }
}

#[test]
fn a_product_without_its_package_is_the_local_package_that_declares_it_or_unresolved() {
    // Without `package`, as a local package listed as a folder is.
    let without = |text: String| {
        text.replace(
            "\t\t\tpackage = 25614AEF581B3B88D6796DC1 /* XCLocalSwiftPackageReference \"Packages/Telemetry\" */;\n",
            "",
        )
    };
    let extraction = edited(without);
    let edge = find(
        &extraction["relationships"],
        |r| r["from"] == APP && r["data"]["product"] == "Telemetry",
        "Telemetry",
    );
    assert_eq!(edge["to"], "swiftpm:package:telemetry");
    let extraction = edited(|text| without(text).replace("productName = Telemetry;", "productName = Unknown;"));
    assert_eq!(extraction["metadata"]["unresolved"], json!([[APP, "Unknown"]]));
    assert!(
        !extraction["entities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["id"] == "swiftpm:package:unknown")
    );
}
