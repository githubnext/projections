//! The declared environment: prepare steps in the working tree and in
//! workspaces, workspace strategies, and borrowed dependencies.

#![cfg(unix)]

use projections_cli::{environment, runtime::Runner, workspaces::Strategy};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "user.name=Environment",
            "-c",
            "user.email=environment@example.invalid",
        ])
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8(output.stdout).unwrap().trim().into()
}

fn commit(root: &Path) -> String {
    git(root, &["add", "--all"]);
    git(root, &["commit", "--quiet", "-m", "change"]);
    git(root, &["rev-parse", "HEAD"])
}

const EXTRACTION: &str =
    r#"{"protocolVersion":0,"schema":"graph/v0","entities":[{"id":"one","kind":"item","label":"one"}],"relationships":[]}"#;

/// A repository whose `probe` extractor saves its request to `$PROBE` and
/// records which dependencies it found, with an environment whose `install`
/// step "installs" `deps/` from `deps.lock`.
struct Repository {
    root: tempfile::TempDir,
    cache: tempfile::TempDir,
    requests: tempfile::TempDir,
}

impl Repository {
    fn new(install: &str, environment: bool) -> Self {
        let root = tempfile::tempdir().unwrap();
        git(root.path(), &["init", "--template=", "--quiet"]);
        fs::write(root.path().join(".gitignore"), "deps/\n").unwrap();
        fs::write(root.path().join("deps.lock"), "one").unwrap();
        fs::write(root.path().join("package-lock.json"), "{}").unwrap();
        fs::write(root.path().join("src.txt"), "first").unwrap();
        fs::create_dir_all(root.path().join(".projections")).unwrap();
        fs::write(
            root.path().join(".projections/probe.json"),
            serde_json::to_vec(&json!({"id":"probe","renderer":"graph",
                "extractor":{"command":["/bin/sh","-c",format!("cat > \"$PROBE\"; printf '%s' '{EXTRACTION}'")]},
                "execution":{"environment":["PROBE"]}}))
            .unwrap(),
        )
        .unwrap();
        if environment {
            fs::write(
                root.path().join(".projections/environment.json"),
                serde_json::to_vec(&json!({"format":"projections.environment","version":0,
                    "prepare":[{"id":"install","run":["/bin/sh","-c",install],"key":["deps.lock"]}]}))
                .unwrap(),
            )
            .unwrap();
        }
        commit(root.path());
        Self {
            root,
            cache: tempfile::tempdir().unwrap(),
            requests: tempfile::tempdir().unwrap(),
        }
    }

    fn path(&self) -> &Path {
        self.root.path()
    }

    fn runner(&self, trust: bool) -> Runner {
        Runner::new(self.path().into(), trust)
            .with_executable(env!("CARGO_BIN_EXE_projections"))
            .with_cache_base(self.cache.path())
            .with_variables(BTreeMap::from([(
                "PROBE".to_owned(),
                self.requests.path().join("request.json").to_string_lossy().into_owned(),
            )]))
    }

    fn request(&self) -> Value {
        serde_json::from_slice(&fs::read(self.requests.path().join("request.json")).unwrap()).unwrap()
    }
}

const INSTALL: &str = "mkdir -p deps && cat deps.lock > deps/installed && echo run >> deps/runs";

fn runs(directory: &Path) -> usize {
    fs::read_to_string(directory.join("deps/runs"))
        .map(|text| text.lines().count())
        .unwrap_or(0)
}

