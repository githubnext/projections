//! The same workspace, locked by npm, pnpm, Yarn classic and Yarn Berry. Each
//! fixture's lockfile was written by the package manager itself; regenerate the
//! golden extractions with
//! `PROJECTIONS_UPDATE_GOLDEN=1 cargo test -p projections-extractor-workspace-dependencies`.

use projections_extractor_sdk::repository_files;
use projections_extractor_sdk::testing::{self, golden};
use projections_extractor_workspace_dependencies::collect;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
        .canonicalize()
        .unwrap()
}

fn extract(root: &Path, inputs: Value) -> anyhow::Result<Value> {
    let files: Vec<String> = repository_files(root)
        .unwrap()
        .into_iter()
        .filter(|f| !f.ends_with(".expected.json"))
        .collect();
    let definition = json!({"id":"dependencies","extractor":"workspace-dependencies","inputs":inputs});
    collect(&testing::context(root, definition).with_files(files))
}

fn manager(name: &str) -> Value {
    let root = fixture(name);
    let extraction = extract(&root, json!({})).unwrap();
    golden(&root.parent().unwrap().join(format!("{name}.expected.json")), &extraction);
    extraction
}

/// `(from, kind, to, alias, declared, resolved)` for every relationship.
fn edges(extraction: &Value) -> BTreeSet<String> {
    extraction["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            format!(
                "{} {} {} {} {} {}",
                e["from"], e["kind"], e["to"], e["data"]["alias"], e["data"]["version"], e["data"]["resolved"]
            )
        })
        .collect()
}

fn entity<'a>(extraction: &'a Value, id: &str) -> &'a Value {
    extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id)
        .unwrap_or_else(|| panic!("missing {id}"))
}

