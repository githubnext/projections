//! Where extractors run: in place, from Git objects, or in a copy, and what
//! provenance says about it.

#![cfg(unix)]

use projections_cli::runtime::Runner;
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, path::Path, process::Command};

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "user.name=Execution",
            "-c",
            "user.email=execution@example.invalid",
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

/// A repository with a custom projection `probe` whose extractor saves its
/// request to `$PROBE` (and, when `script` says so, does more), and the
/// directory holding the saved requests.
struct Repository {
    root: tempfile::TempDir,
    requests: tempfile::TempDir,
}

impl Repository {
    fn new(script: &str) -> Self {
        let root = tempfile::tempdir().unwrap();
        let requests = tempfile::tempdir().unwrap();
        git(root.path(), &["init", "--template=", "--quiet"]);
        fs::write(root.path().join("file.txt"), "first").unwrap();
        fs::write(root.path().join(".gitignore"), "ignored/\n").unwrap();
        fs::create_dir_all(root.path().join(".projections")).unwrap();
        fs::write(
            root.path().join(".projections/probe.json"),
            serde_json::to_vec(&json!({"id":"probe","renderer":"graph",
                "extractor":{"command":["/bin/sh","-c",format!("cat > \"$PROBE\"; {script} printf '%s' '{EXTRACTION}'")]},
                "execution":{"environment":["PROBE"]}}))
            .unwrap(),
        )
        .unwrap();
        fs::write(
            root.path().join(".projections/files.json"),
            serde_json::to_vec(&json!({"id":"files","extractor":"repository-map","renderer":"file-packing"})).unwrap(),
        )
        .unwrap();
        commit(root.path());
        Self { root, requests }
    }

    fn path(&self) -> &Path {
        self.root.path()
    }

    fn runner(&self) -> Runner {
        let probe = self.requests.path().join("request.json");
        Runner::new(self.path().into(), true)
            .with_executable(env!("CARGO_BIN_EXE_projections"))
            .with_variables(BTreeMap::from([("PROBE".to_owned(), probe.to_string_lossy().into_owned())]))
    }

    /// The request the probe extractor last received.
    fn request(&self) -> Value {
        serde_json::from_slice(&fs::read(self.requests.path().join("request.json")).unwrap()).unwrap()
    }
}

fn canonical(path: &Path) -> Value {
    json!(projections_extractor_sdk::canonical(path).unwrap())
}

#[test]
fn the_working_tree_is_extracted_in_place_with_its_identity() {
    let repository = Repository::new("");
    fs::write(repository.path().join("untracked.txt"), "new").unwrap();
    let runner = repository.runner();
    let document = runner.show("probe", "working-tree", None).unwrap();
    let request = repository.request();
    assert_eq!(request["repository"]["mode"], "in-place");
    assert_eq!(request["repository"]["root"], canonical(repository.path()));
    assert_eq!(request["repository"]["checkout"], canonical(repository.path()));
    let execution = &document["provenance"]["execution"];
    assert_eq!(execution["source"], "local-in-place");
    assert_eq!(execution["fidelity"], "exact");
    // The identity is the tree `git add -A` would commit; the index is untouched.
    let index = git(repository.path(), &["status", "--porcelain"]);
    git(repository.path(), &["add", "-A"]);
    assert_eq!(execution["tree"], git(repository.path(), &["write-tree"]));
    git(repository.path(), &["reset", "--quiet"]);
    assert_eq!(git(repository.path(), &["status", "--porcelain"]), index);
    assert_eq!(runner.working_tree().unwrap(), execution["tree"]);
}

