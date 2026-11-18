//! Swift packages, evaluated by SwiftPM itself (`PROJECTIONS_NATIVE_SWIFT=1`;
//! `PROJECTIONS_SWIFT` names the executable, default `swift`).

use serde_json::json;

use crate::common::{Scratch, collect, copy, definition, fixtures, items, selected, tool};

/// What `swift package dump-package` evaluates is the graph the manifests are
/// read as without running them; and a manifest only SwiftPM can evaluate is
/// read through it.
#[test]
fn native_swift_dump_package_agrees_with_reading_the_manifest() {
    if !selected(&["PROJECTIONS_NATIVE_SWIFT"]) {
        return;
    }
    let scratch = Scratch::new();
    let root = &scratch.0;
    copy(&fixtures("swift-package-dependencies"), root, &[".build", "harbor.expected.json"]);
    let execution = json!({"timeoutMs": 120000, "environment": ["HOME", "DEVELOPER_DIR", "TMPDIR"]});
    let swift = tool("PROJECTIONS_SWIFT", "swift");
    let extract = |inputs| collect(root, &definition("swift-package-dependencies", inputs, execution.clone()), true).unwrap();
    let read = extract(json!({"root": "harbor"}));
    let evaluated = extract(json!({"root": "harbor", "manifest": "dump-package", "swiftPath": swift}));
    assert_eq!(items(&read, "entities"), items(&evaluated, "entities"));
    assert_eq!(items(&read, "relationships"), items(&evaluated, "relationships"));
    assert_eq!(evaluated["metadata"]["packages"][1]["manifest"], "dump-package");
    let computed = extract(json!({"root": "computed", "manifest": "dump-package", "swiftPath": swift}));
    let targets: Vec<&str> = items(&computed, "entities")
        .iter()
        .filter(|entity| entity["kind"] == "target")
        .map(|entity| entity["label"].as_str().unwrap())
        .collect();
    // `#if os(Linux)` adds a target only where SwiftPM runs on Linux.
    let expected: &[&str] = if cfg!(target_os = "linux") {
        &["Port", "PortLinux"]
    } else {
        &["Port"]
    };
    assert_eq!(targets, expected);
    assert!(!computed.to_string().contains(root.to_str().unwrap()));
}
