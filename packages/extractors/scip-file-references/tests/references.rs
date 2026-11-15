//! SCIP indexes built with the official bindings, read from a file or written by
//! a stand-in indexer process.

use projections_extractor_scip_file_references::{collect, requires_trust};
use projections_extractor_sdk::{Context, Output, testing};
use protobuf::Message;
use scip::types::{Document, Index, Metadata, Occurrence, SymbolRole, ToolInfo};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

type Runner = dyn Fn(&[String], &Path) -> anyhow::Result<Output> + Send + Sync;

/// What the extractor process is given: trust, the working checkout and how its
/// tools run (by default, they are missing).
struct Process {
    trusted: bool,
    checkout: PathBuf,
    runner: Option<Arc<Runner>>,
}

impl Process {
    fn new(checkout: &Path) -> Self {
        Self {
            trusted: false,
            checkout: checkout.to_owned(),
            runner: None,
        }
    }

    fn context(&self, root: &Path, definition: Value) -> Context {
        let mut request = testing::request(root, definition, self.trusted);
        request["repository"]["checkout"] = json!(self.checkout);
        let runner = self.runner.clone();
        Context::new("scip-file-references", request)
            .unwrap()
            .with_environment(Default::default())
            .with_tools(move |call| match &runner {
                Some(runner) => runner(call.argv, call.cwd),
                None => anyhow::bail!("No such file: {}", call.argv[0]),
            })
    }
}

const LIB: &str = "scip-typescript npm example 1.0.0 src/`lib.ts`/double().";

fn occurrence(line: i32, column: i32, symbol: &str, roles: i32) -> Occurrence {
    Occurrence {
        range: vec![line, column, column + 6],
        symbol: symbol.into(),
        symbol_roles: roles,
        ..Default::default()
    }
}

fn document(path: &str, occurrences: Vec<Occurrence>) -> Document {
    Document {
        relative_path: path.into(),
        occurrences,
        ..Default::default()
    }
}

fn index(version: &str) -> Vec<u8> {
    let lib = LIB.replace("1.0.0", version);
    let definition = SymbolRole::Definition as i32;
    let index = Index {
        metadata: Some(Metadata {
            tool_info: Some(ToolInfo {
                name: "scip-typescript".into(),
                version: "0.3.0".into(),
                ..Default::default()
            })
            .into(),
            project_root: "file:///build/project".into(),
            ..Default::default()
        })
        .into(),
        documents: vec![
            document(
                "src/app.ts",
                vec![
                    occurrence(0, 9, &lib, SymbolRole::Import as i32),
                    occurrence(3, 4, &lib, SymbolRole::ReadAccess as i32),
                    occurrence(3, 4, &lib, 0),
                    occurrence(4, 4, "local 1", 0),
                    occurrence(5, 0, "scip-typescript npm react 18.0.0 `index.d.ts`/useState().", 0),
                ],
            ),
            document("src/lib.ts", vec![occurrence(0, 16, &lib, definition), occurrence(2, 2, &lib, 0)]),
            document("generated/out.ts", vec![occurrence(0, 0, &lib, 0)]),
        ],
        ..Default::default()
    };
    index.write_to_bytes().unwrap()
}

struct Repository(PathBuf);

impl Repository {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("projections-scip-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for file in ["src/app.ts", "src/lib.ts"] {
            fs::create_dir_all(root.join(file).parent().unwrap()).unwrap();
            fs::write(root.join(file), "export {}\n").unwrap();
        }
        Self(root.canonicalize().unwrap())
    }
    fn collect(&self, inputs: Value, host: &Process) -> anyhow::Result<Value> {
        let files = ["src/app.ts".to_owned(), "src/lib.ts".to_owned(), "index.scip".to_owned()];
        let definition = json!({"id":"impact","extractor":"scip-file-references","inputs":inputs});
        collect(&host.context(&self.0, definition).with_files(files.to_vec()))
    }
}

impl Drop for Repository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// A host whose indexer writes `index` to `{output}` or to `index.scip` in its directory.
fn indexer(root: &Path, index: Vec<u8>, calls: Arc<Mutex<Vec<Vec<String>>>>) -> Process {
    let mut host = Process::new(root);
    host.trusted = true;
    host.runner = Some(Arc::new(move |argv: &[String], cwd: &Path| {
        calls.lock().unwrap().push(argv.to_vec());
        let output = match argv.iter().position(|a| a == "--output") {
            Some(i) => PathBuf::from(&argv[i + 1]),
            None => cwd.join("index.scip"),
        };
        fs::write(output, &index)?;
        Ok(Output {
            stdout: String::new(),
            stderr: String::new(),
        })
    }));
    host
}