#[test]
fn prepare_runs_in_the_working_tree_on_demand_only_when_its_key_changes() {
    let repository = Repository::new(INSTALL, true);
    let options = environment::Options::default();
    // Untrusted: refused, naming the environment.
    let error = repository.runner(false).prepare_environment(None, &options).unwrap_err();
    assert!(format!("{error:#}").contains("--trust"), "{error:#}");
    let runner = repository.runner(true);
    let report = runner.prepare_environment(None, &options).unwrap();
    assert_eq!(report["target"], "working-tree");
    assert_eq!(report["steps"][0]["status"], "succeeded");
    assert_eq!(runs(repository.path()), 1);
    // Unchanged key: nothing runs.
    let report = runner.prepare_environment(None, &options).unwrap();
    assert_eq!(report["steps"][0]["status"], "current");
    assert_eq!(runs(repository.path()), 1);
    // The doctor's view.
    let doctor = runner.environment_report().unwrap();
    assert_eq!(doctor["declared"], ".projections/environment.json");
    assert_eq!(doctor["prepare"][0]["state"], "current");
    // A changed key (even uncommitted) reruns it; so does --force.
    fs::write(repository.path().join("deps.lock"), "two").unwrap();
    assert_eq!(runner.environment_report().unwrap()["prepare"][0]["state"], "stale");
    runner.prepare_environment(None, &options).unwrap();
    assert_eq!(runs(repository.path()), 2);
    assert_eq!(fs::read_to_string(repository.path().join("deps/installed")).unwrap(), "two");
    runner
        .prepare_environment(
            None,
            &environment::Options {
                force: true,
                steps: vec!["install".into()],
            },
        )
        .unwrap();
    assert_eq!(runs(repository.path()), 3);
    assert!(
        runner
            .prepare_environment(
                None,
                &environment::Options {
                    force: false,
                    steps: vec!["missing".into()],
                },
            )
            .is_err()
    );
}

#[test]
fn a_failing_step_is_named_with_its_log_and_timeouts_and_cancellation_stop_it() {
    let repository = Repository::new("echo installing; echo broken >&2; exit 3", true);
    let runner = repository.runner(true);
    let error = format!(
        "{:#}",
        runner.prepare_environment(None, &environment::Options::default()).unwrap_err()
    );
    assert!(error.contains("Prepare step install"), "{error}");
    assert!(error.contains("broken"), "{error}");
    let log = PathBuf::from(runner.environment_report().unwrap()["prepare"][0]["last"]["log"].as_str().unwrap());
    assert!(fs::read_to_string(log).unwrap().contains("installing"));
    assert_eq!(runner.environment_report().unwrap()["prepare"][0]["state"], "failed");

    // Cancellation stops the step's whole process tree.
    let slow = Repository::new("sleep 30", true);
    let runner = slow.runner(true);
    let cancel = runner.cancel.clone();
    let started = Instant::now();
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        cancel.store(true, Ordering::SeqCst);
    });
    let error = runner.prepare_environment(None, &environment::Options::default()).unwrap_err();
    canceller.join().unwrap();
    assert!(format!("{error:#}").contains("cancelled"), "{error:#}");
    assert!(started.elapsed() < Duration::from_secs(10));

    // A step's timeout.
    let timed = Repository::new("sleep 30", true);
    let environment_file = timed.path().join(".projections/environment.json");
    let mut declared: Value = serde_json::from_slice(&fs::read(&environment_file).unwrap()).unwrap();
    declared["prepare"][0]["timeoutMs"] = json!(300);
    fs::write(&environment_file, serde_json::to_vec(&declared).unwrap()).unwrap();
    let error = timed
        .runner(true)
        .prepare_environment(None, &environment::Options::default())
        .unwrap_err();
    assert!(format!("{error:#}").contains("Timed out"), "{error:#}");
}

