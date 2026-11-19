//! Xcode projects, checked against Xcode itself (`PROJECTIONS_NATIVE_XCODE=1`,
//! macOS with Xcode; `PROJECTIONS_XCODEBUILD` names the executable).

use std::process::Command;

use serde_json::{Value, json};

use crate::common::{Scratch, collect, copy, definition, fixtures, items, selected, tool};

/// Every target's module name is the `PRODUCT_MODULE_NAME` `xcodebuild` reports.
#[test]
fn native_xcode_module_names_match_xcodebuild() {
    if !selected(&["PROJECTIONS_NATIVE_XCODE"]) {
        return;
    }
    let scratch = Scratch::new();
    let root = &scratch.0;
    copy(&fixtures("xcode-modules").join("harbor-app"), root, &[]);
    let extraction = collect(root, &definition("xcode-modules", json!({}), json!({})), false).unwrap();
    let targets: Vec<&Value> = items(&extraction, "entities")
        .iter()
        .filter(|entity| entity["kind"] == "target")
        .collect();
    assert_eq!(targets.len(), 4);
    for target in targets {
        let name = target["label"].as_str().unwrap();
        let output = Command::new(tool("PROJECTIONS_XCODEBUILD", "xcodebuild"))
            .args(["-showBuildSettings", "-json", "-project", "Harbor.xcodeproj", "-target", name])
            .current_dir(root)
            .output()
            .unwrap();
        assert!(output.status.success(), "xcodebuild -showBuildSettings for {name} failed");
        let settings: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(
            target["data"]["module"], settings[0]["buildSettings"]["PRODUCT_MODULE_NAME"],
            "{name}"
        );
    }
}