#[test]
fn indexer_output_becomes_file_reference_graph() {
    let repository = Repository::new("output");
    let calls = Arc::new(Mutex::new(vec![]));
    let host = indexer(&repository.0, index("1.0.0"), calls.clone());
    let inputs = json!({"indexer":["scip-typescript","index","--output","{output}"]});
    assert!(requires_trust(&inputs));
    let extraction = repository.collect(inputs.clone(), &host).unwrap();
    let argv = calls.lock().unwrap()[0].clone();
    assert_eq!(argv[..3], ["scip-typescript", "index", "--output"]);
    assert!(!argv[3].contains("{output}") && !Path::new(&argv[3]).starts_with(&repository.0));
    assert!(!Path::new(&argv[3]).exists(), "the private index is removed");
    assert_eq!(
        extraction["entities"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["file:src%2Fapp.ts", "file:src%2Flib.ts"]
    );
    let relationships = extraction["relationships"].as_array().unwrap();
    assert_eq!(relationships.len(), 1);
    let edge = &relationships[0];
    assert_eq!(edge["id"], "references:src%2Fapp.ts:src%2Flib.ts");
    assert_eq!(
        edge["data"],
        json!({"references":2,"symbolCount":1,"symbols":["scip-typescript npm example src/`lib.ts`/double()."]})
    );
    assert_eq!(edge["evidence"][1]["location"], json!({"line":4,"column":5}));
    assert_eq!(extraction["metadata"]["externalReferences"], 1);
    assert_eq!(extraction["metadata"]["excludedDocuments"], 1);
    assert_eq!(extraction["metadata"]["tool"], json!({"name":"scip-typescript","version":"0.3.0"}));

    // A package version bump alone changes nothing a comparison sees.
    let host = indexer(&repository.0, index("2.0.0"), calls);
    let bumped = repository.collect(inputs, &host).unwrap();
    assert_eq!(bumped["relationships"][0]["data"], edge["data"]);
}

#[test]
fn indexer_default_output_is_read_then_removed_and_never_overwrites() {
    let repository = Repository::new("default");
    fs::create_dir_all(repository.0.join("packages/web/src")).unwrap();
    let host = indexer(&repository.0, index("1.0.0"), Arc::default());
    let inputs = json!({"indexer":["rust-analyzer","scip","."],"root":"packages/web"});
    // Documents are relative to inputs.root, so they are absent from this revision.
    let nested = repository.collect(inputs, &host).unwrap();
    assert_eq!(nested["metadata"]["excludedDocuments"], 3);
    assert!(!repository.0.join("packages/web/index.scip").exists());

    let inputs = json!({"indexer":["rust-analyzer","scip","."]});
    let extraction = repository.collect(inputs.clone(), &host).unwrap();
    assert_eq!(extraction["relationships"].as_array().unwrap().len(), 1);
    assert!(!repository.0.join("index.scip").exists());

    fs::write(repository.0.join("index.scip"), b"committed").unwrap();
    let error = repository.collect(inputs, &host).unwrap_err();
    assert!(error.to_string().contains("already contains index.scip"), "{error}");
}

#[test]
fn running_an_indexer_requires_trust() {
    let repository = Repository::new("trust");
    let mut host = indexer(&repository.0, index("1.0.0"), Arc::default());
    host.trusted = false;
    let error = repository.collect(json!({"indexer":["scip-go"]}), &host).unwrap_err();
    assert!(format!("{error:#}").contains("--trust"), "{error:#}");
}

#[test]
fn an_existing_index_is_read_without_trust_and_must_match_the_revision() {
    let repository = Repository::new("existing");
    let host = Process::new(&repository.0);
    let inputs = json!({"index":"index.scip"});
    assert!(!requires_trust(&inputs));
    fs::write(repository.0.join("index.scip"), index("1.0.0")).unwrap();
    let error = repository.collect(inputs.clone(), &host).unwrap_err();
    assert!(error.to_string().contains("generated/out.ts is absent"), "{error}");

    let mut current = Index::parse_from_bytes(&index("1.0.0")).unwrap();
    current.documents.pop();
    fs::write(repository.0.join("index.scip"), current.write_to_bytes().unwrap()).unwrap();
    let extraction = repository.collect(inputs.clone(), &host).unwrap();
    assert_eq!(extraction["relationships"][0]["data"]["references"], 2);
    assert_eq!(extraction["metadata"]["index"], "index.scip");

    fs::write(repository.0.join("index.scip"), b"\xff\xff\xff").unwrap();
    assert!(repository.collect(inputs, &host).is_err());
}

#[test]
fn inputs_choose_exactly_one_index_source() {
    let repository = Repository::new("inputs");
    let host = Process::new(&repository.0);
    for inputs in [json!({}), json!({"index":"a.scip","indexer":["scip-go"]}), json!({"indexer":[]})] {
        assert!(repository.collect(inputs, &host).is_err());
    }
    let mut traversal = Index::parse_from_bytes(&index("1.0.0")).unwrap();
    traversal.documents[0].relative_path = "../outside.ts".into();
    fs::write(repository.0.join("index.scip"), traversal.write_to_bytes().unwrap()).unwrap();
    assert!(repository.collect(json!({"index":"index.scip"}), &host).is_err());
}

#[test]
fn the_indexer_sees_packages_installed_in_the_checkout_while_it_runs() {
    let repository = Repository::new("links");
    let checkout = Repository::new("links-checkout");
    for directory in ["node_modules/types", "packages/web/node_modules/local", "missing/node_modules"] {
        fs::create_dir_all(checkout.0.join(directory)).unwrap();
    }
    fs::create_dir_all(repository.0.join("packages/web")).unwrap();
    fs::write(repository.0.join("packages/web/index.ts"), "export {}\n").unwrap();
    let seen = Arc::new(Mutex::new(vec![]));
    let mut host = indexer(&checkout.0, index("1.0.0"), Arc::default());
    let observed = seen.clone();
    let write = host.runner.take().unwrap();
    host.runner = Some(Arc::new(move |argv: &[String], cwd: &Path| {
        for link in ["node_modules", "packages/web/node_modules", "missing/node_modules"] {
            let path = cwd.join(link);
            observed.lock().unwrap().push((
                link,
                fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()),
                // Windows reports the link target without the verbatim prefix.
                fs::read_link(&path).ok().map(|target| {
                    if cfg!(windows) {
                        target.canonicalize().unwrap_or(target)
                    } else {
                        target
                    }
                }),
            ));
        }
        write(argv, cwd)
    }));
    let files = ["src/app.ts", "src/lib.ts", "packages/web/index.ts"].map(String::from);
    let definition = json!({"id":"impact","inputs":{"indexer":["scip-typescript","index","--output","{output}"]}});
    collect(&host.context(&repository.0, definition).with_files(files.to_vec())).unwrap();
    let seen = seen.lock().unwrap();
    assert_eq!(seen[0], ("node_modules", true, Some(checkout.0.join("node_modules"))));
    assert_eq!(
        seen[1],
        (
            "packages/web/node_modules",
            true,
            Some(checkout.0.join("packages/web/node_modules"))
        )
    );
    assert_eq!(seen[2], ("missing/node_modules", false, None), "only directories of the revision");
    assert!(fs::symlink_metadata(repository.0.join("node_modules")).is_err());
    assert!(fs::symlink_metadata(repository.0.join("packages/web/node_modules")).is_err());
    assert!(checkout.0.join("node_modules/types").is_dir(), "the checkout is untouched");
}

