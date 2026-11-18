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
