//! How an extractor reads the revision: Git objects, a checkout in place, and a scope.

use projections_extractor_sdk::Context;
use serde_json::{Value, json};
use std::fs;
use std::path::Path;
use std::process::Command;

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(["-c", "user.name=t", "-c", "user.email=t@example.com"])
        .args(args)
        .current_dir(root)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

/// A repository with a committed file, a nested one, an ignored one and a
/// `.gitignore`, and its tree.
fn repository() -> (tempfile::TempDir, String) {
    let root = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "-q"]);
    fs::write(root.path().join("a.txt"), "alpha").unwrap();
    fs::create_dir(root.path().join("src")).unwrap();
    fs::write(root.path().join("src/b.json"), r#"{"b": 1}"#).unwrap();
    fs::write(root.path().join(".gitignore"), "*.log\n").unwrap();
    git(root.path(), &["add", "-A"]);
    git(root.path(), &["commit", "-qm", "one"]);
    fs::write(root.path().join("ignored.log"), "secret").unwrap();
    let tree = git(root.path(), &["rev-parse", "HEAD^{tree}"]);
    (root, tree)
}

fn request(repository: Value) -> Value {
    let mut repository = repository;
    repository["revision"] = json!({"kind": "commit", "ref": "0".repeat(40), "commit": "0".repeat(40), "dirty": false});
    json!({"protocolVersion": 0, "projection": {"id": "t", "definition": {"id": "t", "extractor": "t", "renderer": "graph"}},
        "repository": repository, "capabilities": {"trusted": false, "network": false}})
}

fn objects(root: &Path, tree: &str, scope: Option<Value>) -> Context {
    let mut repository = json!({"mode": "git-objects", "git": {"directory": root.join(".git"), "tree": tree}});
    if let Some(scope) = scope {
        repository["scope"] = scope;
    }
    Context::new("t", request(repository)).unwrap()
}

#[test]
fn git_objects_list_and_read_the_tree_with_nothing_on_disk() {
    let (root, tree) = repository();
    // Changing the working tree changes nothing: the tree is read from objects.
    fs::write(root.path().join("a.txt"), "changed").unwrap();
    let cx = objects(root.path(), &tree, None);
    assert_eq!(cx.mode(), "git-objects");
    assert!(cx.directory().is_none());
    assert_eq!(cx.files().unwrap(), [".gitignore", "a.txt", "src/b.json"]);
    assert_eq!(cx.read_source("a.txt").unwrap(), "alpha");
    assert_eq!(cx.read_json("src/b.json").unwrap()["b"], 1);
    assert_eq!(cx.entry("a.txt").unwrap().size, 5);
    assert!(cx.is_dir("src").unwrap());
    assert!(!cx.is_dir("a.txt").unwrap());
    // Reads interleave on one Git process.
    assert_eq!(cx.read_source("a.txt").unwrap(), "alpha");
    let missing = cx.read_source("ignored.log").unwrap_err().to_string();
    assert!(missing.contains("ignored.log"), "{missing}");
    assert!(cx.read_bytes("a.txt", 2).is_err());
    assert_eq!(cx.read_source("a.txt").unwrap(), "alpha");
}

#[test]
#[should_panic(expected = "reads the revision from Git objects")]
fn git_objects_have_no_root() {
    let (root, tree) = repository();
    objects(root.path(), &tree, None).root();
}

#[test]
fn a_scope_narrows_the_files_and_refuses_reads_outside_it() {
    let (root, tree) = repository();
    let cx = objects(root.path(), &tree, Some(json!(["src"])));
    assert_eq!(cx.files().unwrap(), ["src/b.json"]);
    assert_eq!(cx.scope().unwrap(), ["src"]);
    let outside = cx.read_source("a.txt").unwrap_err().to_string();
    assert!(
        outside.contains("a.txt") && outside.contains("outside its declared scope"),
        "{outside}"
    );
    let escaping = json!({"mode": "git-objects", "git": {"directory": root.path().join(".git"), "tree": tree}, "scope": ["../x"]});
    assert!(Context::new("t", request(escaping)).is_err());
}