#[test]
fn relationships_list_at_most_fifty_symbols_and_count_them_all() {
    let repository = Repository::new("cap");
    let definition = SymbolRole::Definition as i32;
    let symbols: Vec<String> = (0..60)
        .map(|i| format!("scip-typescript npm example 1.0.0 src/`lib.ts`/f{i:02}()."))
        .collect();
    let index = Index {
        documents: vec![
            document("src/app.ts", symbols.iter().map(|s| occurrence(1, 0, s, 0)).collect()),
            document("src/lib.ts", symbols.iter().map(|s| occurrence(0, 0, s, definition)).collect()),
        ],
        ..Default::default()
    };
    fs::write(repository.0.join("index.scip"), index.write_to_bytes().unwrap()).unwrap();
    let extraction = repository
        .collect(json!({"index":"index.scip"}), &Process::new(&repository.0))
        .unwrap();
    let data = &extraction["relationships"][0]["data"];
    assert_eq!((data["references"].as_u64(), data["symbolCount"].as_u64()), (Some(60), Some(60)));
    let listed = data["symbols"].as_array().unwrap();
    assert_eq!(listed.len(), 50);
    assert_eq!(listed[0], "scip-typescript npm example src/`lib.ts`/f00().");
    assert_eq!(listed[49], "scip-typescript npm example src/`lib.ts`/f49().");
}
