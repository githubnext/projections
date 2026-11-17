use projections_cli::{
    artifact,
    runtime::{DefinitionChoice, Runner},
};
use serde_json::{Value, json};
use std::{
    fs,
    path::Path,
    process::{Command, Output},
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false"])
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8(output.stdout).unwrap().trim().into()
}

fn fixture() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "--template=", "--quiet"]);
    git(root.path(), &["config", "user.name", "Native fixture"]);
    git(root.path(), &["config", "user.email", "native@example.invalid"]);
    fs::write(root.path().join("file.txt"), "first").unwrap();
    commit(root.path());
    root
}

fn commit(root: &Path) -> String {
    git(root, &["add", "--all"]);
    git(root, &["commit", "--quiet", "-m", "fixture"]);
    git(root, &["rev-parse", "HEAD"])
}

fn state(label: &str) -> Value {
    json!({"protocolVersion":0,"schema":"graph/v0","entities":[{"id":"one","kind":"item","label":label}],"relationships":[]})
}

fn definition(root: &Path, id: &str, command: Vec<String>) {
    fs::create_dir_all(root.join(".projections")).unwrap();
    fs::write(
        root.join(format!(".projections/{id}.json")),
        serde_json::to_vec(&json!({"id":id,"extractor":{"command":command},"renderer":"graph"})).unwrap(),
    )
    .unwrap();
}

/// A PATH with Git but no Node: a directory holding only a `git` symlink on Unix, and
/// on Windows the directory of `git.exe` (Git for Windows' `cmd`), which has no Node.
struct NoNode(#[allow(dead_code)] tempfile::TempDir, std::path::PathBuf);

impl NoNode {
    fn path(&self) -> &Path {
        &self.1
    }
}

fn no_node_path() -> NoNode {
    let directory = tempfile::tempdir().unwrap();
    let git = std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|root| root.join(if cfg!(windows) { "git.exe" } else { "git" }))
        .find(|file| file.is_file())
        .unwrap()
        .canonicalize()
        .unwrap();
    #[cfg(unix)]
    let path = {
        std::os::unix::fs::symlink(git, directory.path().join("git")).unwrap();
        directory.path().to_owned()
    };
    #[cfg(not(unix))]
    let path = git.parent().unwrap().to_owned();
    assert!(!path.join("node").exists() && !path.join("node.exe").exists());
    NoNode(directory, path)
}

fn cli(root: &Path, path: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_projections"))
        .args(args)
        .current_dir(root)
        .env_clear()
        .env("PATH", path)
        .env("LANG", "C.UTF-8")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .unwrap()
}

