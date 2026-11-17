use super::*;
use projections_extractor_sdk::{Output, testing};
use std::path::Path;
use std::sync::{Arc, Mutex};

fn fixtures() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").canonicalize().unwrap()
}

#[test]
fn dump_package_runs_swiftpm_for_each_package_and_needs_trust() {
    let root = fixtures();
    let definition = json!({"id": "swift", "extractor": ID, "inputs": {"root": "harbor", "manifest": "dump-package", "swiftPath": "/opt/swift/bin/swift"}});
    let untrusted = format!("{:#}", collect(&testing::context(&root, definition.clone())).unwrap_err());
    assert!(untrusted.contains("trust"), "{untrusted}");
    let runs: Arc<Mutex<Vec<Vec<String>>>> = Arc::default();
    let recorded = Arc::clone(&runs);
    let cx = testing::trusted(&root, definition).with_tools(move |call| {
        recorded.lock().unwrap().push(call.argv.to_vec());
        let package = &call.argv[3];
        let dump = if package.ends_with("Telemetry") {
            "harbor-packages-telemetry.dump.json"
        } else {
            "harbor.dump.json"
        };
        Ok(Output {
            stdout: std::fs::read_to_string(fixtures().join(dump))?,
            stderr: String::new(),
        })
    });
    let extraction = collect(&cx).unwrap();
    let runs = runs.lock().unwrap();
    assert_eq!(runs.len(), 2);
    assert_eq!(runs[0][..3], ["/opt/swift/bin/swift", "package", "--package-path"]);
    assert_eq!(runs[0].last().unwrap(), "dump-package");
    assert!(
        runs[1][3].replace('\\', "/").ends_with("harbor/Packages/Telemetry"),
        "{:?}",
        runs[1]
    );
    assert_eq!(extraction["metadata"]["packages"][1]["manifest"], "dump-package");
}

#[test]
fn only_dump_package_needs_trust() {
    assert!(!requires_trust(&json!({})));
    assert!(!requires_trust(&json!({"manifestJsonPath": "dump.json"})));
    assert!(requires_trust(&json!({"manifest": "dump-package"})));
    let invalid = json!({"inputs": {"manifest": "evaluate"}});
    assert!(format!("{:#}", mode(&invalid).unwrap_err()).contains("\"static\" or \"dump-package\""));
}

#[test]
fn local_packages_are_found_relative_to_their_dependent() {
    assert_eq!(packages::local_dir("", "Packages/Core").as_deref(), Some("Packages/Core"));
    assert_eq!(
        packages::local_dir("Apps/App", "../../Packages/./Core").as_deref(),
        Some("Packages/Core")
    );
    assert_eq!(packages::local_dir("", "../Elsewhere"), None);
    assert_eq!(packages::local_dir("", "/absolute"), None);
}
