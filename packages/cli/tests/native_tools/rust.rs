//! Cargo workspace dependencies and the Rust public API.

use std::{fs, process::Command};

use projections_cli::engine;
use serde_json::json;

use crate::common::{Scratch, api_compatibility, collect, copy, definition, ecosystem, fixtures, items, selected, tool, verdicts};

#[test]
fn native_cargo_resolves_actual_workspace_dependencies() {
    if !selected(&["PROJECTIONS_NATIVE_ECOSYSTEMS"]) {
        return;
    }
    let scratch = Scratch::new();
    let root = &scratch.0;
    copy(&fixtures("cargo-dependencies").join("cargo"), root, &["target", "generated-"]);
    let state = collect(
        root,
        &ecosystem("cargo-dependencies", json!({"cargoPath":tool("PROJECTIONS_CARGO","cargo")})),
        true,
    )
    .unwrap();
    assert_eq!(items(&state, "entities").len(), 2);
    assert_eq!(items(&state, "relationships").len(), 1);
    assert!(!state.to_string().contains(root.to_str().unwrap()));
}

/// rust-public-api on two real revisions of a crate, classified by the
/// api-compatibility comparator. Requires a nightly toolchain
/// (`PROJECTIONS_RUST_NIGHTLY`, default `nightly`). When cargo-semver-checks is
/// installed, every item it reports is also classified as breaking.
#[test]
fn native_rust_public_api_classifies_cargo_semver_changes() {
    if !selected(&["PROJECTIONS_NATIVE_ECOSYSTEMS", "PROJECTIONS_NATIVE_RUST"]) {
        return;
    }
    let toolchain = tool("PROJECTIONS_RUST_NIGHTLY", "nightly");
    let scratch = Scratch::new();
    let root = &scratch.0.join("repository");
    let fixture = fixtures("rust-public-api").join("compatibility");
    let collect_side = |side: &str| {
        let _ = fs::remove_dir_all(root.join("src"));
        copy(&fixture.join(side), root, &["target"]);
        let d = definition(
            "rust-public-api",
            json!({"toolchain": toolchain}),
            json!({"timeoutMs":300000,"environment":["HOME","RUSTUP_HOME","CARGO_HOME"],"network":false}),
        );
        let extraction = collect(root, &d, true).unwrap();
        engine("normalize", json!({"extraction":extraction})).unwrap()
    };
    let before = collect_side("before");
    let after = collect_side("after");
    assert_eq!(after["metadata"]["ecosystem"], "rust");
    let stats = items(&after, "entities")
        .iter()
        .find(|entity| entity["id"] == "rust:throttle::Stats")
        .unwrap();
    assert_eq!(stats["data"]["contract"]["nonExhaustive"], true);
    assert!(
        items(&before, "entities")
            .iter()
            .any(|entity| entity["id"] == "rust:throttle::Limiter: Send")
    );

    let comparison = api_compatibility(&before, &after);
    assert_eq!(comparison["metadata"]["compatibility"]["ecosystem"], "rust");
    let verdicts = verdicts(&comparison, &before, &after);
    for (label, level, rule) in [
        ("tick", "breaking", "trait-new-item-no-default"),
        ("elapsed", "additive", "trait-new-default-item"),
        ("window", "breaking", "struct-add-public-field-when-no-private"),
        ("Throttle", "breaking", "enum-variant-new"),
        ("impl Send", "breaking", "item-remove"),
        ("capacity", "breaking", "const-fn-removed"),
        ("check", "breaking", "fn-change-arity"),
        ("reset", "breaking", "item-remove"),
        ("remaining", "additive", "item-new"),
        ("Stats", "additive", "item-new"),
        ("DEFAULT_BURST", "unknown", "constant-value"),
    ] {
        assert!(
            verdicts
                .iter()
                .any(|(found, found_level, rules)| found == label && found_level == level && rules.contains(&rule.to_owned())),
            "{label} is not {level} by {rule}: {verdicts:#?}"
        );
    }

    // cargo-semver-checks, the de facto tool, is never installed by Projections;
    // when the developer has it, its findings must all be breaking here too.
    let semver_checks = Command::new(tool("PROJECTIONS_CARGO", "cargo"))
        .args(["semver-checks", "--version"])
        .output();
    if !semver_checks.is_ok_and(|output| output.status.success()) {
        eprintln!("cargo-semver-checks is not installed; skipping its cross-check");
        return;
    }
    let baseline = scratch.0.join("baseline");
    copy(&fixture.join("before"), &baseline, &["target"]);
    // The fixture bumps the major version, so check it as a minor release to report every break.
    let output = Command::new(tool("PROJECTIONS_CARGO", "cargo"))
        .current_dir(root)
        .env("RUSTUP_TOOLCHAIN", &toolchain)
        .args(["semver-checks", "check-release", "--release-type", "minor", "--baseline-root"])
        .arg(&baseline)
        .output()
        .unwrap();
    let report = String::from_utf8_lossy(&output.stdout).into_owned() + &String::from_utf8_lossy(&output.stderr);
    let lints: Vec<&str> = report
        .lines()
        .filter_map(|line| line.trim().strip_prefix("--- failure "))
        .filter_map(|line| line.split(':').next())
        .collect();
    assert!(!lints.is_empty(), "cargo-semver-checks reported nothing:\n{report}");
    let labels = |lint: &str| -> &[&str] {
        match lint {
            "auto_trait_impl_removed" => &["impl Send", "impl Sync"],
            "constructible_struct_adds_field" => &["window"],
            "enum_variant_added" => &["Throttle"],
            "inherent_method_const_removed" => &["capacity"],
            "inherent_method_missing" => &["reset"],
            "method_parameter_count_changed" => &["check"],
            "trait_method_added" => &["tick"],
            other => panic!("cargo-semver-checks reports {other}, which this test doesn't map:\n{report}"),
        }
    };
    for lint in lints {
        for label in labels(lint) {
            assert!(
                verdicts.iter().any(|(found, level, _)| found == label && level == "breaking"),
                "cargo-semver-checks reports {lint} for {label}, which isn't breaking here"
            );
        }
    }
}
