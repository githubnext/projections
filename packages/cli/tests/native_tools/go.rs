//! The Go helper and the Go public API.

use std::{fs, path::Path, process::Command};

use projections_cli::engine;
use serde_json::{Value, json};

use crate::common::{Scratch, api_compatibility, collect, copy, definition, fixtures, items, selected, succeed, tool, verdicts};

/// An extractor process context for the Go helper: a trusted request examining
/// `root` with `definition`, and exactly `granted` (plus `PATH`) as the
/// variables the process received.
fn go_context(root: &Path, definition: &Value, granted: &std::collections::BTreeMap<String, String>) -> projections_extractor_sdk::Context {
    let request = json!({"protocolVersion": 0,
        "projection": {"id": definition["id"], "definition": definition},
        "repository": {"root": root, "checkout": root,
            "revision": {"kind": "working-tree", "ref": "working-tree", "commit": "0000000000000000000000000000000000000000", "dirty": false}},
        "capabilities": {"trusted": true, "network": false}});
    let mut environment = granted.clone();
    environment.insert("PATH".into(), std::env::var("PATH").unwrap());
    projections_extractor_sdk::Context::new("go-support", request)
        .unwrap()
        .with_environment(environment)
}

#[test]
fn native_go_helper_loads_and_type_checks_packages_offline_with_the_users_caches() {
    if !selected(&["PROJECTIONS_NATIVE_ECOSYSTEMS"]) {
        return;
    }
    let scratch = Scratch::new();
    let root = &scratch.0.join("repository");
    copy(&fixtures("go-support").join("go"), root, &[]);
    // Empty caches, no module proxy and no toolchain switching: the helper uses only
    // the standard library and must build offline. The fixture project has no module
    // dependencies, and the granted GOFLAGS must not change how the helper is built.
    let modules = scratch.0.join("modules");
    let cache = scratch.0.join("cache");
    fs::create_dir_all(&modules).unwrap();
    fs::create_dir_all(&cache).unwrap();
    let values = [
        ("GOMODCACHE", modules.to_string_lossy().into_owned()),
        ("GOCACHE", cache.to_string_lossy().into_owned()),
        ("GOPROXY", "off".into()),
        ("GOFLAGS", "-mod=mod".into()),
    ];
    let define = definition;
    let definition = definition(
        "go-support",
        json!({"goPath":tool("PROJECTIONS_GO","go")}),
        json!({"timeoutMs":300000,"environment":values.clone().map(|(name, _)| name),"network":false}),
    );
    let granted: std::collections::BTreeMap<String, String> = values.into_iter().map(|(name, value)| (name.into(), value)).collect();
    let packages = |root: &Path, definition: &Value, granted: &std::collections::BTreeMap<String, String>, patterns: &[&str]| {
        projections_extractor_go_support::run_helper(
            &go_context(root, definition, granted),
            "packages",
            patterns.iter().map(|pattern| pattern.to_string()).collect(),
        )
        .unwrap()
    };
    let loaded = packages(root, &definition, &granted, &["./..."]);
    assert_eq!(loaded["packages"][0]["path"], "example.org/interfaces");
    assert!(loaded["packages"][0]["names"].as_array().unwrap().contains(&json!("StringWriter")));
    assert!(
        fs::read_dir(&modules)
            .unwrap()
            .all(|entry| entry.unwrap().file_name().to_string_lossy().starts_with("cache")),
        "the helper must not populate the module cache"
    );
    assert!(!modules.join("golang.org").exists());
    // Without a granted GOMODCACHE, Go uses the module cache the user's own Go
    // configuration reports, located through the granted HOME; the fixture has no
    // dependencies, so nothing is added to it.
    let ungranted = define(
        "go-support",
        json!({"goPath":tool("PROJECTIONS_GO","go")}),
        json!({"timeoutMs":300000,"environment":["GOCACHE","GOPROXY","HOME"],"network":false}),
    );
    let granted: std::collections::BTreeMap<String, String> = [
        ("GOCACHE", cache.to_string_lossy().into_owned()),
        ("GOPROXY", "off".into()),
        ("HOME", std::env::var("HOME").unwrap()),
    ]
    .into_iter()
    .map(|(name, value)| (name.into(), value))
    .collect();
    assert_eq!(packages(root, &ungranted, &granted, &["./..."]), loaded);
    // Several packages with internal imports, standard library dependencies and a
    // narrower pattern: only matched packages are reported.
    let tree = scratch.0.join("packages");
    copy(&fixtures("go-support").join("go-packages"), &tree, &[]);
    let paths = |patterns: &[&str]| -> Vec<String> {
        packages(&tree, &ungranted, &granted, patterns)["packages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|package| package["path"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(
        paths(&["./..."]),
        [
            "example.org/packages/api",
            "example.org/packages/internal/codec",
            "example.org/packages/memory",
            "example.org/packages/store",
        ]
    );
    assert_eq!(
        paths(&["./api", "./memory"]),
        ["example.org/packages/api", "example.org/packages/memory"]
    );
}

/// apidiff, pinned: the Go team's compatibility checker, run with `go run` only
/// when `PROJECTIONS_APIDIFF=1` allows downloading it.
const APIDIFF: &str = "golang.org/x/exp/cmd/apidiff@v0.0.0-20261014143641-f0251eb4aa3e";

/// go-public-api on two real revisions of a module, classified by the
/// api-compatibility comparator. With `PROJECTIONS_APIDIFF=1`, apidiff runs on
/// the same pair and must report exactly the changes classified as breaking as
/// incompatible, and the rest as compatible.
#[test]
fn native_go_public_api_classifies_apidiff_changes() {
    if !selected(&["PROJECTIONS_NATIVE_ECOSYSTEMS", "PROJECTIONS_NATIVE_GO"]) {
        return;
    }
    let go = tool("PROJECTIONS_GO", "go");
    let scratch = Scratch::new();
    let root = &scratch.0.join("repository");
    let fixture = fixtures("go-public-api").join("compatibility");
    let collect_side = |side: &str| {
        let _ = fs::remove_dir_all(root);
        copy(&fixture.join(side), root, &[]);
        let d = definition(
            "go-public-api",
            json!({"goPath": go}),
            json!({"timeoutMs":300000,"environment":["HOME","GOCACHE","GOMODCACHE"],"network":false}),
        );
        let extraction = collect(root, &d, true).unwrap();
        engine("normalize", json!({"extraction":extraction})).unwrap()
    };
    let before = collect_side("before");
    let after = collect_side("after");
    assert_eq!(after["metadata"]["ecosystem"], "go");
    assert!(
        !items(&after, "entities")
            .iter()
            .any(|entity| entity["id"].as_str().unwrap().contains("internal")),
        "internal packages aren't importable, so they aren't API"
    );
    let comparison = api_compatibility(&before, &after);
    let verdicts = verdicts(&comparison, &before, &after);
    let mut breaking: Vec<String> = verdicts
        .iter()
        .filter(|(_, level, _)| level == "breaking")
        .map(|(label, ..)| label.clone())
        .collect();
    let mut other: Vec<String> = verdicts
        .iter()
        .filter(|(_, level, _)| level != "breaking")
        .map(|(label, ..)| label.clone())
        .collect();
    breaking.sort();
    other.sort();
    assert_eq!(
        breaking,
        ["Delete", "Entry", "Len", "MaxEntries", "New", "ReadOnlyStore", "Total", "Version"]
    );
    assert_eq!(other, ["Amount", "Option", "Tags", "WithLimit"]);
    assert!(!verdicts.iter().any(|(_, level, _)| level == "unknown"));

    if std::env::var("PROJECTIONS_APIDIFF").as_deref() != Ok("1") {
        eprintln!("PROJECTIONS_APIDIFF is not 1; skipping the apidiff cross-check");
        return;
    }
    let export = |side: &str| {
        let directory = scratch.0.join(format!("apidiff-{side}"));
        copy(&fixture.join(side), &directory, &[]);
        let file = scratch.0.join(format!("{side}.export"));
        succeed(
            Command::new(&go)
                .current_dir(&directory)
                .args(["run", APIDIFF, "-w"])
                .arg(&file)
                .arg("example.com/ledger"),
        );
        file
    };
    let (old, new) = (export("before"), export("after"));
    let output = Command::new(&go).args(["run", APIDIFF]).arg(&old).arg(&new).output().unwrap();
    let report = String::from_utf8_lossy(&output.stdout).into_owned();
    let section = |heading: &str| -> Vec<String> {
        let mut names: Vec<String> = report
            .split(heading)
            .nth(1)
            .unwrap_or("")
            .lines()
            .skip(1)
            .take_while(|line| line.starts_with("- "))
            .map(|line| {
                let name = line[2..].split(':').next().unwrap();
                name.rsplit('.').next().unwrap().trim_matches(['(', ')', '*']).to_owned()
            })
            .collect();
        names.sort();
        names
    };
    assert_eq!(section("Incompatible changes:"), breaking, "{report}");
    assert_eq!(section("Compatible changes:"), other, "{report}");
}