#[test]
fn npm_workspaces_resolve_from_package_lock() {
    let npm = manager("npm");
    assert_eq!(npm["metadata"]["packageManager"], "npm");
    assert_eq!(npm["metadata"]["lockfileVersion"], "3");
    assert!(npm.to_string().contains("workspace:@acme/api"));
    assert!(!npm.to_string().contains("@acme/legacy"), "negated glob");
    let alias = npm["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["data"]["alias"] == "number-check")
        .unwrap();
    // is-number is installed at three majors at once, so each is its own package.
    assert_eq!(alias["to"], "package:is-number@6");
    assert_eq!(alias["data"]["resolved"], "6.0.0");
    assert_eq!(alias["id"], r#"dependency:["@acme/api","dependencies","number-check"]"#);
    assert_eq!(entity(&npm, "package:is-number@6")["data"], json!({"version":"6.0.0"}));
    assert_eq!(entity(&npm, "package:is-odd@3")["data"]["version"], "3.0.1");
    // A package used once keeps its plain name.
    assert_eq!(entity(&npm, "package:kind-of")["data"]["version"], "3.2.2");
    // Transitive dependencies come from the lockfile, nested installs included.
    let transitive = npm["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["from"] == "package:is-odd@3")
        .unwrap();
    assert_eq!(transitive["id"], r#"dependency:["package:is-odd@3","dependencies","is-number"]"#);
    assert_eq!(transitive["to"], "package:is-number@6");
    assert_eq!(transitive["data"], json!({"type":"dependencies","version":"^6.0.0"}));
    assert_eq!(transitive["evidence"], json!([{"kind":"lockfile","source":"package-lock.json"}]));
    assert!(edges(&npm).contains(r#""package:is-even" "dependencies" "package:is-odd@0.1" null "^0.1.2" null"#));
    assert_eq!(entity(&npm, "workspace:acme")["data"]["path"], ".");
    // Workspace members and external packages never share an ID prefix.
    for item in npm["entities"].as_array().unwrap() {
        let id = item["id"].as_str().unwrap();
        match item["kind"].as_str().unwrap() {
            "package" => assert!(id.starts_with("workspace:"), "{id}"),
            "external-package" => assert!(id.starts_with("package:"), "{id}"),
            other => panic!("unexpected kind {other}"),
        }
    }
}

#[test]
fn every_manager_reports_the_same_graph_for_the_same_workspace() {
    let npm = edges(&manager("npm"));
    let pnpm = manager("pnpm");
    let berry = manager("yarn-berry");
    let classic = manager("yarn-classic");
    // pnpm and Berry declare workspace links with the workspace: protocol.
    let protocol = |set: BTreeSet<String>| -> BTreeSet<String> {
        set.into_iter()
            .map(|e| e.replace("\"workspace:^\"", "\"^2.0.0\"").replace("\"workspace:*\"", "\"^1.0.0\""))
            .collect()
    };
    // pnpm records what a package's dependencies resolved to, not their ranges.
    let resolved_only: BTreeSet<String> = npm
        .iter()
        .map(|e| {
            if e.starts_with("\"package:") {
                let mut fields: Vec<&str> = e.split(' ').collect();
                fields[4] = "null";
                fields.join(" ")
            } else {
                e.clone()
            }
        })
        .collect();
    assert_eq!(protocol(edges(&pnpm)), resolved_only);
    // Yarn locks no versions for peer dependencies of workspaces.
    let peer = npm.iter().find(|e| e.contains("peerDependencies")).unwrap();
    let unlocked_peer: BTreeSet<String> = npm
        .iter()
        .map(|e| {
            if e == peer {
                e.replace("\"3.0.1\"", "null").replace("package:is-odd@3", "package:is-odd")
            } else {
                e.clone()
            }
        })
        .collect();
    // Berry writes the npm: protocol on every locked range.
    let berry_ranges: BTreeSet<String> = edges(&berry)
        .into_iter()
        .map(|e| {
            if e.starts_with("\"package:") {
                e.replace("\"npm:", "\"")
            } else {
                e
            }
        })
        .collect();
    assert_eq!(protocol(berry_ranges), unlocked_peer);
    // Yarn classic ignores the negated pattern, so packages/legacy is a workspace.
    let legacy: BTreeSet<String> = edges(&classic).into_iter().filter(|e| !e.contains("@acme/legacy")).collect();
    assert_eq!(legacy, unlocked_peer);
    assert_eq!(edges(&classic).len(), npm.len() + 1);
    assert_eq!(classic["metadata"]["ignoredPatterns"], json!(["!packages/legacy"]));
    for (id, version) in [
        ("package:is-number@1", "1.1.2"),
        ("package:is-number@3", "3.0.0"),
        ("package:is-number@6", "6.0.0"),
        ("package:is-number@7", "7.0.0"),
    ] {
        assert_eq!(entity(&classic, id)["data"]["version"], version);
    }
    for (extraction, name, version) in [(&pnpm, "pnpm", "9.0"), (&berry, "yarn-berry", "8"), (&classic, "yarn-classic", "1")] {
        assert_eq!(extraction["metadata"]["packageManager"], name);
        assert_eq!(extraction["metadata"]["lockfileVersion"], version);
        assert_eq!(extraction["metadata"]["unresolved"], json!([]));
    }
}

struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str, files: &[(&str, &str)]) -> Self {
        let root = std::env::temp_dir().join(format!("projections-workspaces-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        for (file, content) in files {
            fs::create_dir_all(root.join(file).parent().unwrap()).unwrap();
            fs::write(root.join(file), content).unwrap();
        }
        Self(root.canonicalize().unwrap())
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn a_missing_root_manifest_is_named_as_missing_instead_of_extracting_nothing_silently() {
    let scratch = Scratch::new("missing", &[("packages/a/package.json", r#"{"name":"a"}"#)]);
    for (inputs, missing) in [(json!({}), "package.json"), (json!({"root":"web"}), "web/package.json")] {
        let cx = testing::context(
            &scratch.0,
            json!({"id":"workspace-dependencies","extractor":"workspace-dependencies","inputs":inputs}),
        );
        let extraction = cx.finish(collect(&cx).unwrap());
        assert_eq!(extraction["entities"], json!([]));
        assert_eq!(extraction["missingInputs"], json!([missing]));
    }
}

#[test]
fn ambiguous_managers_unknown_workspace_links_and_unnamed_packages_fail() {
    let both = Scratch::new(
        "ambiguous",
        &[
            ("package.json", r#"{"name":"x"}"#),
            ("package-lock.json", r#"{"lockfileVersion":3,"packages":{}}"#),
            ("yarn.lock", "# yarn lockfile v1\n"),
        ],
    );
    assert!(
        extract(&both.0, json!({}))
            .unwrap_err()
            .to_string()
            .contains("several package managers")
    );
    assert_eq!(
        extract(&both.0, json!({"packageManager":"npm"})).unwrap()["metadata"]["packageManager"],
        "npm"
    );

    let link = Scratch::new("link", &[("package.json", r#"{"name":"x","dependencies":{"y":"workspace:*"}}"#)]);
    assert!(
        extract(&link.0, json!({}))
            .unwrap_err()
            .to_string()
            .contains("no workspace package is named y")
    );

    let unnamed = Scratch::new(
        "unnamed",
        &[
            (
                "package.json",
                r#"{"workspaces":["packages/{a,b}"],"devDependencies":{"typescript":"^5"}}"#,
            ),
            ("packages/a/package.json", r#"{"name":"a"}"#),
            ("packages/b/package.json", r#"{"version":"1.0.0"}"#),
        ],
    );
    assert!(extract(&unnamed.0, json!({})).unwrap_err().to_string().contains("must have a name"));
    fs::write(unnamed.0.join("packages/b/package.json"), r#"{"name":"b"}"#).unwrap();
    let extraction = extract(&unnamed.0, json!({})).unwrap();
    assert_eq!(entity(&extraction, "workspace-root")["label"], "(workspace root)");
    assert_eq!(extraction["relationships"][0]["from"], "workspace-root");
    assert!(extraction["relationships"][0]["data"].get("resolved").is_none());
    assert_eq!(extraction["metadata"]["lockfile"], Value::Null);
    entity(&extraction, "workspace:b");
}

#[test]
fn a_nested_workspace_root_reads_its_own_lockfile() {
    let root = fixture("pnpm");
    let scratch = Scratch::new("nested", &[]);
    let copy = scratch.0.join("web");
    for file in repository_files(&root).unwrap() {
        fs::create_dir_all(copy.join(&file).parent().unwrap()).unwrap();
        fs::copy(root.join(&file), copy.join(&file)).unwrap();
    }
    let nested = extract(&scratch.0, json!({"root":"web"})).unwrap();
    assert_eq!(edges(&nested), edges(&manager("pnpm")));
    assert_eq!(nested["metadata"]["lockfile"], "web/pnpm-lock.yaml");
}

/// pnpm 11's boot document: config dependencies and the pnpm version, written
/// before the project lockfile.
const PNPM_11_BOOT: &str = "---
lockfileVersion: '9.0'

importers:

  .:
    configDependencies:
      '@acme/pnpm-plugin':
        specifier: 1.0.0
        version: 1.0.0
    packageManagerDependencies:
      pnpm:
        specifier: 11.20.0
        version: 11.20.0

packages:

  '@acme/pnpm-plugin@1.0.0':
    resolution: {integrity: sha512-NcdALwpXkTm5Zvvbk7owOUSvVvBKDgKP5/ewfXEznmQFfs4ZRmanOeKBTjRVjka3QFoN6XJ+9F3USqfHqTaU5w==}

  pnpm@11.20.0:
    resolution: {integrity: sha512-NcdALwpXkTm5Zvvbk7owOUSvVvBKDgKP5/ewfXEznmQFfs4ZRmanOeKBTjRVjka3QFoN6XJ+9F3USqfHqTaU5w==}
    hasBin: true

snapshots:

  '@acme/pnpm-plugin@1.0.0': {}

  pnpm@11.20.0: {}
";

#[test]
fn a_pnpm_boot_document_before_the_project_lockfile_is_skipped() {
    let root = fixture("pnpm");
    let scratch = Scratch::new("boot", &[]);
    for file in repository_files(&root).unwrap() {
        fs::create_dir_all(scratch.0.join(&file).parent().unwrap()).unwrap();
        fs::copy(root.join(&file), scratch.0.join(&file)).unwrap();
    }
    let project = fs::read_to_string(root.join("pnpm-lock.yaml")).unwrap();
    fs::write(scratch.0.join("pnpm-lock.yaml"), format!("{PNPM_11_BOOT}---\n{project}")).unwrap();
    let two_documents = extract(&scratch.0, json!({})).unwrap();
    let single = manager("pnpm");
    assert_eq!(edges(&two_documents), edges(&single));
    assert_eq!(two_documents["entities"], single["entities"]);
    assert_eq!(two_documents["metadata"]["unresolved"], json!([]));
}

#[test]
fn pnpm_catalog_specifiers_resolve_through_a_pnpm_12_lockfile() {
    let pnpm = manager("pnpm-catalog");
    assert_eq!(pnpm["metadata"]["lockfileVersion"], "9.0");
    assert_eq!(pnpm["metadata"]["unresolved"], json!([]));
    // The boot document's packages are pnpm's own, not the project's.
    assert!(!pnpm.to_string().contains("package:pnpm"));
    let edges = edges(&pnpm);
    for edge in [
        r#""workspace:@demo/app" "dependencies" "package:is-number@7" null "catalog:" "7.0.0""#,
        r#""workspace:@demo/app" "dependencies" "package:is-odd" null "catalog:legacy" "3.0.1""#,
        r#""workspace:@demo/lib" "dependencies" "package:is-number@7" null "catalog:default" "7.0.0""#,
        r#""workspace:@demo/app" "dependencies" "workspace:@demo/lib" null "workspace:*" "1.0.0""#,
        r#""package:is-odd" "dependencies" "package:is-number@6" null null null"#,
    ] {
        assert!(edges.contains(edge), "missing {edge} in {edges:#?}");
    }
}