#[test]
fn a_toolchain_on_another_commit_runs_in_a_prepared_reused_worktree() {
    let repository = Repository::new(INSTALL, true);
    let first = git(repository.path(), &["rev-parse", "HEAD"]);
    fs::write(repository.path().join("src.txt"), "second").unwrap();
    let second = commit(repository.path());
    fs::write(repository.path().join("src.txt"), "third").unwrap();
    commit(repository.path());
    let runner = repository.runner(true).with_workspace(Some(Strategy::Worktree));
    let document = runner.show("probe", &first, None).unwrap();
    let execution = &document["provenance"]["execution"];
    assert_eq!(execution["source"], "local-workspace");
    assert_eq!(execution["strategy"], "worktree");
    assert_eq!(execution["fidelity"], "exact");
    assert_eq!(execution["prepared"][0]["id"], "install");
    let request = repository.request();
    assert_eq!(request["repository"]["mode"], "workspace");
    let root = PathBuf::from(request["repository"]["root"].as_str().unwrap());
    assert_eq!(request["repository"]["checkout"], request["repository"]["root"]);
    assert!(root.starts_with(projections_extractor_sdk::canonical(repository.cache.path()).unwrap()));
    assert_eq!(fs::read_to_string(root.join("src.txt")).unwrap(), "first");
    assert_eq!(runs(&root), 1);
    // Another commit with the same lockfile: the same workspace, switched,
    // with its dependencies kept and nothing prepared again.
    runner.show("probe", &second, None).unwrap();
    assert_eq!(PathBuf::from(repository.request()["repository"]["root"].as_str().unwrap()), root);
    assert_eq!(fs::read_to_string(root.join("src.txt")).unwrap(), "second");
    assert_eq!(runs(&root), 1);
    // projections prepare --revision prepares it too, and workspace list shows it.
    let report = runner.prepare_environment(Some(&first), &environment::Options::default()).unwrap();
    assert_eq!(report["steps"][0]["status"], "current");
    let listed = projections_cli::workspaces::list(&runner).unwrap();
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert_eq!(listed[0]["strategy"], "worktree");
    assert_eq!(listed[0]["prepared"][0]["status"], "succeeded");
    // Cleaning removes it and its Git worktree registration.
    assert_eq!(projections_cli::workspaces::clean(&runner).unwrap(), ["worktree-0"]);
    assert!(!root.exists());
    assert!(!git(repository.path(), &["worktree", "list"]).contains("worktree-0"));
}

#[test]
fn concurrent_runs_never_share_a_workspace() {
    let repository = Repository::new(INSTALL, true);
    let head = git(repository.path(), &["rev-parse", "HEAD"]);
    let runner = repository.runner(true);
    let first = projections_cli::workspaces::lease(&runner, &head, Strategy::Worktree, None).unwrap();
    let second = projections_cli::workspaces::lease(&runner, &head, Strategy::Worktree, None).unwrap();
    assert_ne!(first.root, second.root);
    drop(first);
    let third = projections_cli::workspaces::lease(&runner, &head, Strategy::Worktree, None).unwrap();
    assert!(third.root.to_string_lossy().contains("worktree-0"));
    let listed = projections_cli::workspaces::list(&runner).unwrap();
    assert!(listed.iter().all(|workspace| workspace["busy"] == true));
    // A busy workspace is never removed.
    assert!(projections_cli::workspaces::clean(&runner).unwrap().is_empty());
}