#[test]
fn a_nested_project_is_the_root_extractors_see() {
    let (root, tree) = repository();
    let repository = json!({"mode": "git-objects", "git": {"directory": root.path().join(".git"), "tree": tree},
        "project": "src", "scope": ["a.txt", "src"]});
    let cx = Context::new("t", request(repository)).unwrap();
    assert_eq!(cx.project(), "src");
    assert_eq!(cx.files().unwrap(), ["b.json"]);
    assert_eq!(cx.repository_files().unwrap(), ["a.txt", "src/b.json"]);
    assert_eq!(cx.read_json("b.json").unwrap()["b"], 1);
    // A scope that includes it lets the project read outside itself, but never outside the repository.
    assert_eq!(cx.read_source("../a.txt").unwrap(), "alpha");
    assert!(cx.exists(".").unwrap() && cx.exists("../a.txt").unwrap());
    assert!(
        cx.read_source("../../a.txt")
            .unwrap_err()
            .to_string()
            .contains("stay within the repository")
    );
    let outside = cx.read_source("../.gitignore").unwrap_err().to_string();
    assert!(outside.contains("outside its declared scope"), "{outside}");
    let on_disk = Context::new("t", request(json!({"mode": "in-place", "root": root.path(), "project": "src"}))).unwrap();
    assert_eq!(
        on_disk.root(),
        projections_extractor_sdk::canonical(&root.path().join("src")).unwrap()
    );
    assert_eq!(
        on_disk.repository_root().unwrap(),
        projections_extractor_sdk::canonical(root.path()).unwrap()
    );
    for project in ["../x", "src/", "/src", "./src"] {
        let request = request(json!({"mode": "in-place", "root": root.path(), "project": project}));
        assert!(Context::new("t", request).is_err(), "{project}");
    }
}

#[test]
fn a_checkout_in_place_is_what_git_lists_and_ignored_files_are_refused() {
    let (root, _) = repository();
    fs::write(root.path().join("untracked.txt"), "new").unwrap();
    fs::remove_file(root.path().join("src/b.json")).unwrap();
    let cx = Context::new("t", request(json!({"mode": "in-place", "root": root.path()}))).unwrap();
    assert_eq!(cx.files().unwrap(), [".gitignore", "a.txt", "untracked.txt"]);
    assert_eq!(cx.read_source("untracked.txt").unwrap(), "new");
    let ignored = cx.read_source("ignored.log").unwrap_err().to_string();
    assert!(ignored.contains("Git ignores it"), "{ignored}");
}

#[test]
fn a_materialization_is_every_file_under_its_root() {
    let (root, _) = repository();
    let cx = Context::new("t", request(json!({"mode": "materialized", "root": root.path().join("src")}))).unwrap();
    assert_eq!(cx.files().unwrap(), ["b.json"]);
    assert_eq!(cx.read_json("b.json").unwrap()["b"], 1);
}

#[test]
fn a_declared_input_the_revision_lacks_is_recorded_as_missing_however_it_is_read() {
    let (root, tree) = repository();
    let from_objects = objects(root.path(), &tree, None);
    let in_place = Context::new("t", request(json!({"mode": "in-place", "root": root.path()}))).unwrap();
    let materialized = Context::new("t", request(json!({"mode": "materialized", "root": root.path()}))).unwrap();
    for cx in [&from_objects, &in_place, &materialized] {
        assert!(cx.exists("a.txt").unwrap());
        assert!(cx.exists("./src/").unwrap());
        assert!(cx.input_exists("src/b.json").unwrap());
        assert!(!cx.input_exists("packages/api/schema.prisma").unwrap());
        assert!(!cx.input_exists("./deploy/").unwrap());
        cx.missing_input("deploy/*.yaml");
        assert_eq!(cx.missing_inputs(), ["deploy", "deploy/*.yaml", "packages/api/schema.prisma"]);
        let finished = cx.finish(json!({"entities": []}));
        assert_eq!(
            finished["missingInputs"],
            json!(["deploy", "deploy/*.yaml", "packages/api/schema.prisma"])
        );
        assert!(cx.exists("../outside").is_err());
    }
    // Outside a declared scope is an error, not absence.
    let scoped = objects(root.path(), &tree, Some(json!(["src"])));
    assert!(!scoped.input_exists("src/missing.json").unwrap());
    assert!(
        scoped
            .input_exists("a.txt")
            .unwrap_err()
            .to_string()
            .contains("outside its declared scope")
    );
    // Git ignores it, so it isn't part of the checkout's revision.
    assert!(!in_place.exists("ignored.log").unwrap());
    // Nothing missing adds nothing.
    let clean = Context::new("t", request(json!({"mode": "in-place", "root": root.path()}))).unwrap();
    assert_eq!(clean.finish(json!({"entities": []})), json!({"entities": []}));
}