#[test]
fn a_change_during_an_in_place_run_is_labelled_stale() {
    let repository = Repository::new("printf x >> file.txt;");
    let document = repository.runner().show("probe", "working-tree", None).unwrap();
    assert_eq!(document["provenance"]["execution"]["fidelity"], "stale");
    assert!(
        document["provenance"]["limitations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|text| text.as_str().unwrap().contains("changed while the extractor ran"))
    );
}

#[test]
fn a_read_only_built_in_reads_a_commit_from_git_objects() {
    let repository = Repository::new("");
    let first = git(repository.path(), &["rev-parse", "HEAD"]);
    fs::write(repository.path().join("file.txt"), "second").unwrap();
    commit(repository.path());
    let document = repository.runner().show("files", &first, None).unwrap();
    let execution = &document["provenance"]["execution"];
    assert_eq!(execution["source"], "local-git-objects");
    assert_eq!(
        execution["tree"],
        git(repository.path(), &["rev-parse", &format!("{first}^{{tree}}")])
    );
    let file = document["extraction"]["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entity| entity["id"] == "file:file.txt")
        .unwrap();
    assert_eq!(file["data"]["size"], "first".len());
}

#[test]
fn a_toolchain_on_the_clean_head_runs_in_place_and_on_another_commit_in_a_copy() {
    let repository = Repository::new("");
    let first = git(repository.path(), &["rev-parse", "HEAD"]);
    let runner = repository.runner();
    let head = runner.show("probe", &first, None).unwrap();
    assert_eq!(head["provenance"]["execution"]["source"], "local-in-place");
    assert_eq!(head["provenance"]["revision"]["kind"], "commit");
    assert_eq!(repository.request()["repository"]["mode"], "in-place");

    fs::write(repository.path().join("file.txt"), "second").unwrap();
    commit(repository.path());
    let older = runner.show("probe", &first, None).unwrap();
    let execution = &older["provenance"]["execution"];
    assert_eq!(execution["source"], "local-materialized");
    assert_eq!(execution["strategy"], "fresh");
    let request = repository.request();
    assert_eq!(request["repository"]["mode"], "materialized");
    assert_ne!(request["repository"]["root"], canonical(repository.path()));
    // Dependencies are borrowed from the user's checkout.
    assert_eq!(request["repository"]["checkout"], canonical(repository.path()));
}

#[test]
fn a_host_directory_in_an_extraction_is_refused_whichever_revision_defines_it() {
    let repository = Repository::new("");
    // Evidence escaping the materialized copy into the checkout borrowed for
    // dependencies, as a compiler's own declaration library would.
    let script = r#"request=$(cat); checkout=$(printf '%s' "$request" | sed -n 's/.*"checkout":"\([^"]*\)".*/\1/p'); leak=$(printf '%s/%s/%s%s' .. .. .. "$checkout"); printf '{"protocolVersion":0,"schema":"graph/v0","entities":[{"id":"one","kind":"item","label":"one","evidence":[{"kind":"probe","source":"%s/node_modules/lib.d.ts"}]}],"relationships":[]}' "$leak""#;
    fs::write(
        repository.path().join(".projections/leak.json"),
        serde_json::to_vec(&json!({"id":"leak","renderer":"graph",
            "extractor":{"command":["/bin/sh","-c",script]}}))
        .unwrap(),
    )
    .unwrap();
    let first = commit(repository.path());
    fs::write(repository.path().join("file.txt"), "second").unwrap();
    commit(repository.path());
    let runner = repository.runner();
    for definition in [None, Some("working-tree")] {
        let error = runner.show("leak", &first, definition).expect_err("a host directory is refused");
        assert!(
            format!("{error:#}").contains("Extractor emitted a host directory"),
            "{definition:?}: {error:#}"
        );
    }
}

#[test]
fn untracked_files_keep_head_out_of_place_unless_in_place_is_allowed() {
    let repository = Repository::new("");
    let head = git(repository.path(), &["rev-parse", "HEAD"]);
    fs::write(repository.path().join("build-output.txt"), "made by CI").unwrap();
    let document = repository.runner().show("probe", &head, None).unwrap();
    assert_eq!(document["provenance"]["execution"]["source"], "local-materialized");
    let document = repository.runner().with_in_place(true).show("probe", &head, None).unwrap();
    assert_eq!(document["provenance"]["execution"]["source"], "local-in-place");
    // A modified tracked file is never in place, even when allowed.
    fs::write(repository.path().join("file.txt"), "edited").unwrap();
    let document = repository.runner().with_in_place(true).show("probe", &head, None).unwrap();
    assert_eq!(document["provenance"]["execution"]["source"], "local-materialized");
}

impl Repository {
    fn probe_ran(&self) -> bool {
        let path = self.requests.path().join("request.json");
        let ran = path.exists();
        let _ = fs::remove_file(path);
        ran
    }
}

#[test]
fn commits_and_read_only_extractions_are_cached_by_their_git_identity() {
    let repository = Repository::new("");
    let cache = tempfile::tempdir().unwrap();
    let first = git(repository.path(), &["rev-parse", "HEAD"]);
    fs::write(repository.path().join("file.txt"), "second").unwrap();
    commit(repository.path());
    let cached = || repository.runner().with_cache_in(cache.path()).unwrap();

    // A toolchain on a commit: the second run is a hit and runs nothing.
    let runner = cached();
    let extracted = runner.show("probe", &first, None).unwrap();
    assert!(repository.probe_ran());
    assert_eq!(runner.cache_hits(), 0);
    let runner = cached();
    let reused = runner.show("probe", &first, None).unwrap();
    assert!(!repository.probe_ran());
    assert_eq!(runner.cache_hits(), 1);
    assert_eq!(reused["digest"], extracted["digest"]);
    assert_eq!(reused["provenance"]["execution"], extracted["provenance"]["execution"]);
    assert_eq!(reused["provenance"]["revision"]["commit"], first);

    // A read-only built-in on the working tree is keyed by its identity:
    // unchanged, a hit; any edit (even an untracked file), a miss.
    let runner = cached();
    runner.show("files", "working-tree", None).unwrap();
    runner.show("files", "working-tree", None).unwrap();
    assert_eq!(runner.cache_hits(), 1);
    fs::write(repository.path().join("notes.txt"), "outside any scope").unwrap();
    let runner = cached();
    let edited = runner.show("files", "working-tree", None).unwrap();
    assert_eq!(runner.cache_hits(), 0);
    assert!(
        edited["extraction"]["entities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entity| entity["id"] == "file:notes.txt")
    );
    // Ignored files are not part of the identity.
    fs::create_dir(repository.path().join("ignored")).unwrap();
    fs::write(repository.path().join("ignored/build.log"), "x").unwrap();
    let runner = cached();
    runner.show("files", "working-tree", None).unwrap();
    assert_eq!(runner.cache_hits(), 1);

    // A toolchain on the working tree also depends on ignored files, so it always runs.
    let runner = cached();
    runner.show("probe", "working-tree", None).unwrap();
    assert!(repository.probe_ran());
    runner.show("probe", "working-tree", None).unwrap();
    assert!(repository.probe_ran());
    assert_eq!(runner.cache_hits(), 0);

    // A granted variable's value is part of the key, and --no-cache bypasses it.
    let runner = cached().with_variables(BTreeMap::from([(
        "PROBE".to_owned(),
        repository.requests.path().join("request.json").to_string_lossy().into_owned(),
    )]));
    runner.show("probe", &first, None).unwrap();
    assert_eq!(runner.cache_hits(), 1);
    let runner = repository
        .runner()
        .with_policy(&projections_cli::runtime::ExecutionPolicy::default());
    assert!(runner.extraction_cache().is_none());
}

#[test]
fn a_stale_extraction_is_never_cached() {
    let repository = Repository::new("printf x >> file.txt;");
    let cache = tempfile::tempdir().unwrap();
    let head = git(repository.path(), &["rev-parse", "HEAD"]);
    let runner = repository.runner().with_cache_in(cache.path()).unwrap();
    // HEAD is clean, so it runs in place, and the extractor dirties it.
    let document = runner.show("probe", &head, None).unwrap();
    assert_eq!(document["provenance"]["execution"]["fidelity"], "stale");
    git(repository.path(), &["checkout", "--", "file.txt"]);
    runner.show("probe", &head, None).unwrap();
    assert_eq!(runner.cache_hits(), 0);
}

/// Writes a CI artifact holding `documents` (projection ID → document).
fn artifact(directory: &Path, documents: &[(&str, &Value)]) {
    fs::create_dir_all(directory.join("projections")).unwrap();
    let mut projections = Vec::new();
    for (id, document) in documents {
        let bytes = serde_json::to_vec(document).unwrap();
        let path = format!("projections/{id}.json");
        fs::write(directory.join(&path), &bytes).unwrap();
        projections.push(json!({"id": id, "status": "extracted", "path": path,
            "sha256": projections_cli::artifact::byte_sha256(&bytes)}));
    }
    fs::write(
        directory.join("projections.artifact.json"),
        serde_json::to_vec(&json!({"format": "projections.artifact", "version": 0, "protocolVersion": 0,
            "producer": {"cli": "projections 0.0.0"},
            "repository": {"provider": "github", "id": 1, "owner": "acme", "name": "demo"},
            "run": {"id": 4242, "attempt": 1},
            "subject": {"kind": "push", "ref": "refs/heads/main", "revision": "0".repeat(40)},
            "trust": true, "projections": projections}))
        .unwrap(),
    )
    .unwrap();
}

#[test]
fn a_verified_ci_artifact_supplies_a_commit_without_running_anything() {
    let repository = Repository::new("");
    let first = git(repository.path(), &["rev-parse", "HEAD"]);
    fs::write(repository.path().join("file.txt"), "second").unwrap();
    commit(repository.path());
    let extracted = repository.runner().show("probe", &first, None).unwrap();
    assert!(repository.probe_ran());
    let directory = tempfile::tempdir().unwrap();
    artifact(directory.path(), &[("probe", &extracted)]);

    let runner = repository.runner().with_artifacts(vec![directory.path().into()], false);
    let reused = runner.show("probe", &first, None).unwrap();
    assert!(!repository.probe_ran());
    assert_eq!(reused["digest"], extracted["digest"]);
    let execution = &reused["provenance"]["execution"];
    assert_eq!(execution["source"], "ci");
    // Nothing authenticates an imported directory's manifest: it names a run,
    // but the extraction is labelled imported, not official.
    assert_eq!(execution["official"], false);
    assert_eq!(execution["ci"], json!({"repository": "acme/demo", "run": 4242}));
    // Another commit, or another definition, isn't supplied by it.
    runner.show("probe", "HEAD~0", None).unwrap();
    assert!(repository.probe_ran());

    // A document whose bytes don't match the manifest is never used.
    let tampered = tempfile::tempdir().unwrap();
    artifact(tampered.path(), &[("probe", &extracted)]);
    let path = tampered.path().join("projections/probe.json");
    let mut bytes = fs::read(&path).unwrap();
    bytes.push(b' ');
    fs::write(&path, bytes).unwrap();
    let document = repository
        .runner()
        .with_artifacts(vec![tampered.path().into()], false)
        .show("probe", &first, None)
        .unwrap();
    assert!(repository.probe_ran());
    assert_eq!(document["provenance"]["execution"]["source"], "local-materialized");

    // A changed definition has another digest, so the artifact doesn't apply.
    let definition = repository.path().join(".projections/probe.json");
    let mut changed: Value = serde_json::from_slice(&fs::read(&definition).unwrap()).unwrap();
    changed["title"] = json!("Changed");
    changed["inputs"] = json!({"changed": true});
    fs::write(&definition, serde_json::to_vec(&changed).unwrap()).unwrap();
    let document = repository
        .runner()
        .with_artifacts(vec![directory.path().into()], false)
        .show("probe", &first, Some("working-tree"))
        .unwrap();
    assert!(repository.probe_ran());
    assert_ne!(document["provenance"]["execution"]["source"], "ci");
}

/// A stand-in for gh answering `responses` (a shell `case` pattern over its
/// arguments → its output), logging every call; anything else fails.
fn fake_gh(directory: &Path, responses: &[(&str, &str)]) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let log = directory.join("calls.log");
    let mut script = format!("#!/bin/sh\necho \"$@\" >> '{}'\ncase \"$*\" in\n", log.display());
    for (pattern, output) in responses {
        script.push_str(&format!("  {pattern}) {output} ;;\n"));
    }
    script.push_str("  *) echo \"unexpected gh $*\" >&2; exit 1 ;;\nesac\n");
    let gh = directory.join("gh");
    fs::write(&gh, script).unwrap();
    fs::set_permissions(&gh, fs::Permissions::from_mode(0o755)).unwrap();
    gh
}

/// A workflow run from GitHub's API: `id`, its event and head repository.
fn workflow_run(id: u64, event: &str, head: &str) -> String {
    json!({"id": id, "event": event, "conclusion": "success", "path": ".github/workflows/ci.yml",
        "repository": {"full_name": "acme/demo"}, "head_repository": {"full_name": head}})
    .to_string()
}

/// A CI test repository: its first commit's extraction, published in an
/// artifact, with `origin` at github.com/acme/demo.
fn published() -> (Repository, String, Value, tempfile::TempDir) {
    let repository = Repository::new("");
    let first = git(repository.path(), &["rev-parse", "HEAD"]);
    git(repository.path(), &["remote", "add", "origin", "https://github.com/acme/demo.git"]);
    fs::write(repository.path().join("file.txt"), "second").unwrap();
    commit(repository.path());
    let extracted = repository.runner().show("probe", &first, None).unwrap();
    assert!(repository.probe_ran());
    let published = tempfile::tempdir().unwrap();
    artifact(published.path(), &[("probe", &extracted)]);
    (repository, first, extracted, published)
}

fn with_gh(repository: &Repository, gh: &Path) -> Runner {
    repository.runner().with_variables(BTreeMap::from([
        (
            "PROBE".to_owned(),
            repository.requests.path().join("request.json").to_string_lossy().into_owned(),
        ),
        ("PROJECTIONS_GH".to_owned(), gh.to_string_lossy().into_owned()),
    ]))
}

const USES_ACTION: &str = "printf 'jobs:\\n  build:\\n    steps:\\n      - uses: githubnext/projections@v0\\n'";

#[test]
fn ci_artifacts_are_downloaded_from_the_repository_runs_for_the_commit() {
    let (repository, first, _, published) = published();
    let bin = tempfile::tempdir().unwrap();
    let log = bin.path().join("calls.log");
    let runs = format!("{{\"workflow_runs\":[{}]}}", workflow_run(4242, "push", "acme/demo"));
    let gh = fake_gh(
        bin.path(),
        &[
            (&format!("*\"actions/runs?head_sha={first}\"*"), &format!("printf '%s' '{runs}'")),
            ("*\"contents/.github/workflows/ci.yml\"*", USES_ACTION),
            (
                "*\"actions/runs/4242/artifacts\"*",
                r#"printf '%s' '{"artifacts":[{"name":"projections","expired":false}]}'"#,
            ),
            (
                "\"run download 4242\"*",
                &format!("shift 8; cp -R '{}/.' \"$1\"", published.path().display()),
            ),
            ("*", r#"printf '%s' '{"workflow_runs":[]}'"#),
        ],
    );
    let cache = tempfile::tempdir().unwrap();
    let runner = with_gh(&repository, &gh)
        .with_cache_in(cache.path())
        .unwrap()
        .with_artifacts(Vec::new(), true);
    let reused = runner.show("probe", &first, None).unwrap();
    assert!(!repository.probe_ran(), "{}", fs::read_to_string(&log).unwrap());
    let execution = &reused["provenance"]["execution"];
    assert_eq!(execution["source"], "ci");
    assert_eq!(execution["official"], true);
    assert_eq!(
        execution["ci"],
        json!({"repository": "acme/demo", "run": 4242, "workflow": ".github/workflows/ci.yml", "authentication": "download"})
    );
    let calls = fs::read_to_string(&log).unwrap();
    assert!(calls.contains("run download 4242 --repo github.com/acme/demo --name projections"));
    // The download is kept in the cache and reused without gh.
    fs::remove_file(&log).unwrap();
    fs::remove_dir_all(cache.path().join("extractions")).unwrap();
    let runner = repository
        .runner()
        .with_cache_in(cache.path())
        .unwrap()
        .with_artifacts(Vec::new(), true);
    let reused = runner.show("probe", &first, None).unwrap();
    assert_eq!(reused["provenance"]["execution"]["official"], true);
    assert!(!log.exists());
    assert!(!repository.probe_ran());

    // A download an earlier version kept, without the record of its run, isn't
    // used unless GitHub's API identifies its run again.
    let downloads = fs::read_dir(cache.path().join("artifacts"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    fs::remove_file(downloads.join("4242.json")).unwrap();
    fs::remove_dir_all(cache.path().join("extractions")).unwrap();
    let none = fake_gh(bin.path(), &[("*", r#"printf '%s' '{"workflow_runs":[]}'"#)]);
    let document = with_gh(&repository, &none)
        .with_cache_in(cache.path())
        .unwrap()
        .with_artifacts(Vec::new(), true)
        .show("probe", &first, None)
        .unwrap();
    assert!(repository.probe_ran());
    assert_ne!(document["provenance"]["execution"]["source"], "ci");
}

#[test]
fn a_fork_pull_request_run_is_never_the_repository_ci() {
    let (repository, first, _, published) = published();
    let bin = tempfile::tempdir().unwrap();
    let log = bin.path().join("calls.log");
    // A fork's pull request run for the commit, and a run of a workflow that
    // doesn't use the Action on the default branch, both with artifacts.
    let mut other = serde_json::from_str::<Value>(&workflow_run(4243, "push", "acme/demo")).unwrap();
    other["path"] = json!(".github/workflows/other.yml");
    let runs = format!(
        "{{\"workflow_runs\":[{},{other}]}}",
        workflow_run(666, "pull_request", "mallory/demo")
    );
    let gh = fake_gh(
        bin.path(),
        &[
            (&format!("*\"actions/runs?head_sha={first}\"*"), &format!("printf '%s' '{runs}'")),
            ("*\"contents/.github/workflows/ci.yml\"*", USES_ACTION),
            ("*\"contents/.github/workflows/other.yml\"*", "printf 'jobs: {}\\n'"),
            (
                "*\"/artifacts?name=projections\"",
                r#"printf '%s' '{"artifacts":[{"name":"projections","expired":false}]}'"#,
            ),
            (
                "\"run download \"*",
                &format!("shift 8; cp -R '{}/.' \"$1\"", published.path().display()),
            ),
        ],
    );
    let cache = tempfile::tempdir().unwrap();
    let document = with_gh(&repository, &gh)
        .with_cache_in(cache.path())
        .unwrap()
        .with_artifacts(Vec::new(), true)
        .show("probe", &first, None)
        .unwrap();
    assert!(repository.probe_ran());
    assert_ne!(document["provenance"]["execution"]["source"], "ci");
    let calls = fs::read_to_string(&log).unwrap();
    assert!(!calls.contains("run download"), "{calls}");
    // Configuring the other workflow accepts its run, never the fork's.
    let document = with_gh(&repository, &gh)
        .with_cache_in(tempfile::tempdir().unwrap().path())
        .unwrap()
        .with_ci_artifacts(Vec::new(), true, vec!["other.yml".into()])
        .show("probe", &first, None)
        .unwrap();
    assert!(!repository.probe_ran(), "{}", fs::read_to_string(&log).unwrap());
    assert_eq!(document["provenance"]["execution"]["ci"]["run"], 4243);
    assert_eq!(document["provenance"]["execution"]["official"], true);
    assert!(!fs::read_to_string(&log).unwrap().contains("run download 666"));
}

#[test]
fn an_imported_artifact_is_official_only_when_its_attestation_verifies() {
    let (repository, first, _, published) = published();
    let certificate = json!([{"verificationResult": {"signature": {"certificate": {
        "sourceRepositoryURI": "https://github.com/acme/demo",
        "githubWorkflowTrigger": "push",
        "runInvocationURI": "https://github.com/acme/demo/actions/runs/4242/attempts/1",
        "buildConfigURI": "https://github.com/acme/demo/.github/workflows/ci.yml@refs/heads/main"}}}}]);
    let attested = |run: String| {
        let bin = tempfile::tempdir().unwrap();
        let gh = fake_gh(
            bin.path(),
            &[
                (
                    &format!(
                        "\"attestation verify {}/projections.artifact.json --repo acme/demo\"*",
                        published.path().display()
                    ),
                    &format!("printf '%s' '{certificate}'"),
                ),
                ("*\"actions/runs/4242\"", &format!("printf '%s' '{run}'")),
                ("*\"contents/.github/workflows/ci.yml\"*", USES_ACTION),
                ("*\"actions/runs?head_sha=\"*", r#"printf '%s' '{"workflow_runs":[]}'"#),
            ],
        );
        let document = with_gh(&repository, &gh)
            .with_cache_base(tempfile::tempdir().unwrap().path())
            .with_artifacts(vec![published.path().into()], true)
            .show("probe", &first, None)
            .unwrap();
        assert!(!repository.probe_ran());
        (document["provenance"]["execution"].clone(), bin)
    };
    let (execution, _bin) = attested(workflow_run(4242, "push", "acme/demo"));
    assert_eq!(execution["official"], true);
    assert_eq!(execution["ci"]["authentication"], "attestation");
    assert_eq!(execution["ci"]["workflow"], ".github/workflows/ci.yml");
    // A fork's run can't authenticate an artifact, even with an attestation.
    let (execution, _bin) = attested(workflow_run(4242, "pull_request", "mallory/demo"));
    assert_eq!(execution["official"], false);
    assert!(execution["ci"].get("authentication").is_none());

    // Without an attestation it is reused, labelled imported.
    let bin = tempfile::tempdir().unwrap();
    let gh = fake_gh(
        bin.path(),
        &[
            ("\"attestation verify \"*", "echo 'no attestations found' >&2; exit 1"),
            ("*\"actions/runs?head_sha=\"*", r#"printf '%s' '{"workflow_runs":[]}'"#),
        ],
    );
    let document = with_gh(&repository, &gh)
        .with_cache_base(tempfile::tempdir().unwrap().path())
        .with_artifacts(vec![published.path().into()], true)
        .show("probe", &first, None)
        .unwrap();
    assert!(!repository.probe_ran());
    assert_eq!(document["provenance"]["execution"]["official"], false);
}

#[test]
fn a_parity_check_compares_a_local_extraction_with_ci() {
    let repository = Repository::new("");
    let first = git(repository.path(), &["rev-parse", "HEAD"]);
    fs::write(repository.path().join("file.txt"), "second").unwrap();
    commit(repository.path());
    let extracted = repository.runner().show("probe", &first, None).unwrap();
    let directory = tempfile::tempdir().unwrap();
    artifact(directory.path(), &[("probe", &extracted)]);
    let runner = repository.runner().with_artifacts(vec![directory.path().into()], false);
    let (local, ci) = runner.parity("probe", &first).unwrap().unwrap();
    assert_eq!(local["digest"], ci["digest"]);
    assert_eq!(local["provenance"]["execution"]["source"], "local-materialized");
    assert_eq!(ci["provenance"]["execution"]["source"], "ci");
    // A commit CI never extracted has nothing to compare with.
    assert!(runner.parity("probe", "HEAD").unwrap().is_none());
    assert!(runner.parity("probe", "working-tree").is_err());
}

/// Runs the CLI in `root`, returning its JSON output and whether it succeeded.
fn cli(root: &Path, args: &[&str]) -> (Value, bool) {
    let output = Command::new(env!("CARGO_BIN_EXE_projections"))
        .args(args)
        .current_dir(root)
        .env("PROJECTIONS_CACHE_DIR", root.join(".git/test-cache"))
        .output()
        .unwrap();
    (
        serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
            panic!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
        }),
        output.status.success(),
    )
}

fn determinism_step(report: &Value) -> &Value {
    report["projections"][0]["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| step["id"] == "determinism")
        .unwrap()
}

#[test]
fn check_reruns_an_extraction_and_warns_when_runs_differ() {
    let root = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "--template=", "--quiet"]);
    fs::create_dir_all(root.path().join(".projections")).unwrap();
    // The label is the extractor's process ID, which differs on every run.
    let varying = r#"cat >/dev/null; printf '{"protocolVersion":0,"schema":"graph/v0","entities":[{"id":"one","kind":"item","label":"%s"}],"relationships":[]}' "$$""#;
    fs::write(
        root.path().join(".projections/varying.json"),
        serde_json::to_vec(&json!({"id":"varying","renderer":"graph",
            "extractor":{"command":["/bin/sh","-c",varying]}}))
        .unwrap(),
    )
    .unwrap();
    commit(root.path());
    let (report, ok) = cli(root.path(), &["check", "-p", "varying", "--no-render", "--trust", "--json"]);
    let step = determinism_step(&report);
    assert_eq!(step["status"], "warn", "{report}");
    let message = step["message"].as_str().unwrap();
    assert!(message.contains("entity one (/label)"), "{message}");
    assert!(message.contains("environmental"), "{message}");
    assert!(ok, "a determinism warning doesn't fail check: {report}");
    let (report, ok) = cli(
        root.path(),
        &["check", "-p", "varying", "--no-render", "--trust", "--json", "--strict-determinism"],
    );
    assert_eq!(determinism_step(&report)["status"], "fail");
    assert!(!ok);

    // Declared volatile, a field that varies within its tolerance is expected
    // variation: the rerun passes.
    let volatile = r#"cat >/dev/null; printf '{"protocolVersion":0,"schema":"graph/v0","entities":[{"id":"one","kind":"item","label":"one","data":{"pid":%s}}],"relationships":[],"volatile":[{"path":"/data/pid"}]}' "$$""#;
    let definition = root.path().join(".projections/varying.json");
    let mut tolerant: Value = serde_json::from_slice(&fs::read(&definition).unwrap()).unwrap();
    tolerant["extractor"]["command"][2] = json!(volatile);
    fs::write(&definition, serde_json::to_vec(&tolerant).unwrap()).unwrap();
    let (report, ok) = cli(
        root.path(),
        &["check", "-p", "varying", "--no-render", "--trust", "--json", "--strict-determinism"],
    );
    let step = determinism_step(&report);
    assert_eq!(step["status"], "pass", "{report}");
    assert!(step["message"].as_str().unwrap().contains("within the declared volatile"));
    assert!(ok, "{report}");
    // Declared pure, marking fields volatile is suspicious: a warning.
    tolerant["execution"] = json!({"determinism": "pure"});
    fs::write(&definition, serde_json::to_vec(&tolerant).unwrap()).unwrap();
    let (report, _) = cli(root.path(), &["check", "-p", "varying", "--no-render", "--trust", "--json"]);
    let step = determinism_step(&report);
    assert_eq!(step["status"], "warn", "{report}");
    assert!(step["message"].as_str().unwrap().contains("declared pure"));

    // Declared observed, it varies by design and isn't rerun.
    let mut observed: Value = serde_json::from_slice(&fs::read(&definition).unwrap()).unwrap();
    observed["execution"] = json!({"determinism": "observed"});
    fs::write(&definition, serde_json::to_vec(&observed).unwrap()).unwrap();
    let (report, _) = cli(root.path(), &["check", "-p", "varying", "--no-render", "--trust", "--json"]);
    assert_eq!(determinism_step(&report)["status"], "skip");
}

#[test]
fn determinism_classes_decide_what_the_cache_reuses() {
    let repository = Repository::new("");
    let cache = tempfile::tempdir().unwrap();
    let first = git(repository.path(), &["rev-parse", "HEAD"]);
    fs::write(repository.path().join("file.txt"), "second").unwrap();
    commit(repository.path());
    let definition = repository.path().join(".projections/probe.json");
    let mut probe: Value = serde_json::from_slice(&fs::read(&definition).unwrap()).unwrap();
    // Observed: never reused.
    probe["execution"]["determinism"] = json!("observed");
    fs::write(&definition, serde_json::to_vec(&probe).unwrap()).unwrap();
    let runner = repository.runner().with_cache_in(cache.path()).unwrap();
    let document = runner.show("probe", &first, Some("working-tree")).unwrap();
    assert_eq!(document["provenance"]["execution"]["determinism"], "observed");
    assert!(document["provenance"]["execution"]["at"].as_str().unwrap().ends_with('Z'));
    runner.show("probe", &first, Some("working-tree")).unwrap();
    assert_eq!(runner.cache_hits(), 0);
    assert!(repository.probe_ran());
    // Pure: keyed by the tree alone, so a different granted environment still hits.
    probe["execution"]["determinism"] = json!("pure");
    fs::write(&definition, serde_json::to_vec(&probe).unwrap()).unwrap();
    let runner = repository.runner().with_cache_in(cache.path()).unwrap();
    runner.show("probe", &first, Some("working-tree")).unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let runner = repository
        .runner()
        .with_variables(BTreeMap::from([(
            "PROBE".to_owned(),
            elsewhere.path().join("request.json").to_string_lossy().into_owned(),
        )]))
        .with_cache_in(cache.path())
        .unwrap();
    let pure = runner.show("probe", &first, Some("working-tree")).unwrap();
    assert_eq!(runner.cache_hits(), 1);
    assert_eq!(pure["provenance"]["execution"]["determinism"], "pure");
    // Environmental (the default): another environment is a miss.
    probe["execution"].as_object_mut().unwrap().remove("determinism");
    fs::write(&definition, serde_json::to_vec(&probe).unwrap()).unwrap();
    let runner = repository.runner().with_cache_in(cache.path()).unwrap();
    runner.show("probe", &first, Some("working-tree")).unwrap();
    let runner = repository
        .runner()
        .with_variables(BTreeMap::from([(
            "PROBE".to_owned(),
            elsewhere.path().join("request.json").to_string_lossy().into_owned(),
        )]))
        .with_cache_in(cache.path())
        .unwrap();
    runner.show("probe", &first, Some("working-tree")).unwrap();
    assert_eq!(runner.cache_hits(), 0);
}

#[test]
fn pure_built_ins_give_identical_reruns() {
    let root = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "--template=", "--quiet"]);
    fs::create_dir_all(root.path().join("packages/a")).unwrap();
    fs::create_dir_all(root.path().join(".github/workflows")).unwrap();
    fs::write(
        root.path().join("package.json"),
        r#"{"name":"root","private":true,"workspaces":["packages/*"]}"#,
    )
    .unwrap();
    fs::write(root.path().join("packages/a/package.json"), r#"{"name":"a","version":"1.0.0"}"#).unwrap();
    fs::write(root.path().join("packages/a/index.js"), "// a\nexport const a = 1\n").unwrap();
    fs::write(root.path().join("schema.prisma"), "model User {\n  id Int @id\n}\n").unwrap();
    fs::write(
        root.path().join(".github/workflows/ci.yml"),
        "on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: [{run: echo}]\n  test:\n    needs: build\n    runs-on: ubuntu-latest\n    steps: [{run: echo}]\n",
    )
    .unwrap();
    let definitions = [
        json!({"id":"map","extractor":"repository-map","renderer":"file-packing","inputs":{"lines":true}}),
        json!({"id":"lines","extractor":"code-statistics","renderer":"bar-chart"}),
        json!({"id":"packages","extractor":"workspace-dependencies","renderer":"graph"}),
        json!({"id":"schema","extractor":"prisma-schema","renderer":"entity-relationship"}),
        json!({"id":"jobs","extractor":"github-actions-jobs","renderer":"graph","inputs":{"workflowPath":".github/workflows/ci.yml"}}),
    ];
    fs::create_dir_all(root.path().join(".projections")).unwrap();
    for definition in &definitions {
        fs::write(
            root.path()
                .join(format!(".projections/{}.json", definition["id"].as_str().unwrap())),
            serde_json::to_vec(definition).unwrap(),
        )
        .unwrap();
    }
    let head = commit(root.path());
    let runner = Runner::new(root.path().into(), false).with_executable(env!("CARGO_BIN_EXE_projections"));
    for definition in &definitions {
        let id = definition["id"].as_str().unwrap();
        // From Git objects, in place, and again: always the same extraction.
        let objects = runner.show(id, &head, None).unwrap_or_else(|error| panic!("{id}: {error:#}"));
        assert_eq!(objects["provenance"]["execution"]["determinism"], "pure", "{id}");
        assert_eq!(objects["provenance"]["execution"]["source"], "local-git-objects", "{id}");
        let in_place = runner.show(id, "working-tree", None).unwrap();
        let again = runner.show(id, "working-tree", None).unwrap();
        assert_eq!(objects["digest"], in_place["digest"], "{id}");
        assert_eq!(in_place["digest"], again["digest"], "{id}");
    }
}

/// A repository whose `scoped` projection, a custom extractor, reads
/// `api/schema.txt` (and, when `outside`, also `file.txt`) through the request,
/// with `execution.scope` `["api"]`.
fn scoped_repository(outside: bool) -> (tempfile::TempDir, String) {
    let root = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "--template=", "--quiet"]);
    fs::create_dir_all(root.path().join("api")).unwrap();
    fs::write(root.path().join("api/schema.txt"), "v1").unwrap();
    fs::write(root.path().join("file.txt"), "first").unwrap();
    fs::create_dir_all(root.path().join(".projections")).unwrap();
    let reads = if outside {
        "['api/schema.txt', 'file.txt']"
    } else {
        "['api/schema.txt']"
    };
    let script = format!(
        "const fs = require('fs'), path = require('path'); const request = JSON.parse(fs.readFileSync(0, 'utf8'));
         const label = {reads}.map(file => fs.existsSync(path.join(request.repository.root, file)) ? fs.readFileSync(path.join(request.repository.root, file), 'utf8') : 'missing').join('+');
         process.stdout.write(JSON.stringify({{protocolVersion: 0, schema: 'graph/v0', entities: [{{id: 'schema', kind: 'schema', label}}], relationships: []}}))"
    );
    let node = std::env::var("PROJECTIONS_TEST_NODE").unwrap_or_else(|_| "node".into());
    fs::write(
        root.path().join(".projections/scoped.json"),
        serde_json::to_vec(&json!({"id":"scoped","renderer":"graph",
            "extractor":{"command":[node,"-e",script]},"execution":{"scope":["api"]}}))
        .unwrap(),
    )
    .unwrap();
    let head = commit(root.path());
    (root, head)
}

#[test]
fn a_verified_scope_keys_the_cache_so_edits_outside_it_are_hits() {
    let (root, first) = scoped_repository(false);
    let cache = tempfile::tempdir().unwrap();
    let runner = || {
        Runner::new(root.path().into(), true)
            .with_executable(env!("CARGO_BIN_EXE_projections"))
            .with_cache_in(cache.path())
            .unwrap()
    };
    // Unverified: a commit that changes only a file outside the scope is a miss.
    runner().show("scoped", &first, None).unwrap();
    fs::write(root.path().join("file.txt"), "second").unwrap();
    let second = commit(root.path());
    let unverified = runner();
    unverified.show("scoped", &second, None).unwrap();
    assert_eq!(unverified.cache_hits(), 0);
    // check verifies it; then edits outside the scope are hits.
    let (scope, variation) = runner().verify_scope("scoped").unwrap().unwrap();
    assert_eq!(scope, ["api"]);
    assert!(variation.identical());
    assert_eq!(runner().working_identity("scoped").unwrap()["scopeVerified"], true);
    runner().show("scoped", &second, None).unwrap();
    fs::write(root.path().join("file.txt"), "third").unwrap();
    let third = commit(root.path());
    let verified = runner();
    let document = verified.show("scoped", &third, None).unwrap();
    assert_eq!(verified.cache_hits(), 1);
    assert_eq!(document["provenance"]["execution"]["scope"], json!(["api"]));
    // An edit inside it is a miss.
    fs::write(root.path().join("api/schema.txt"), "v2").unwrap();
    let fourth = commit(root.path());
    let edited = runner();
    let document = edited.show("scoped", &fourth, None).unwrap();
    assert_eq!(edited.cache_hits(), 0);
    assert_eq!(document["extraction"]["entities"][0]["label"], "v2");
}

#[test]
fn a_scope_the_extractor_reads_outside_of_is_not_verified() {
    let (root, _) = scoped_repository(true);
    let runner = Runner::new(root.path().into(), true)
        .with_executable(env!("CARGO_BIN_EXE_projections"))
        .with_cache_base(tempfile::tempdir().unwrap().path());
    let (_, variation) = runner.verify_scope("scoped").unwrap().unwrap();
    assert!(!variation.identical());
    assert!(variation.describe(5).contains("entity schema (/label)"));
    assert_eq!(runner.working_identity("scoped").unwrap()["scopeVerified"], false);
    // check says so.
    let (report, ok) = cli(root.path(), &["check", "-p", "scoped", "--no-render", "--trust", "--json"]);
    let step = report["projections"][0]["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| step["id"] == "scope")
        .unwrap()
        .clone();
    assert_eq!(step["status"], "warn", "{report}");
    assert!(step["message"].as_str().unwrap().contains("reads outside its scope"));
    assert!(ok);
}

#[test]
fn a_built_in_reading_through_the_sdk_enforces_its_scope() {
    let root = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "--template=", "--quiet"]);
    fs::create_dir_all(root.path().join("src")).unwrap();
    fs::create_dir_all(root.path().join(".github/workflows")).unwrap();
    fs::write(root.path().join("src/a.txt"), "a").unwrap();
    fs::write(root.path().join("notes.txt"), "n").unwrap();
    fs::write(
        root.path().join(".github/workflows/ci.yml"),
        "on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: [{run: echo}]\n",
    )
    .unwrap();
    fs::create_dir_all(root.path().join(".projections")).unwrap();
    for definition in [
        json!({"id":"files","extractor":"repository-map","renderer":"file-packing","execution":{"scope":["src"]}}),
        json!({"id":"jobs","extractor":"github-actions-jobs","renderer":"graph",
            "inputs":{"workflowPath":".github/workflows/ci.yml"},"execution":{"scope":["src"]}}),
        json!({"id":"implied","extractor":"github-actions-jobs","renderer":"graph",
            "inputs":{"workflowPath":".github/workflows/ci.yml"}}),
    ] {
        fs::write(
            root.path()
                .join(format!(".projections/{}.json", definition["id"].as_str().unwrap())),
            serde_json::to_vec(&definition).unwrap(),
        )
        .unwrap();
    }
    let head = commit(root.path());
    let cache = tempfile::tempdir().unwrap();
    let runner = Runner::new(root.path().into(), false)
        .with_executable(env!("CARGO_BIN_EXE_projections"))
        .with_cache_in(cache.path())
        .unwrap();
    // Only the scope is listed, from Git objects and in place.
    for revision in [head.as_str(), "working-tree"] {
        let document = runner.show("files", revision, None).unwrap();
        let ids: Vec<&str> = document["extraction"]["entities"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|entity| entity["id"].as_str().filter(|id| id.starts_with("file:")))
            .collect();
        assert_eq!(ids, ["file:src/a.txt"], "{revision}");
        assert_eq!(document["provenance"]["execution"]["scope"], json!(["src"]));
    }
    // A read outside the declared scope fails loudly, naming the path.
    let error = format!("{:#}", runner.show("jobs", &head, None).unwrap_err());
    assert!(
        error.contains(".github/workflows/ci.yml") && error.contains("outside its declared scope"),
        "{error}"
    );
    // A built-in's inputs imply its scope; an edit outside it is a cache hit.
    runner.show("implied", "working-tree", None).unwrap();
    fs::write(root.path().join("notes.txt"), "edited").unwrap();
    let again = Runner::new(root.path().into(), false)
        .with_executable(env!("CARGO_BIN_EXE_projections"))
        .with_cache_in(cache.path())
        .unwrap();
    let document = again.show("implied", "working-tree", None).unwrap();
    assert_eq!(again.cache_hits(), 1);
    assert_eq!(document["provenance"]["execution"]["scope"], json!([".github/workflows/ci.yml"]));
}

/// A repository whose first commit defines a Prisma projection over a schema
/// it doesn't have yet, as acme's `database` did before its API service was
/// added, and whose second commit adds the schema: the two commits.
fn schema_added_later() -> (tempfile::TempDir, String, String) {
    let root = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "--template=", "--quiet"]);
    fs::write(root.path().join("README.md"), "acme\n").unwrap();
    fs::create_dir_all(root.path().join(".projections")).unwrap();
    fs::write(
        root.path().join(".projections/database.json"),
        r#"{"id":"database","title":"API database schema","extractor":"prisma-schema","renderer":"database","inputs":{"schema":"packages/api/prisma/schema.prisma"}}"#,
    )
    .unwrap();
    let first = commit(root.path());
    fs::create_dir_all(root.path().join("packages/api/prisma")).unwrap();
    fs::write(
        root.path().join("packages/api/prisma/schema.prisma"),
        "model User {\n  id Int @id\n  email String @unique\n}\n",
    )
    .unwrap();
    let second = commit(root.path());
    (root, first, second)
}

fn run_cli(root: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_projections"))
        .args(args)
        .current_dir(root)
        .env("PROJECTIONS_CACHE_DIR", root.join(".git/test-cache"))
        .output()
        .unwrap()
}

#[test]
fn a_comparison_across_the_commit_that_adds_a_declared_input_shows_it_added_with_a_notice() {
    let (root, first, second) = schema_added_later();
    let short = |commit: &str| commit[..8].to_owned();
    let changes = |document: &Value| -> Vec<(String, String)> {
        document["comparison"]["changes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|change| {
                (
                    change["id"].as_str().unwrap().to_owned(),
                    change["status"].as_str().unwrap().to_owned(),
                )
            })
            .collect()
    };
    // Missing on the Before side: everything is added.
    let range = format!("{first}..{second}");
    let output = run_cli(root.path(), &["compare", &range, "-p", "database", "--json"]);
    assert!(output.status.success(), "{output:?}");
    let document: Value = serde_json::from_slice(&output.stdout).unwrap();
    let notice = format!(
        "`packages/api/prisma/schema.prisma` doesn't exist at `{}`, so its contents show as added.",
        short(&first)
    );
    assert_eq!(document["notices"], json!([notice]));
    assert!(String::from_utf8_lossy(&output.stderr).contains(&notice));
    let added = changes(&document);
    assert!(!added.is_empty());
    assert!(added.iter().all(|(_, status)| status == "added"), "{added:?}");
    assert_eq!(
        document["before"]["extraction"]["missingInputs"],
        json!(["packages/api/prisma/schema.prisma"])
    );
    assert!(document["after"]["extraction"].get("missingInputs").is_none());
    // Missing on the After side: everything is removed.
    let range = format!("{second}..{first}");
    let output = run_cli(root.path(), &["compare", &range, "-p", "database"]);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(
        text.contains(&format!(
            "Note: `packages/api/prisma/schema.prisma` doesn't exist at `{}`, so its contents show as removed.",
            short(&first)
        )),
        "{text}"
    );
    let output = run_cli(root.path(), &["compare", &range, "-p", "database", "--json"]);
    let document: Value = serde_json::from_slice(&output.stdout).unwrap();
    let removed = changes(&document);
    assert!(!removed.is_empty() && removed.iter().all(|(_, status)| status == "removed"));
    // The saved comparison, with its notice, validates.
    projections_cli::artifact::validate_comparison(&document).unwrap();
    // One revision alone: nothing to show there, said plainly.
    let output = run_cli(root.path(), &["show", &first, "-p", "database"]);
    assert!(output.status.success(), "{output:?}");
    assert!(
        String::from_utf8_lossy(&output.stdout).contains(&format!(
            "Note: Projection `database` has nothing to show at `{}`: `packages/api/prisma/schema.prisma` doesn't exist there.",
            short(&first)
        )),
        "{output:?}"
    );
}

