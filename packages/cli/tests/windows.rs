//! Windows equivalents of the POSIX supervision and native workflow tests: extractor
//! process trees run in a Job Object that is terminated on timeout, cancellation,
//! output overflow and abnormal CLI exit, and no-follow artifact reads work.
#![cfg(windows)]

use projections_cli::runtime::Runner;
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
        .args(["-c", "core.hooksPath=NUL", "-c", "commit.gpgsign=false"])
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "NUL")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8(output.stdout).unwrap().trim().into()
}

fn fixture() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "--template=", "--quiet"]);
    git(root.path(), &["config", "user.name", "Windows fixture"]);
    git(root.path(), &["config", "user.email", "windows@example.invalid"]);
    git(root.path(), &["config", "core.autocrlf", "false"]);
    fs::write(root.path().join("file.txt"), "first").unwrap();
    commit(root.path());
    root
}

fn commit(root: &Path) -> String {
    git(root, &["add", "--all"]);
    git(root, &["commit", "--quiet", "-m", "fixture"]);
    git(root, &["rev-parse", "HEAD"])
}

fn script(root: &Path, name: &str, body: &str) -> String {
    fs::write(root.join(name), body.replace('\n', "\r\n")).unwrap();
    name.to_owned()
}

fn cmd(script: &str) -> Vec<String> {
    vec!["cmd.exe".into(), "/d".into(), "/c".into(), script.into()]
}

/// A batch file that starts a detached descendant which writes `marker.txt` in the
/// fixture after a delay, then waits far longer than any test deadline.
fn tree(root: &Path) -> Vec<String> {
    descendant(root);
    cmd(&script(
        root,
        "tree.cmd",
        "@echo off\nstart \"\" /b cmd /d /c descendant.cmd\nping -n 30 127.0.0.1 >nul\n",
    ))
}

/// The marker path is absolute: extractors run in a disposable copy of the revision.
fn descendant(root: &Path) {
    script(
        root,
        "descendant.cmd",
        &format!(
            "@echo off\nping -n 4 127.0.0.1 >nul\necho leaked>\"{}\"\n",
            root.join("marker.txt").display()
        ),
    );
}

fn leaked(root: &Path) -> bool {
    std::thread::sleep(Duration::from_secs(5));
    root.join("marker.txt").exists()
}

#[test]
fn timeout_terminates_the_whole_process_tree() {
    let root = fixture();
    let runner = Runner::new(root.path().into(), true).with_executable(env!("CARGO_BIN_EXE_projections"));
    let env = runner.environment(&[]).unwrap();
    let start = Instant::now();
    let error = runner.run_argv(&tree(root.path()), root.path(), None, 1500, &env).unwrap_err();
    assert!(error.to_string().contains("timed out"), "{error:#}");
    assert!(start.elapsed() < Duration::from_secs(5));
    assert!(!leaked(root.path()), "A descendant outlived its Job Object");
}

#[test]
fn cancellation_terminates_the_whole_process_tree() {
    let root = fixture();
    let runner = Runner::new(root.path().into(), true).with_executable(env!("CARGO_BIN_EXE_projections"));
    let env = runner.environment(&[]).unwrap();
    let cancel = runner.cancel.clone();
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1000));
        cancel.store(true, Ordering::SeqCst);
    });
    let error = runner.run_argv(&tree(root.path()), root.path(), None, 60_000, &env).unwrap_err();
    canceller.join().unwrap();
    assert!(error.to_string().contains("cancelled"), "{error:#}");
    assert!(!leaked(root.path()));
    assert!(
        runner
            .run_argv(&cmd("exit"), root.path(), None, 1000, &env)
            .unwrap_err()
            .to_string()
            .contains("cancelled")
    );
}

#[test]
fn descendants_do_not_outlive_a_successful_leader() {
    let root = fixture();
    let runner = Runner::new(root.path().into(), true).with_executable(env!("CARGO_BIN_EXE_projections"));
    let env = runner.environment(&[]).unwrap();
    descendant(root.path());
    let started = cmd(&script(
        root.path(),
        "leader.cmd",
        "@echo off\nstart \"\" /b cmd /d /c descendant.cmd\n<nul set /p=done\nexit /b 0\n",
    ));
    let output = runner.run_argv(&started, root.path(), None, 10_000, &env).unwrap();
    assert_eq!(output.stdout, "done");
    assert!(!leaked(root.path()));
}

#[test]
fn failures_retain_bounded_raw_output() {
    let root = fixture();
    let runner = Runner::new(root.path().into(), true).with_executable(env!("CARGO_BIN_EXE_projections"));
    let env = runner.environment(&[]).unwrap();
    let failing = cmd(&script(
        root.path(),
        "fail.cmd",
        "@echo off\n<nul set /p=partial\n1>&2 <nul set /p=diagnostic\nexit /b 7\n",
    ));
    let error = runner.run_argv(&failing, root.path(), None, 10_000, &env).unwrap_err();
    assert!(error.to_string().contains("diagnostic"), "{error:#}");
    let outputs = runner.outputs.lock().unwrap();
    assert_eq!(outputs[0]["stdout"], "partial");
    assert_eq!(outputs[0]["stderr"], "diagnostic");
    drop(outputs);
    fs::write(root.path().join("large.txt"), vec![b'x'; 9_000_000]).unwrap();
    let error = runner
        .run_argv(&cmd("type large.txt"), root.path(), None, 30_000, &env)
        .unwrap_err();
    assert!(error.to_string().contains("exceeded"), "{error:#}");
}