#[test]
fn without_an_environment_borrowed_dependencies_are_labelled_approximate() {
    let repository = Repository::new(INSTALL, false);
    let first = git(repository.path(), &["rev-parse", "HEAD"]);
    fs::write(repository.path().join("src.txt"), "second").unwrap();
    commit(repository.path());
    let runner = repository.runner(true);
    // Same lockfiles: exact, with dependencies borrowed from the checkout.
    let document = runner.show("probe", &first, None).unwrap();
    assert_eq!(document["provenance"]["execution"]["fidelity"], "exact");
    assert_eq!(
        repository.request()["repository"]["checkout"],
        json!(projections_extractor_sdk::canonical(repository.path()).unwrap())
    );
    // The working tree's lockfile changed: approximate, naming it.
    fs::write(repository.path().join("package-lock.json"), r#"{"v":2}"#).unwrap();
    let document = runner.show("probe", &first, None).unwrap();
    assert_eq!(document["provenance"]["execution"]["fidelity"], "approximate");
    assert!(
        document["provenance"]["limitations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|text| text.as_str().unwrap().contains("package-lock.json")),
        "{document}"
    );
    // With prepare steps, the commit's own dependencies are installed in its
    // workspace, so the working tree's lockfiles don't matter.
    let declared = Repository::new(INSTALL, true);
    let old = git(declared.path(), &["rev-parse", "HEAD"]);
    fs::write(declared.path().join("src.txt"), "second").unwrap();
    commit(declared.path());
    fs::write(declared.path().join("package-lock.json"), r#"{"v":2}"#).unwrap();
    let document = declared.runner(true).show("probe", &old, None).unwrap();
    assert_eq!(document["provenance"]["execution"]["fidelity"], "exact");
    assert_eq!(document["provenance"]["execution"]["prepared"][0]["id"], "install");
}

#[test]
fn the_strategies_fall_back_and_explain_themselves() {
    let repository = Repository::new(INSTALL, false);
    let first = git(repository.path(), &["rev-parse", "HEAD"]);
    fs::write(repository.path().join("src.txt"), "second").unwrap();
    commit(repository.path());
    // A tiny repository chooses fresh copies automatically.
    let runner = repository.runner(true);
    let choice = projections_cli::workspaces::choose(&runner, None, None).unwrap();
    assert_eq!(choice.strategy, Strategy::Fresh);
    assert_eq!(choice.source, "automatic");
    let document = runner.show("probe", &first, None).unwrap();
    assert_eq!(document["provenance"]["execution"]["strategy"], "fresh");
    assert_eq!(repository.request()["repository"]["mode"], "materialized");
    // The environment file's strategy is the team's; a flag overrides it.
    let choice = projections_cli::workspaces::choose(&runner, None, Some("clone")).unwrap();
    assert_eq!((choice.strategy, choice.source), (Strategy::Clone, "environment"));
    let choice = projections_cli::workspaces::choose(&runner, Some(Strategy::Worktree), Some("clone")).unwrap();
    assert_eq!((choice.strategy, choice.source), (Strategy::Worktree, "flag"));
    // none: an actionable failure.
    let error = repository
        .runner(true)
        .with_workspace(Some(Strategy::None))
        .show("probe", &first, None)
        .unwrap_err();
    let error = format!("{error:#}");
    assert!(error.contains("--ci") && error.contains("--workspace"), "{error}");
    // sparse without a scope: a full worktree, saying so.
    let document = repository
        .runner(true)
        .with_workspace(Some(Strategy::Sparse))
        .show("probe", &first, None)
        .unwrap();
    assert_eq!(document["provenance"]["execution"]["strategy"], "worktree");
    assert!(
        document["provenance"]["limitations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|text| text.as_str().unwrap().contains("needs a declared scope"))
    );
    // clone: seeded from the checkout copy-on-write (APFS, btrfs, XFS), with its
    // ignored dependencies, or a worktree, saying why.
    fs::create_dir_all(repository.path().join("deps")).unwrap();
    fs::write(repository.path().join("deps/installed"), "from the checkout").unwrap();
    let document = repository
        .runner(true)
        .with_workspace(Some(Strategy::Clone))
        .show("probe", &first, None)
        .unwrap();
    let root = PathBuf::from(repository.request()["repository"]["root"].as_str().unwrap());
    assert_eq!(fs::read_to_string(root.join("src.txt")).unwrap(), "first");
    if projections_cli::workspaces::clones(repository.path()) {
        assert_eq!(document["provenance"]["execution"]["strategy"], "clone");
        assert_eq!(fs::read_to_string(root.join("deps/installed")).unwrap(), "from the checkout");
    } else {
        assert!(
            document["provenance"]["limitations"]
                .as_array()
                .unwrap()
                .iter()
                .any(|text| text.as_str().unwrap().contains("copy-on-write"))
        );
    }
}

#[test]
fn a_sparse_workspace_holds_only_the_scope() {
    let repository = Repository::new(INSTALL, false);
    fs::create_dir_all(repository.path().join("api")).unwrap();
    fs::write(repository.path().join("api/schema.txt"), "v1").unwrap();
    let definition = repository.path().join(".projections/probe.json");
    let mut probe: Value = serde_json::from_slice(&fs::read(&definition).unwrap()).unwrap();
    probe["execution"]["scope"] = json!(["api", ".projections"]);
    fs::write(&definition, serde_json::to_vec(&probe).unwrap()).unwrap();
    let first = commit(repository.path());
    fs::write(repository.path().join("api/schema.txt"), "v2").unwrap();
    commit(repository.path());
    let document = repository
        .runner(true)
        .with_workspace(Some(Strategy::Sparse))
        .show("probe", &first, None)
        .unwrap();
    assert_eq!(document["provenance"]["execution"]["strategy"], "sparse");
    let root = PathBuf::from(repository.request()["repository"]["root"].as_str().unwrap());
    assert_eq!(fs::read_to_string(root.join("api/schema.txt")).unwrap(), "v1");
    assert!(!root.join("src.txt").exists());
}