#[test]
fn check_still_fails_when_a_declared_input_is_missing_where_it_checks() {
    let (root, _, _) = schema_added_later();
    fs::remove_file(root.path().join("packages/api/prisma/schema.prisma")).unwrap();
    let (report, ok) = cli(root.path(), &["check", "-p", "database", "--no-render", "--json"]);
    assert!(!ok, "{report}");
    let step = report["projections"][0]["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| step["id"] == "extract")
        .unwrap();
    assert_eq!(step["status"], "fail", "{report}");
    assert!(
        step["message"].as_str().unwrap().contains("`packages/api/prisma/schema.prisma`"),
        "{report}"
    );
}

#[test]
fn a_schema_that_exists_but_does_not_parse_fails_without_the_executables_path() {
    let (root, _, _) = schema_added_later();
    fs::write(root.path().join("packages/api/prisma/schema.prisma"), "model User {\n").unwrap();
    let broken = commit(root.path());
    let runner = Runner::new(root.path().into(), false)
        .with_executable(env!("CARGO_BIN_EXE_projections"))
        .with_cache_base(tempfile::tempdir().unwrap().path());
    let error = runner.show("database", &broken, None).unwrap_err();
    let message = projections_cli::runtime::diagnostic(&error)["message"].as_str().unwrap().to_owned();
    assert!(message.starts_with("Extractor prisma-schema"), "{message}");
    assert!(message.contains("schema.prisma"), "{message}");
    assert!(!message.contains(env!("CARGO_BIN_EXE_projections")), "{message}");
    assert!(!message.contains("exited with"), "{message}");
    // Once: the message isn't followed by the stderr it came from.
    assert_eq!(message.matches("schema.prisma").count(), 1, "{message}");
    let report = projections_cli::diagnostics::report(&error);
    assert!(
        !report["message"].as_str().unwrap().contains(env!("CARGO_BIN_EXE_projections")),
        "{report}"
    );
}

#[test]
fn an_extractor_out_of_time_is_told_about_execution_timeout_ms() {
    let repository = Repository::new("");
    fs::write(
        repository.path().join(".projections/slow.json"),
        serde_json::to_vec(&json!({"id":"slow","renderer":"graph",
            "extractor":{"command":["/bin/sh","-c","/bin/sleep 5"]},"execution":{"timeoutMs":100}}))
        .unwrap(),
    )
    .unwrap();
    let error = repository.runner().show("slow", "working-tree", None).unwrap_err();
    let message = format!("{error:#}");
    assert!(message.contains("timed out after 100 ms"), "{message}");
    assert!(message.contains("execution.timeoutMs"), "{message}");
    let report = projections_cli::diagnostics::report(&error);
    assert!(report["hint"].as_str().unwrap().contains("execution.timeoutMs"), "{report}");
}

#[test]
fn built_in_defaults_stay_addressable_by_id_beside_authored_definitions() {
    let repository = Repository::new("");
    let runner = repository.runner();
    let listed = runner.discover("working-tree").unwrap();
    assert!(listed.iter().all(|definition| definition["id"] != "repository-map"));
    let document = runner.show("repository-map", "working-tree", None).unwrap();
    assert_eq!(document["projection"]["id"], "repository-map");
    // A definition of the repository's own with that ID shadows the default.
    fs::write(
        repository.path().join(".projections/repository-map.json"),
        serde_json::to_vec(&json!({"id":"repository-map","title":"Mine","extractor":"repository-map","renderer":"file-packing"})).unwrap(),
    )
    .unwrap();
    let document = runner.show("repository-map", "working-tree", None).unwrap();
    assert_eq!(document["projection"]["title"], "Mine");
    assert!(runner.show("nothing", "working-tree", None).is_err());
}

#[test]
fn a_definition_revision_too_large_to_copy_copies_only_the_projections_files() {
    let root = tempfile::tempdir().unwrap();
    let root = root.path();
    git(root, &["init", "--template=", "--quiet"]);
    fs::create_dir_all(root.join(".projections/probe")).unwrap();
    fs::write(
        root.join(".projections/probe/extract.sh"),
        format!("cat > /dev/null; printf '%s' '{EXTRACTION}'\n"),
    )
    .unwrap();
    fs::write(
        root.join(".projections/probe.json"),
        serde_json::to_vec(&json!({"id":"probe","renderer":"graph",
            "extractor":{"command":["/bin/sh",".projections/probe/extract.sh"]},"execution":{"scope":["data"]}}))
        .unwrap(),
    )
    .unwrap();
    fs::create_dir_all(root.join("data")).unwrap();
    fs::write(root.join("data/a.txt"), "a").unwrap();
    fs::write(root.join("large.bin"), vec![b'x'; 64 * 1024]).unwrap();
    let definition = commit(root);
    fs::write(root.join("data/a.txt"), "b").unwrap();
    commit(root);
    let output = Command::new(env!("CARGO_BIN_EXE_projections"))
        .args([
            "show",
            "-p",
            "probe",
            "--trust",
            "--json",
            "HEAD",
            "--definition-revision",
            &definition,
        ])
        .current_dir(root)
        .env("PROJECTIONS_CACHE_DIR", root.join(".git/test-cache"))
        .env("PROJECTIONS_MAX_COPY_BYTES", "16384")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "{stdout}{}", String::from_utf8_lossy(&output.stderr));
    let document: Value = serde_json::from_str(&stdout).unwrap();
    let limitations = document["provenance"]["limitations"].to_string();
    assert!(limitations.contains("too large to copy whole (16384 bytes)"), "{limitations}");
}

