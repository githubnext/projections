//! Generated values end to end: the runner's generation store, filled from
//! validated extractions and handed to extractors as a snapshot, so an equal
//! basis reuses the stored text; comparisons across a basis change; and what
//! `check` says about them.

#![cfg(unix)]

use projections_cli::runtime::Runner;
use serde_json::{Value, json};
use std::{fs, path::Path, process::Command};

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "user.name=Generated",
            "-c",
            "user.email=generated@example.invalid",
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

/// An extractor that "summarizes" `class.txt` with the model named in
/// `model.txt`: its wording includes its process ID, as a model's varies,
/// unless the generation store's snapshot holds a value for the basis.
const SUMMARIZE: &str = r#"
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
const request = JSON.parse(readFileSync(0, 'utf8'))
const read = name => readFileSync(`${request.repository.root}/${name}`, 'utf8').trim()
const sha = text => `sha256:${createHash('sha256').update(text).digest('hex')}`
const canonical = value => `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(',')}}`
const basis = {input: sha(read('class.txt')), prompt: sha('Summarize.'), model: read('model.txt')}
const stored = new Map()
if (request.generations) for (const line of readFileSync(request.generations.file, 'utf8').split('\n').filter(Boolean)) {
  const entry = JSON.parse(line)
  stored.set(`${entry.path} ${entry.basis}`, entry.value)
}
const summary = stored.get(`/data/summary ${sha(canonical(basis))}`) ?? `Summary ${process.pid} of ${read('class.txt')}.`
process.stdout.write(JSON.stringify({protocolVersion: 0, schema: 'graph/v0', relationships: [],
  volatile: [{kinds: ['class'], path: '/data/summary', generated: true, basis: '/data/summaryBasis'}],
  entities: [{id: 'cart', kind: 'class', label: 'Cart', data: {summary, summaryBasis: basis}}]}))
"#;

struct Repository {
    root: tempfile::TempDir,
    cache: tempfile::TempDir,
}

impl Repository {
    fn new(determinism: &str) -> Self {
        let root = tempfile::tempdir().unwrap();
        git(root.path(), &["init", "--template=", "--quiet"]);
        fs::create_dir_all(root.path().join(".projections")).unwrap();
        fs::write(root.path().join("summarize.mjs"), SUMMARIZE).unwrap();
        fs::write(root.path().join("class.txt"), "class Cart { add() {} }").unwrap();
        fs::write(root.path().join("model.txt"), "fake@1").unwrap();
        fs::write(
            root.path().join(".projections/summaries.json"),
            serde_json::to_vec(&json!({"id": "summaries", "renderer": "graph",
                "extractor": {"command": ["node", "summarize.mjs"], "sources": ["summarize.mjs"]},
                "execution": {"determinism": determinism}}))
            .unwrap(),
        )
        .unwrap();
        commit(root.path());
        Self {
            root,
            cache: tempfile::tempdir().unwrap(),
        }
    }

    fn path(&self) -> &Path {
        self.root.path()
    }

    fn runner(&self) -> Runner {
        Runner::new(self.path().into(), true)
            .with_executable(env!("CARGO_BIN_EXE_projections"))
            .with_cache_base(self.cache.path())
    }
}

fn summary(document: &Value) -> &str {
    document["extraction"]["entities"][0]["data"]["summary"].as_str().unwrap()
}

#[test]
fn an_equal_basis_reuses_the_stored_text_and_provenance_says_so() {
    let repository = Repository::new("environmental");
    let runner = repository.runner();
    let first = runner.show("summaries", "HEAD", None).unwrap();
    assert_eq!(first["provenance"]["generated"], json!({"values": 1, "reused": 0, "sources": []}));
    let second = runner.show("summaries", "HEAD", None).unwrap();
    assert_eq!(summary(&second), summary(&first));
    assert_eq!(second["digest"], first["digest"]);
    assert_eq!(
        second["provenance"]["generated"],
        json!({"values": 1, "reused": 1, "sources": ["local"]})
    );
    // --regenerate hands the extractor no snapshot: new wording, still
    // expected variation, and the store keeps the first text.
    let fresh = runner.clone().with_regenerate(true).show("summaries", "HEAD", None).unwrap();
    assert_ne!(summary(&fresh), summary(&first));
    let variation = projections_cli::determinism::variation(&first, &fresh).unwrap();
    assert!(variation.reproducible() && variation.regenerated == 1);
    let again = runner.show("summaries", "HEAD", None).unwrap();
    assert_eq!(summary(&again), summary(&first));
}

#[test]
fn a_comparison_across_a_basis_change_says_which_part_moved() {
    let repository = Repository::new("environmental");
    let base = git(repository.path(), &["rev-parse", "HEAD"]);
    fs::write(repository.path().join("class.txt"), "class Cart { add() {} clear() {} }").unwrap();
    let edited = commit(repository.path());
    fs::write(repository.path().join("model.txt"), "fake@2").unwrap();
    let upgraded = commit(repository.path());
    let runner = repository.runner();

    let changes =
        |before: &str, after: &str| -> Value { runner.compare("summaries", before, after).unwrap()["comparison"]["changes"].clone() };
    assert_eq!(
        changes(&base, &edited),
        json!([{"id": "cart", "collection": "entities", "before": ["cart"], "after": ["cart"],
            "status": "modified", "correspondence": "exact",
            "varied": [{"path": "/data/summary", "within": false, "generated": true, "because": ["input"]}]}])
    );
    assert_eq!(changes(&edited, &upgraded)[0]["varied"][0]["because"], json!(["model"]));
    // The same commit compared with itself from the store: nothing changed.
    assert_eq!(changes(&base, &base), json!([]));
}

#[test]
fn check_passes_a_reworded_rerun_and_warns_about_pure_generated_values() {
    let repository = Repository::new("environmental");
    let check = |args: &[&str]| -> Value {
        let output = Command::new(env!("CARGO_BIN_EXE_projections"))
            .args(["check", "-p", "summaries", "--no-render", "--trust", "--json"])
            .args(args)
            .current_dir(repository.path())
            .env("PROJECTIONS_CACHE_DIR", repository.cache.path())
            .output()
            .unwrap();
        let report: Value =
            serde_json::from_slice(&output.stdout).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&output.stderr)));
        report["projections"][0]["steps"]
            .as_array()
            .unwrap()
            .iter()
            .find(|step| step["id"] == "determinism")
            .unwrap()
            .clone()
    };
    // The rerun reuses the first run's text: identical.
    let step = check(&["--strict-determinism"]);
    assert_eq!(step["status"], "pass", "{step}");
    assert!(step["message"].as_str().unwrap().contains("A rerun matched"), "{step}");
    // Regenerated, it is reworded from the same inputs: still reproducible.
    let step = check(&["--strict-determinism", "--regenerate"]);
    assert_eq!(step["status"], "pass", "{step}");
    assert!(
        step["message"]
            .as_str()
            .unwrap()
            .contains("1 generated value was regenerated from the same inputs"),
        "{step}"
    );

    let pure = Repository::new("pure");
    fs::copy(
        pure.path().join(".projections/summaries.json"),
        repository.path().join(".projections/summaries.json"),
    )
    .unwrap();
    let step = check(&[]);
    assert_eq!(step["status"], "warn", "{step}");
    assert!(step["message"].as_str().unwrap().contains("produces generated values"), "{step}");
}