fn document(output: Output) -> Value {
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn clap_commands_and_native_collection_do_not_require_node() {
    let repo = fixture();
    let path = no_node_path();
    let help = cli(repo.path(), path.path(), &["--help"]);
    assert!(help.status.success());
    assert!(String::from_utf8_lossy(&help.stdout).contains("how a change reshapes them"));
    let catalog = document(cli(repo.path(), path.path(), &["extractor", "list", "--json"]));
    assert_eq!(
        catalog["extractors"].as_array().unwrap().len(),
        projections_extractor_catalog::IDS.len()
    );
    assert!(
        cli(repo.path(), path.path(), &["init", "files", "--extractor", "repository-map"])
            .status
            .success()
    );
    let first = document(cli(repo.path(), path.path(), &["show", "-p", "files", "--json"]));
    assert_eq!(first["format"], "projections.extraction");
    assert!(
        first["extraction"]["entities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|node| node["label"] == "file.txt")
    );
    let before = commit(repo.path());
    fs::write(repo.path().join("added.txt"), "after").unwrap();
    let after = commit(repo.path());
    let comparison = document(cli(
        repo.path(),
        path.path(),
        &["compare", &format!("{before}..{after}"), "-p", "files", "--json"],
    ));
    assert!(
        comparison["comparison"]["changes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|change| change["status"] == "added")
    );
    assert_eq!(comparison["comparator"]["id"], "default");
    assert_eq!(document(cli(repo.path(), path.path(), &["show", "--all", "--json"]))["failed"], 0);
    let snapshot = repo.path().join("snapshot.json");
    fs::write(&snapshot, serde_json::to_vec(&first).unwrap()).unwrap();
    assert_eq!(
        document(cli(repo.path(), path.path(), &["validate", "snapshot.json", "--json"]))["valid"],
        true
    );
    assert_eq!(
        document(cli(
            repo.path(),
            path.path(),
            &[
                "compare",
                "--before-extraction",
                "snapshot.json",
                "--after-extraction",
                "snapshot.json",
                "--json"
            ]
        ))["comparison"]["changes"],
        json!([])
    );
    assert!(
        !cli(
            repo.path(),
            path.path(),
            &[
                "compare",
                "--before-extraction",
                "snapshot.json",
                "--after-extraction",
                "snapshot.json",
                "--trust"
            ]
        )
        .status
        .success()
    );
    assert!(
        !cli(repo.path(), path.path(), &["pr", "1", "-R", "example/tiny", "--trust"])
            .status
            .success()
    );
}

#[test]
#[cfg_attr(windows, ignore = "Runs a /bin/sh extractor")]
fn native_argv_trust_preflight_is_for_both_revisions() {
    let root = fixture();
    let marker = root.path().join("must-not-run");
    let encoded = serde_json::to_string(&state("old")).unwrap();
    definition(
        root.path(),
        "service",
        vec![
            "/bin/sh".into(),
            "-c".into(),
            format!("printf '%s' '{}'; printf ran > '{}'", encoded, marker.display()),
        ],
    );
    let before = commit(root.path());
    fs::write(
        root.path().join(".projections/service.json"),
        serde_json::to_vec(&json!({"id":"service","extractor":"repository-map","renderer":"file-packing"})).unwrap(),
    )
    .unwrap();
    let after = commit(root.path());
    assert!(
        Runner::new(root.path().into(), false)
            .with_executable(env!("CARGO_BIN_EXE_projections"))
            .compare("service", &before, &after)
            .unwrap_err()
            .to_string()
            .contains("BOTH")
    );
    assert!(!marker.exists());
    assert_eq!(
        Runner::new(root.path().into(), true)
            .with_executable(env!("CARGO_BIN_EXE_projections"))
            .show("service", &before, None)
            .unwrap()["extraction"]["entities"][0]["label"],
        "old"
    );
    assert!(marker.exists());
}

#[test]
#[cfg_attr(windows, ignore = "Runs /bin/sh process trees; tests/windows.rs covers Job Object supervision")]
fn failed_process_retains_bounded_raw_output_and_deadline_cleans_descendants() {
    let root = fixture();
    let runner = Runner::new(root.path().into(), true).with_executable(env!("CARGO_BIN_EXE_projections"));
    let env = runner.environment(&[]).unwrap();
    let failed = runner
        .run_argv(
            &[
                "/bin/sh".into(),
                "-c".into(),
                "printf partial; printf diagnostic >&2; exit 7".into(),
            ],
            root.path(),
            None,
            1000,
            &env,
        )
        .unwrap_err();
    assert!(failed.to_string().contains("diagnostic"));
    let outputs = runner.outputs.lock().unwrap();
    assert_eq!(outputs[0]["stdout"], "partial");
    assert_eq!(outputs[0]["stderr"], "diagnostic");
    drop(outputs);
    let marker = root.path().join("late");
    let start = Instant::now();
    assert!(
        runner
            .run_argv(
                &[
                    "/bin/sh".into(),
                    "-c".into(),
                    format!("( /bin/sleep 1; printf leaked > '{}' ) & /bin/sleep 5", marker.display())
                ],
                root.path(),
                None,
                40,
                &env
            )
            .unwrap_err()
            .to_string()
            .contains("timed out")
    );
    assert!(start.elapsed() < Duration::from_secs(1));
    std::thread::sleep(Duration::from_millis(1200));
    assert!(!marker.exists());
    let cancelled = runner.clone();
    cancelled.cancel.store(true, Ordering::SeqCst);
    assert!(
        cancelled
            .run_argv(&["/bin/sh".into()], root.path(), None, 1000, &env)
            .unwrap_err()
            .to_string()
            .contains("cancelled")
    );
}

#[test]
#[cfg_attr(windows, ignore = "Runs /bin/sh and /usr/bin/head; tests/windows.rs covers the output bound")]
fn output_limit_cannot_race_a_successful_fast_exit() {
    let root = fixture();
    let runner = Runner::new(root.path().into(), true).with_executable(env!("CARGO_BIN_EXE_projections"));
    let error = runner
        .run_argv(
            &["/bin/sh".into(), "-c".into(), "/usr/bin/head -c 9000000 /dev/zero".into()],
            root.path(),
            None,
            5000,
            &runner.environment(&[]).unwrap(),
        )
        .unwrap_err();
    assert!(error.to_string().contains("exceeded"), "{error:#}");
    let output = runner.outputs.lock().unwrap();
    assert!(output[0]["stdout"].as_str().unwrap().len() <= 8 * 1024 * 1024);
}

#[test]
fn bookmarks_normalize_defaults_and_batches_retain_unknown_ids() {
    let root = fixture();
    let revision = git(root.path(), &["rev-parse", "HEAD"]);
    fs::write(
        root.path().join(".projections-bookmarks.json"),
        serde_json::to_vec(&json!({"format":"projections.bookmarks","version":0,"bookmarks":[
            {"id":"scenario","title":"Native scenario","projectionId":"repository-map","before":revision}
        ]}))
        .unwrap(),
    )
    .unwrap();
    let runner = Runner::new(root.path().into(), false).with_executable(env!("CARGO_BIN_EXE_projections"));
    assert_eq!(runner.bookmarks("working-tree").unwrap()["bookmarks"][0]["after"], "working-tree");
    let batch = runner
        .show_all("working-tree", &["repository-map".into(), "missing".into()])
        .unwrap();
    assert_eq!(batch["failed"], 1);
    assert!(
        batch["results"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["status"] == "extracted")
    );
    let bookmark = runner.compare_bookmarks("working-tree", &[], &DefinitionChoice::Default).unwrap();
    assert_eq!(bookmark["failed"], 0);
}

#[test]
fn bookmarks_saved_before_their_projection_was_written_compare_with_the_working_tree_definition() {
    let root = fixture();
    let path = no_node_path();
    let repo = root.path();
    let a = git(repo, &["rev-parse", "HEAD"]);
    fs::write(repo.join("more.txt"), "second").unwrap();
    let b = commit(repo);
    // A projection authored after both of the bookmark's revisions, not yet committed.
    fs::create_dir_all(repo.join(".projections")).unwrap();
    fs::write(
        repo.join(".projections/late.json"),
        serde_json::to_vec(&json!({"id":"late","extractor":"repository-map","renderer":"file-packing"})).unwrap(),
    )
    .unwrap();
    fs::write(
        repo.join(".projections-bookmarks.json"),
        serde_json::to_vec(&json!({"format":"projections.bookmarks","version":0,"bookmarks":[
            {"id":"earlier","title":"Earlier","projectionId":"late","before":a,"after":b}
        ]}))
        .unwrap(),
    )
    .unwrap();

    let (ok, stdout, stderr) = run(repo, path.path(), &["bookmark", "run", "--json"]);
    assert!(ok, "{stdout}\n{stderr}");
    let batch: Value = serde_json::from_str(&stdout).unwrap();
    let result = &batch["results"][0];
    assert_eq!(result["status"], "changed", "{result}");
    assert!(
        result["notices"][0].as_str().unwrap().contains(
            "Neither revision of bookmark earlier defines projection late, so both were extracted with the working tree's definition"
        ),
        "{result}"
    );
    let (ok, stdout, stderr) = run(
        repo,
        path.path(),
        &["bookmark", "run", "--definition-revision", "working-tree", "--json"],
    );
    assert!(ok, "{stdout}\n{stderr}");

    // Naming a side that doesn't define it fails, suggesting what would work.
    let (ok, stdout, _) = run(repo, path.path(), &["bookmark", "run", "--definition", "base", "--json"]);
    assert!(!ok);
    let message = first_document(&stdout)["results"][0]["diagnostics"][0]["message"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(message.contains("--definition-revision working-tree"), "{message}");
    assert!(!message.contains("--definition head"), "{message}");
    let range = format!("{a}..{b}");
    let (ok, _, stderr) = run(repo, path.path(), &["compare", &range, "-p", "late"]);
    assert!(
        !ok && stderr.contains("not defined at the base or the head revision")
            && stderr.contains("--definition-revision working-tree")
            && !stderr.contains("--definition head"),
        "{stderr}"
    );
    let (ok, _, stderr) = run(
        repo,
        path.path(),
        &["compare", &range, "-p", "late", "--definition-revision", "working-tree", "--json"],
    );
    assert!(ok, "{stderr}");
}

#[test]
fn deleted_directories_and_symlink_source_roots_are_handled_explicitly() {
    let root = fixture();
    fs::create_dir(root.path().join("removed")).unwrap();
    fs::write(root.path().join("removed/file"), "old").unwrap();
    commit(root.path());
    fs::remove_file(root.path().join("removed/file")).unwrap();
    fs::remove_dir(root.path().join("removed")).unwrap();
    assert!(
        Runner::new(root.path().into(), false)
            .with_executable(env!("CARGO_BIN_EXE_projections"))
            .show("repository-map", "working-tree", None)
            .is_ok()
    );
    #[cfg(unix)]
    {
        // Read in place, an escaping symlink is listed as what it is and never
        // followed; only a materialization would have to refuse to write it.
        std::os::unix::fs::symlink("/etc/passwd", root.path().join("escape")).unwrap();
        let document = Runner::new(root.path().into(), false)
            .with_executable(env!("CARGO_BIN_EXE_projections"))
            .show("repository-map", "working-tree", None)
            .unwrap();
        let escape = document["extraction"]["entities"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entity| entity["id"] == "file:escape")
            .unwrap();
        assert_eq!(escape["kind"], "symlink");
        assert_eq!(escape["data"]["size"], "/etc/passwd".len());
    }
}

#[test]
#[cfg_attr(windows, ignore = "Runs a /bin/sh extractor; tests/windows.rs covers export and validation")]
fn custom_native_workflow_exports_and_validates_without_node() {
    let root = fixture();
    let path = no_node_path();
    let raw = serde_json::to_string(&state("native")).unwrap();
    definition(
        root.path(),
        "custom",
        vec!["/bin/sh".into(), "-c".into(), format!("printf '%s' '{raw}'")],
    );
    let revision = commit(root.path());
    assert!(!cli(root.path(), path.path(), &["show", "-p", "custom"]).status.success());
    let output = cli(
        root.path(),
        path.path(),
        &[
            "show",
            &revision,
            "-p",
            "custom",
            "--trust",
            "--output",
            "snapshot with spaces.json",
        ],
    );
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    assert!(output.stdout.is_empty());
    let saved = fs::read_to_string(root.path().join("snapshot with spaces.json")).unwrap();
    assert!(
        saved.starts_with("{\n  \"") && saved.ends_with("\n}\n"),
        "a saved document is pretty-printed: {saved}"
    );
    let snapshot: Value = serde_json::from_str(&saved).unwrap();
    assert_eq!(snapshot["extraction"]["entities"][0]["label"], "native");
    assert_eq!(
        document(cli(root.path(), path.path(), &["validate", "snapshot with spaces.json", "--json"]))["format"],
        "projections.extraction"
    );
}

#[test]
fn artifacts_reject_duplicate_keys_and_no_overwrite_outputs() {
    assert!(artifact::parse(r#"{"a":1,"a":2}"#).is_err());
    let root = fixture();
    let path = no_node_path();
    let target = root.path().join("kept.json");
    fs::write(&target, b"preserve").unwrap();
    assert!(
        !cli(root.path(), path.path(), &["show", "-p", "repository-map", "--output", "kept.json"])
            .status
            .success()
    );
    assert_eq!(fs::read(target).unwrap(), b"preserve");
}

#[test]
#[cfg_attr(windows, ignore = "Uses /bin/sh gh and git stand-ins")]
fn native_pr_acquires_actual_immutable_git_objects_and_never_grants_trust() {
    let root = fixture();
    let marker = root.path().join("must-not-execute");
    fs::create_dir_all(root.path().join(".projections")).unwrap();
    fs::write(
        root.path().join(".projections/files.json"),
        serde_json::to_vec(&json!({"id":"files","extractor":"repository-map","renderer":"file-packing"})).unwrap(),
    )
    .unwrap();
    definition(
        root.path(),
        "custom",
        vec!["/bin/sh".into(), "-c".into(), format!("printf ran > '{}'", marker.display())],
    );
    let before = commit(root.path());
    fs::write(root.path().join("new.txt"), "actual PR change").unwrap();
    let after = commit(root.path());
    let tools = tempfile::tempdir().unwrap();
    let actual_git = std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|root| root.join("git"))
        .find(|file| file.is_file())
        .unwrap()
        .canonicalize()
        .unwrap();
    let git_core = String::from_utf8(Command::new(&actual_git).arg("--exec-path").output().unwrap().stdout).unwrap();
    assert!(!Path::new(git_core.trim()).join("node").exists());
    let metadata = json!({"html_url":"https://github.com/example/tiny/pull/11","base":{"sha":before,"repo":{"id":1,"full_name":"example/tiny"}},"head":{"sha":after,"repo":{"id":2,"full_name":"example/fork"}}});
    let receipt = tools.path().join("fetch-argv");
    let gh = tools.path().join("gh");
    let git = tools.path().join("git");
    fs::write(&gh, format!("#!/bin/sh\n[ \"$1\" = api ] || exit 2\nprintf '%s' '{}'\n", metadata)).unwrap();
    fs::write(&git,format!("#!/bin/sh\nfor argument in \"$@\"; do\nif [ \"$argument\" = fetch ]; then\nprintf '%s\\0' \"$@\" > '{}'\nexec '{}' --git-dir \"$PWD\" -c protocol.file.allow=always fetch --quiet --no-auto-maintenance '{}' '{}:refs/projections/base' '{}:refs/projections/head'\nfi\ndone\nexec '{}' \"$@\"\n",receipt.display(),actual_git.display(),root.path().display(),before,after,actual_git.display())).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for file in [&git, &gh] {
            fs::set_permissions(file, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    let output = Command::new(env!("CARGO_BIN_EXE_projections"))
        .args(["pr", "11", "-R", "example/tiny", "--json", "--id", "files", "--id", "custom"])
        .current_dir(root.path())
        .env_clear()
        .env("PATH", std::env::join_paths([tools.path(), Path::new(git_core.trim())]).unwrap())
        .env("GH_TOKEN", "offline-native-pr-proof-not-a-credential")
        .output()
        .unwrap();
    assert!(!output.status.success(), "Per-item trust failure must set unsuccessful exit");
    let review = first_document(&String::from_utf8_lossy(&output.stdout));
    assert_eq!(review["execution"], "untrusted");
    assert_eq!(review["mergeBase"], before);
    assert_eq!(review["head"], after);
    assert_eq!(review["fork"], true);
    assert_eq!(review["comparisons"]["failed"], 1);
    assert!(!marker.exists());
    assert!(
        review["comparisons"]["results"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == "files" && item["status"] == "changed")
    );
    let args = String::from_utf8(fs::read(receipt).unwrap()).unwrap();
    assert!(args.contains("protocol.file.allow=never\0"));
    assert!(args.contains("protocol.ext.allow=never\0"));
    assert!(args.contains("https://github.com/example/tiny.git\0"));
    assert!(args.contains("credential.helper=!gh auth git-credential\0"));
}

#[cfg(unix)]
#[test]
fn sigterm_cancels_the_native_cli_and_reaps_its_collector() {
    let root = fixture();
    let marker = root.path().join("collector-pid");
    definition(root.path(), "slow", vec!["/bin/sh".into(), "wait.sh".into()]);
    // Written aside and renamed, so the marker never exists empty.
    fs::write(
        root.path().join("wait.sh"),
        format!(
            "printf '%s' $$ > '{marker}.partial'\nmv '{marker}.partial' '{marker}'\nexec /bin/sleep 30\n",
            marker = marker.display()
        ),
    )
    .unwrap();
    commit(root.path());
    let mut child = Command::new(env!("CARGO_BIN_EXE_projections"))
        .args(["show", "-p", "slow", "--trust"])
        .current_dir(root.path())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let start = Instant::now();
    while !marker.exists() && start.elapsed() < Duration::from_secs(5) {
        assert!(child.try_wait().unwrap().is_none(), "CLI exited before collector readiness");
        std::thread::sleep(Duration::from_millis(5));
    }
    if !marker.exists() {
        child.kill().unwrap();
        child.wait().unwrap();
        panic!("Collector startup deadline");
    }
    let collector: i32 = fs::read_to_string(marker).unwrap().parse().unwrap();
    assert_eq!(unsafe { libc::kill(child.id() as i32, libc::SIGTERM) }, 0);
    let stop = Instant::now();
    while child.try_wait().unwrap().is_none() && stop.elapsed() < Duration::from_secs(3) {
        std::thread::sleep(Duration::from_millis(5));
    }
    if child.try_wait().unwrap().is_none() {
        child.kill().unwrap();
    }
    let output = child.wait_with_output().unwrap();
    let remaining = unsafe { libc::kill(collector, 0) } == 0;
    if remaining {
        unsafe { libc::kill(collector, libc::SIGKILL) };
    }
    assert!(!remaining, "Collector survived native CLI SIGTERM");
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("cancelled"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!output.status.success());
}

/// The document a failed `--json` command printed: its own, with the failed
/// items, and no second error document.
fn first_document(stdout: &str) -> Value {
    serde_json::from_str(stdout).unwrap()
}

fn run(root: &Path, path: &Path, args: &[&str]) -> (bool, String, String) {
    let output = cli(root, path, args);
    (
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

#[test]
#[cfg_attr(windows, ignore = "Runs a /bin/sh extractor")]
fn v2_show_compare_definition_source_and_comparators() {
    let root = fixture();
    let path = no_node_path();
    let repo = root.path();
    // The extractor reads the examined revision through request.repository.root.
    let script = "root=$(/usr/bin/sed -n 's/.*\"root\":\"\\([^\"]*\\)\".*/\\1/p')\n/bin/cat \"$root/state.json\"\n";
    fs::write(repo.join("extract.sh"), script).unwrap();
    fs::create_dir_all(repo.join("tools")).unwrap();
    fs::copy(
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../examples/comparators/priority-order/priority-order.comparator.yaml"
        ),
        repo.join("tools/order.comparator.yaml"),
    )
    .unwrap();
    fs::create_dir_all(repo.join(".projections")).unwrap();
    fs::write(
        repo.join(".projections/svc.json"),
        serde_json::to_vec(&json!({"id":"svc","title":"Services","renderer":"graph",
            "extractor":{"command":["/bin/sh","extract.sh"],"sources":["extract.sh"]},
            "comparator":{"file":"tools/order.comparator.yaml","options":{"priority":["two"]}}}))
        .unwrap(),
    )
    .unwrap();
    fs::write(repo.join("state.json"), serde_json::to_vec(&state("first")).unwrap()).unwrap();
    let a = commit(repo);
    let mut next = state("first");
    next["entities"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"two","kind":"item","label":"Second"}));
    next["relationships"] = json!([{"id":"one-two","kind":"uses","from":"one","to":"two"}]);
    fs::write(repo.join("state.json"), serde_json::to_vec(&next).unwrap()).unwrap();
    fs::write(repo.join("extract.sh"), format!("# revised\n{script}")).unwrap();
    let b = commit(repo);
    fs::write(
        repo.join(".projections/late.json"),
        serde_json::to_vec(&json!({"id":"late","extractor":"repository-map","renderer":"file-packing"})).unwrap(),
    )
    .unwrap();
    let c = commit(repo);
    let range = format!("{a}..{b}");

    let (ok, stdout, stderr) = run(repo, path.path(), &["compare", &range, "-p", "svc", "--trust", "--json"]);
    assert!(ok, "{stderr}");
    let comparison: Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(comparison["comparator"]["id"], "tools/order.comparator.yaml");
    assert_eq!(
        comparison["before"]["provenance"]["definitionDigest"],
        comparison["after"]["provenance"]["definitionDigest"]
    );
    assert!(stderr.contains("changes the component code of projection `svc`"), "{stderr}");
    assert!(stderr.contains("--definition head"), "{stderr}");
    let (ok, text, stderr) = run(repo, path.path(), &["compare", &range, "-p", "svc", "--trust"]);
    assert!(ok, "{stderr}");
    for expected in [
        "Services (projection svc)",
        &format!("Comparing commit {} with commit {}.", &a[..12], &b[..12]),
        "Comparator: tools/order.comparator.yaml.",
        "Note: The head revision changes the component code",
        "Step 1 of",
        "Added entity Second [two]",
        "Added relationship first [one] uses Second [two]",
    ] {
        assert!(text.contains(expected), "missing {expected:?} in\n{text}");
    }
    let (ok, _, stderr) = run(
        repo,
        path.path(),
        &["compare", &range, "-p", "svc", "--definition", "head", "--json", "--trust"],
    );
    assert!(ok, "{stderr}");
    let (ok, _, stderr) = run(repo, path.path(), &["compare", &range, "-p", "svc"]);
    assert!(!ok && stderr.contains("--trust"), "{stderr}");

    let (ok, text, stderr) = run(repo, path.path(), &["show", &b, "-p", "svc", "--trust"]);
    assert!(ok, "{stderr}");
    assert!(text.contains(&format!("Showing commit {}.", &b[..12])), "{text}");
    assert!(
        text.contains("item (2):\n  first [one]\n    uses Second [two]\n  Second [two]"),
        "{text}"
    );
    let (ok, stdout, _) = run(repo, path.path(), &["show", "-p", "svc", "--trust", "--json"]);
    assert!(ok);
    assert_eq!(
        serde_json::from_str::<Value>(&stdout).unwrap()["provenance"]["revision"]["kind"],
        "working-tree"
    );

    let late = format!("{b}..{c}");
    let (ok, _, stderr) = run(repo, path.path(), &["compare", &late, "-p", "late"]);
    assert!(
        !ok && stderr.contains("not defined at the base revision") && stderr.contains("--definition head"),
        "{stderr}"
    );
    let (ok, _, stderr) = run(
        repo,
        path.path(),
        &["compare", &late, "-p", "late", "--definition", "head", "--json"],
    );
    assert!(ok, "{stderr}");
    let (ok, stdout, _) = run(repo, path.path(), &["compare", &late, "--all", "--json"]);
    assert!(!ok);
    let batch = first_document(&stdout);
    let late_result = batch["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == "late")
        .unwrap();
    assert_eq!(late_result["status"], "head-only");
    assert_eq!(late_result["extraction"]["projection"]["id"], "late");
    let svc = batch["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == "svc")
        .unwrap();
    assert_eq!(svc["status"], "error");
    assert_eq!(svc["diagnostics"][0]["code"], "TRUST_REQUIRED");
    assert_eq!(svc["definition"]["id"], "svc");

    let (ok, stdout, stderr) = run(repo, path.path(), &["list", "--json"]);
    assert!(ok, "{stderr}");
    let list: Value = serde_json::from_str(&stdout).unwrap();
    let trust: Vec<_> = list["projections"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| (item["id"].as_str().unwrap().to_owned(), item["requiresTrust"].as_bool().unwrap()))
        .collect();
    assert_eq!(trust, vec![("late".to_owned(), false), ("svc".to_owned(), true)]);

    // Saved extractions compare with the comparator file supplied explicitly.
    let (ok, _, stderr) = run(repo, path.path(), &["show", &a, "-p", "svc", "--trust", "--output", "a.json"]);
    assert!(ok, "{stderr}");
    let (ok, _, stderr) = run(repo, path.path(), &["show", &a, "-p", "svc", "--trust", "--output", "a2.json"]);
    assert!(ok, "{stderr}");
    let (ok, _, stderr) = run(
        repo,
        path.path(),
        &["compare", "--before-extraction", "a.json", "--after-extraction", "a2.json"],
    );
    assert!(!ok && stderr.contains("--comparator"), "{stderr}");
    let (ok, text, stderr) = run(
        repo,
        path.path(),
        &[
            "compare",
            "--before-extraction",
            "a.json",
            "--after-extraction",
            "a2.json",
            "--comparator",
            "tools/order.comparator.yaml",
        ],
    );
    assert!(ok && text.contains("No changes."), "{stderr}");

    // An extraction of b with a's definition pairs with a's own extraction.
    let (ok, _, stderr) = run(
        repo,
        path.path(),
        &[
            "show",
            &b,
            "-p",
            "svc",
            "--definition-revision",
            &a,
            "--trust",
            "--output",
            "b.json",
        ],
    );
    assert!(ok, "{stderr}");
    let (ok, text, stderr) = run(
        repo,
        path.path(),
        &[
            "compare",
            "--before-extraction",
            "a.json",
            "--after-extraction",
            "b.json",
            "--comparator",
            "tools/order.comparator.yaml",
        ],
    );
    assert!(ok && text.contains("Added entity Second [two]"), "{stderr}");
    let (ok, _, stderr) = run(repo, path.path(), &["show", &b, "-p", "svc", "--trust", "--output", "b-own.json"]);
    assert!(ok, "{stderr}");
    let (ok, _, stderr) = run(
        repo,
        path.path(),
        &[
            "compare",
            "--before-extraction",
            "a.json",
            "--after-extraction",
            "b-own.json",
            "--comparator",
            "tools/order.comparator.yaml",
        ],
    );
    assert!(!ok && stderr.contains("declared component sources differ"), "{stderr}");

    // A comparator's diagnostics name the file loaded, not the definition's.
    fs::write(
        repo.join("probe.comparator.yaml"),
        "format: projections.comparator\nversion: 0\nclassify: [\n",
    )
    .unwrap();
    let (ok, _, stderr) = run(
        repo,
        path.path(),
        &[
            "compare",
            "--before-extraction",
            "a.json",
            "--after-extraction",
            "a2.json",
            "--comparator",
            "probe.comparator.yaml",
        ],
    );
    assert!(
        !ok && stderr.contains("probe.comparator.yaml") && !stderr.contains("tools/order"),
        "{stderr}"
    );

    // Extractor output, and a saved extraction edited by hand, compare with -p ID.
    let saved: Value = serde_json::from_str(&fs::read_to_string(repo.join("a.json")).unwrap()).unwrap();
    let mut raw = saved["extraction"].clone();
    raw["protocolVersion"] = json!(0);
    fs::write(repo.join("raw-a.json"), serde_json::to_vec(&raw).unwrap()).unwrap();
    let mut edited = saved.clone();
    edited["extraction"]["entities"][0]["label"] = json!("Edited by hand");
    fs::write(repo.join("edited.json"), serde_json::to_vec(&edited).unwrap()).unwrap();
    let (ok, _, stderr) = run(
        repo,
        path.path(),
        &["compare", "--before-extraction", "raw-a.json", "--after-extraction", "edited.json"],
    );
    assert!(!ok && stderr.contains("-p ID"), "{stderr}");
    let (ok, text, stderr) = run(
        repo,
        path.path(),
        &[
            "compare",
            "--before-extraction",
            "raw-a.json",
            "--after-extraction",
            "edited.json",
            "-p",
            "svc",
        ],
    );
    assert!(ok && text.contains("Edited by hand"), "{text}{stderr}");
}

fn renderer(repo: &Path, html: &str) {
    fs::create_dir_all(repo.join("ui")).unwrap();
    fs::write(
        repo.join("ui/renderer.json"),
        r#"{"format":"projections.renderer","version":0,"name":"flags","title":"Flags","handles":[]}"#,
    )
    .unwrap();
    fs::write(repo.join("ui/index.html"), html).unwrap();
}

#[test]
fn renderer_trust_and_comparison_notices() {
    let root = fixture();
    let path = no_node_path();
    let repo = root.path();
    renderer(repo, "<!doctype html><p>base</p>");
    fs::create_dir_all(repo.join(".projections")).unwrap();
    fs::write(
        repo.join(".projections/ui.json"),
        serde_json::to_vec(&json!({"id":"ui","extractor":"repository-map","renderer":{"bundle":"ui"}})).unwrap(),
    )
    .unwrap();
    let a = commit(repo);
    renderer(repo, "<!doctype html><p>head</p>");
    fs::write(
        repo.join(".projections/late.json"),
        serde_json::to_vec(&json!({"id":"late","extractor":"repository-map","renderer":"file-packing"})).unwrap(),
    )
    .unwrap();
    let b = commit(repo);

    // Comparison documents carry their notices; text output keeps them too.
    let range = format!("{a}..{b}");
    let (ok, stdout, stderr) = run(
        repo,
        path.path(),
        &["compare", &range, "-p", "late", "--definition", "head", "--json"],
    );
    assert!(ok, "{stderr}");
    let document: Value = serde_json::from_str(&stdout).unwrap();
    let notice = document["notices"][0].as_str().unwrap();
    assert!(notice.contains("The base revision does not define projection `late`"), "{notice}");
    assert!(stderr.contains(&format!("projections: note: {notice}")), "{stderr}");
    let (ok, text, _) = run(repo, path.path(), &["compare", &range, "-p", "late", "--definition", "head"]);
    assert!(ok && text.contains(&format!("Note: {notice}")), "{text}");
    let (ok, stdout, _) = run(repo, path.path(), &["compare", &range, "-p", "ui", "--json"]);
    assert!(ok);
    assert!(serde_json::from_str::<Value>(&stdout).unwrap().get("notices").is_none());
    fs::write(repo.join("noticed.json"), document.to_string()).unwrap();
    let (ok, stdout, stderr) = run(repo, path.path(), &["validate", "noticed.json", "--json"]);
    assert!(ok && stdout.contains("projections.comparison"), "{stderr}");
    let validated = artifact::validate_comparison(&document).unwrap();
    assert_eq!(validated["notices"], document["notices"]);
    let mut tampered = document.clone();
    tampered["notices"] = json!([""]);
    assert!(artifact::validate_comparison(&tampered).is_err());
    tampered["notices"] = json!("note");
    assert!(artifact::validate_comparison(&tampered).is_err());

    // Renderers outside the checkout's history need trust, unless they match the merge base's.
    git(repo, &["checkout", "--quiet", "-b", "side", &a]);
    renderer(repo, "<!doctype html><p>side</p>");
    let side = commit(repo);
    fs::write(repo.join("side.txt"), "unrelated").unwrap();
    let same = {
        renderer(repo, "<!doctype html><p>base</p>");
        commit(repo)
    };
    git(repo, &["checkout", "--quiet", &b]);
    let policies = |revision: &str| -> Vec<(String, bool, bool)> {
        let (ok, stdout, stderr) = run(repo, path.path(), &["list", "--revision", revision, "--json"]);
        assert!(ok, "{stderr}");
        serde_json::from_str::<Value>(&stdout).unwrap()["projections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| {
                (
                    item["id"].as_str().unwrap().to_owned(),
                    item["requiresTrust"].as_bool().unwrap(),
                    item["rendererRequiresTrust"].as_bool().unwrap(),
                )
            })
            .collect()
    };
    assert_eq!(policies(&a), vec![("ui".into(), false, false)]);
    assert_eq!(policies("working-tree")[1], ("ui".into(), false, false));
    assert_eq!(policies(&side), vec![("ui".into(), false, true)]);
    assert_eq!(policies(&same), vec![("ui".into(), false, false)]);
    let (ok, text, _) = run(repo, path.path(), &["list", "--revision", &side]);
    assert!(ok && text.contains("requires --trust"), "{text}");
}

#[test]
fn workspace_dependencies_default_applies_only_with_a_root_package_manifest() {
    let root = fixture();
    let runner = Runner::new(root.path().into(), false).with_executable(env!("CARGO_BIN_EXE_projections"));
    let ids = |reference: &str| -> Vec<String> {
        runner.list(reference).unwrap()["projections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["id"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(ids("working-tree"), ["repository-map"]);
    let batch = runner.show_all("working-tree", &[]).unwrap();
    assert_eq!(batch["failed"], 0);
    fs::write(root.path().join("package.json"), r#"{"name":"fixture"}"#).unwrap();
    assert_eq!(ids("working-tree"), ["workspace-dependencies", "repository-map"]);
    let head = commit(root.path());
    assert_eq!(ids(&head), ["workspace-dependencies", "repository-map"]);
    let batch = runner.show_all("working-tree", &[]).unwrap();
    assert_eq!(batch["failed"], 0);
}

#[test]
fn presentation_defaults_pass_through_without_changing_the_definition_digest() {
    let root = fixture();
    let path = no_node_path();
    let repo = root.path();
    fs::create_dir_all(repo.join(".projections")).unwrap();
    let write = |presentation: Option<Value>| {
        let mut definition = json!({"id":"files","extractor":"repository-map","renderer":"file-packing"});
        if let Some(presentation) = presentation {
            definition["presentation"] = presentation;
        }
        fs::write(repo.join(".projections/files.json"), serde_json::to_vec(&definition).unwrap()).unwrap();
    };
    write(None);
    let a = commit(repo);
    let presentation = json!({"highlighting":"on","changesOnly":true,"mode":"side-by-side",
        "durationMs":4000,"rendererOptions":{"showFiles":false,"depth":2},
        "kinds":{"secret":{"color":"danger","noun":{"singular":"secret","plural":"secrets"}},"hidden":{"color":"teal"}}});
    write(Some(presentation.clone()));
    fs::write(repo.join("second.txt"), "second").unwrap();
    let b = commit(repo);

    let show = |revision: &str| {
        let (ok, stdout, stderr) = run(repo, path.path(), &["show", revision, "-p", "files", "--json"]);
        assert!(ok, "{stderr}");
        serde_json::from_str::<Value>(&stdout).unwrap()
    };
    let (before, after) = (show(&a), show(&b));
    assert_eq!(after["provenance"]["definition"]["presentation"], presentation);
    assert!(before["provenance"]["definition"].get("presentation").is_none());
    assert_eq!(
        before["provenance"]["definitionDigest"], after["provenance"]["definitionDigest"],
        "presentation is excluded from the definition digest"
    );
    // A presentation-only change neither blocks nor qualifies a comparison.
    let (ok, stdout, stderr) = run(
        repo,
        path.path(),
        &["compare", &format!("{a}..{b}"), "-p", "files", "--definition", "head", "--json"],
    );
    assert!(ok, "{stderr}");
    assert!(!stderr.contains("changes the definition"), "{stderr}");
    let comparison: Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(comparison["after"]["provenance"]["definition"]["presentation"], presentation);
    for invalid in [
        json!({"mode":"carousel"}),
        json!({"durationMs":100}),
        json!({"durationMs":1.5}),
        json!({"changesOnly":"yes"}),
        json!({"rendererOptions":{"bad id":true}}),
        json!({"rendererOptions":{"depth":[1]}}),
        json!({"kinds":{"secret":{"color":"#ff0000"}}}),
        json!({"kinds":{"secret":{"noun":{"singular":"secret"}}}}),
        json!({"kinds":{"secret":{"tone":"danger"}}}),
        json!({"speed":2}),
    ] {
        write(Some(invalid.clone()));
        let (ok, stdout, stderr) = run(repo, path.path(), &["list", "--json"]);
        assert!(
            !ok || stdout.contains("presentation") && stdout.contains("\"error\""),
            "{invalid} was accepted: {stdout}{stderr}"
        );
    }
    // Renderers that draw their own static comparison declare `diff`; a definition may choose it.
    write(Some(json!({"mode":"diff"})));
    let (ok, stdout, stderr) = run(repo, path.path(), &["list", "--json"]);
    assert!(ok && !stdout.contains("\"error\""), "mode diff was rejected: {stdout}{stderr}");
}

#[test]
fn submodules_are_skipped_with_limitations_and_notices_unless_explicitly_required() {
    let library = fixture();
    fs::write(library.path().join("inner.txt"), "inside the submodule").unwrap();
    commit(library.path());
    let root = fixture();
    let path = no_node_path();
    let repo = root.path();
    git(
        repo,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "--quiet",
            library.path().to_str().unwrap(),
            "vendor/lib",
        ],
    );
    fs::create_dir_all(repo.join(".projections")).unwrap();
    fs::write(
        repo.join(".projections/files.json"),
        r#"{"id":"files","extractor":"repository-map","renderer":"file-packing"}"#,
    )
    .unwrap();
    let a = commit(repo);
    fs::write(repo.join("second.txt"), "second").unwrap();
    let b = commit(repo);

    let show = |revision: &str| {
        let (ok, stdout, stderr) = run(repo, path.path(), &["show", revision, "-p", "files", "--json"]);
        assert!(ok, "{revision}: {stderr}");
        serde_json::from_str::<Value>(&stdout).unwrap()
    };
    // Both historical and working-tree captures skip the submodule, as git archive does.
    for revision in [a.as_str(), "working-tree"] {
        let document = show(revision);
        let ids: Vec<_> = document["extraction"]["entities"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entity| entity["id"].as_str().unwrap().to_owned())
            .collect();
        assert!(ids.iter().any(|id| id == "file:.gitmodules"), "{ids:?}");
        assert!(!ids.iter().any(|id| id.contains("vendor/lib")), "{ids:?}");
        let limitations = document["provenance"]["limitations"].to_string();
        assert!(
            limitations.contains("not materialized") && limitations.contains("vendor/lib"),
            "{limitations}"
        );
    }

    let (ok, stdout, stderr) = run(repo, path.path(), &["compare", &format!("{a}..{b}"), "-p", "files", "--json"]);
    assert!(ok, "{stderr}");
    let comparison: Value = serde_json::from_str(&stdout).unwrap();
    let notices = comparison["notices"].to_string();
    assert!(notices.contains("vendor/lib"), "{notices}");

    // A scope that excludes the submodule hears nothing about it.
    fs::write(
        repo.join(".projections/scoped.json"),
        r#"{"id":"scoped","extractor":"repository-map","renderer":"file-packing","execution":{"scope":["second.txt"]}}"#,
    )
    .unwrap();
    let (ok, stdout, stderr) = run(
        repo,
        path.path(),
        &[
            "compare",
            &format!("{a}..{b}"),
            "-p",
            "scoped",
            "--definition-revision",
            "working-tree",
            "--json",
        ],
    );
    assert!(ok, "{stderr}");
    let comparison: Value = serde_json::from_str(&stdout).unwrap();
    assert!(!comparison.to_string().contains("vendor/lib"), "{}", comparison["notices"]);

    // A projection that explicitly requires a path inside the submodule still fails.
    fs::write(
        repo.join(".projections/inside.json"),
        r#"{"id":"inside","renderer":"graph","extractor":{"command":["/bin/sh","vendor/lib/extract.sh"],"sources":["vendor/lib/extract.sh"]}}"#,
    )
    .unwrap();
    let c = commit(repo);
    let (ok, _, stderr) = run(repo, path.path(), &["show", &c, "-p", "inside", "--trust", "--json"]);
    assert!(!ok);
    assert!(stderr.contains("vendor/lib/extract.sh is inside vendor/lib"), "{stderr}");
}