/// A repository whose `items` projection runs `tools/extract.mjs` (its declared
/// source), which lists `data/items.json`: through `request.repository.root`,
/// or, when `beside`, relative to its working directory. Two commits list `a`,
/// then `a` and `b`; the working tree adds `c`.
fn items_repository(beside: bool, execution: Value) -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "--template=", "--quiet"]);
    fs::create_dir_all(root.path().join("tools")).unwrap();
    fs::create_dir_all(root.path().join("data")).unwrap();
    fs::create_dir_all(root.path().join(".projections")).unwrap();
    let file = if beside {
        "'data/items.json'"
    } else {
        "join(request.repository.root, request.repository.project, 'data/items.json')"
    };
    fs::write(
        root.path().join("tools/extract.mjs"),
        format!(
            "import {{readFileSync}} from 'node:fs'
import {{join}} from 'node:path'
const request = JSON.parse(readFileSync(0, 'utf8'))
const items = JSON.parse(readFileSync({file}, 'utf8'))
process.stdout.write(JSON.stringify({{protocolVersion: 0, schema: 'graph/v0', entities: items.map(id => ({{id: `item:${{id}}`, kind: 'item', label: id}})), relationships: []}}))
"
        ),
    )
    .unwrap();
    let node = std::env::var("PROJECTIONS_TEST_NODE").unwrap_or_else(|_| "node".into());
    let mut definition = json!({"id":"items","renderer":"graph",
        "extractor":{"command":[node,"tools/extract.mjs"],"sources":["tools/extract.mjs"]}});
    if !execution.is_null() {
        definition["execution"] = execution;
    }
    fs::write(
        root.path().join(".projections/items.json"),
        serde_json::to_vec(&definition).unwrap(),
    )
    .unwrap();
    fs::write(root.path().join("data/items.json"), r#"["a"]"#).unwrap();
    commit(root.path());
    fs::write(root.path().join("data/items.json"), r#"["a","b"]"#).unwrap();
    commit(root.path());
    fs::write(root.path().join("data/items.json"), r#"["a","b","c"]"#).unwrap();
    root
}

/// What a comparison of `items` changes, by ID and status.
fn compared_items(root: &Path, range: &str) -> Vec<(String, String)> {
    let output = run_cli(root, &["compare", range, "-p", "items", "--trust", "--json"]);
    assert!(output.status.success(), "{output:?}");
    let document: Value = serde_json::from_slice(&output.stdout).unwrap();
    document["comparison"]["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| {
            (
                change["id"].as_str().unwrap().to_owned(),
                change["status"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

#[test]
fn each_side_of_a_comparison_reads_its_own_revision_through_the_root() {
    for execution in [Value::Null, json!({"determinism": "pure"}), json!({"scope": ["data"]})] {
        let root = items_repository(false, execution.clone());
        // Twice: the second comparison reuses cached extractions, each of its own revision.
        for _ in 0..2 {
            assert_eq!(
                compared_items(root.path(), "HEAD~1..HEAD"),
                [("item:b".to_owned(), "added".to_owned())],
                "{execution}"
            );
            assert_eq!(
                compared_items(root.path(), "HEAD"),
                [("item:c".to_owned(), "added".to_owned())],
                "{execution}"
            );
        }
    }
}

fn own_files_step(report: &Value) -> Value {
    report["projections"][0]["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| step["id"] == "own-files")
        .cloned()
        .unwrap_or_else(|| panic!("no own-files step: {report}"))
}

#[test]
fn check_warns_when_an_extractor_reads_files_beside_it_rather_than_through_the_root() {
    // Read beside it, the file comes from the definition's revision on both
    // sides of a comparison, which then shows no change.
    let root = items_repository(true, Value::Null);
    assert_eq!(compared_items(root.path(), "HEAD~1..HEAD"), []);
    let (report, ok) = cli(root.path(), &["check", "-p", "items", "--no-render", "--trust", "--json"]);
    let step = own_files_step(&report);
    assert_eq!(step["status"], "warn", "{report}");
    let message = step["message"].as_str().unwrap();
    assert!(message.contains("tools/extract.mjs"), "{message}");
    assert!(message.contains("request.repository.root"), "{message}");
    assert!(ok, "the warning doesn't fail check: {report}");

    // Read through the root, it passes.
    let root = items_repository(false, Value::Null);
    let (report, ok) = cli(root.path(), &["check", "-p", "items", "--no-render", "--trust", "--json"]);
    assert_eq!(own_files_step(&report)["status"], "pass", "{report}");
    assert!(ok, "{report}");
}