fn cli(root: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_projections"))
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "NUL")
        .output()
        .unwrap()
}

fn document(output: Output) -> Value {
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn an_abnormally_ended_cli_leaves_no_extractor_process_behind() {
    let root = fixture();
    tree(root.path());
    fs::create_dir_all(root.path().join(".projections")).unwrap();
    fs::write(
        root.path().join(".projections/tree.json"),
        serde_json::to_vec(&json!({"id":"tree","renderer":"graph","extractor":{"command":["cmd.exe","/d","/c","tree.cmd"]},"execution":{"timeoutMs":60000}})).unwrap(),
    )
    .unwrap();
    commit(root.path());
    let mut child = Command::new(env!("CARGO_BIN_EXE_projections"))
        .args(["show", "HEAD", "-p", "tree", "--trust", "--json"])
        .current_dir(root.path())
        .env("GIT_CONFIG_GLOBAL", "NUL")
        .spawn()
        .unwrap();
    std::thread::sleep(Duration::from_millis(2500));
    // TerminateProcess: no cleanup code runs, so only kill-on-close stops the tree.
    child.kill().unwrap();
    child.wait().unwrap();
    assert!(!leaked(root.path()), "Kill-on-close did not stop the extractor tree");
}

#[test]
fn native_extraction_comparison_output_and_validation() {
    let root = fixture();
    assert!(
        cli(root.path(), &["init", "files", "--extractor", "repository-map"])
            .status
            .success()
    );
    let before = commit(root.path());
    fs::write(root.path().join("added.txt"), "after").unwrap();
    let after = commit(root.path());
    let shown = document(cli(root.path(), &["show", &after, "-p", "files", "--json"]));
    assert!(
        shown["extraction"]["entities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|node| node["label"] == "added.txt")
    );
    let comparison = document(cli(
        root.path(),
        &["compare", &format!("{before}..{after}"), "-p", "files", "--json"],
    ));
    assert!(
        comparison["comparison"]["changes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|change| change["status"] == "added")
    );
    let output = cli(root.path(), &["show", &after, "-p", "files", "--output", "saved.json"]);
    assert!(output.status.success());
    assert_eq!(document(cli(root.path(), &["validate", "saved.json", "--json"]))["valid"], true);
    // Outputs are new files; an existing one is never overwritten.
    assert!(
        !cli(root.path(), &["show", &after, "-p", "files", "--output", "saved.json"])
            .status
            .success()
    );
    let compared = cli(
        root.path(),
        &[
            "compare",
            &format!("{before}..{after}"),
            "-p",
            "files",
            "--output",
            "comparison.json",
        ],
    );
    assert!(compared.status.success());
    assert_eq!(
        document(cli(root.path(), &["validate", "comparison.json", "--json"]))["valid"],
        true
    );
}

#[test]
fn junctions_are_not_followed_by_artifact_reads() {
    let root = fixture();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("saved.json"), "{}").unwrap();
    let junction = root.path().join("linked");
    let status = Command::new("cmd.exe")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(&junction)
        .arg(outside.path())
        .status()
        .unwrap();
    assert!(status.success());
    let error = projections_cli::artifact::read_artifact(&junction.join("saved.json"), 1024);
    // The parent is canonicalized, so the junction resolves to the real directory and
    // the file itself is read; a junction as the final component is refused.
    assert!(error.is_ok());
    assert!(projections_cli::artifact::read_artifact(&junction, 1024).is_err());
}

#[test]
fn symlinks_in_revisions_are_skipped_like_special_entries() {
    let root = fixture();
    let mut hash = Command::new("git")
        .args(["hash-object", "-w", "--stdin"])
        .current_dir(root.path())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    use std::io::Write;
    hash.stdin.take().unwrap().write_all(b"file.txt").unwrap();
    let blob = String::from_utf8(hash.wait_with_output().unwrap().stdout).unwrap();
    git(
        root.path(),
        &["update-index", "--add", "--cacheinfo", &format!("120000,{},link", blob.trim())],
    );
    git(root.path(), &["commit", "--quiet", "-m", "symlink"]);
    let shown = Runner::new(root.path().into(), false)
        .with_executable(env!("CARGO_BIN_EXE_projections"))
        .show("repository-map", "HEAD", None)
        .unwrap();
    let text = serde_json::to_string(&shown).unwrap();
    assert!(text.contains("special entry was not materialized"), "{text}");
    assert!(text.contains("link"));
}
