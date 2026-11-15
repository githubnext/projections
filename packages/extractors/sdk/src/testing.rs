//! Contexts and golden-file helpers for extractor tests.
//!
//! Enabled by the `testing` feature, which only extractor dev-dependencies use.

use crate::{Context, Output};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// The request a runner sends for `definition` examining `root`, with `root` as
/// the working checkout.
pub fn request(root: &Path, definition: Value, trusted: bool) -> Value {
    json!({
        "protocolVersion": 0,
        "projection": {"id": definition["id"].as_str().unwrap_or("test"), "definition": definition},
        "repository": {
            "root": root,
            "checkout": root,
            "revision": {"kind": "working-tree", "ref": "working-tree", "commit": "0000000000000000000000000000000000000000", "dirty": false}
        },
        "capabilities": {"trusted": trusted, "network": false}
    })
}

/// An untrusted context for the extractor named by `definition` examining
/// `root`, with an empty environment and no tools: running one fails as a
/// missing tool does.
pub fn context(root: &Path, definition: Value) -> Context {
    with_trust(root, definition, false)
}

/// [`context`], trusted.
pub fn trusted(root: &Path, definition: Value) -> Context {
    with_trust(root, definition, true)
}

fn with_trust(root: &Path, definition: Value, trusted: bool) -> Context {
    let extractor = definition["extractor"].as_str().unwrap_or("test").to_owned();
    Context::new(&extractor, request(root, definition, trusted))
        .unwrap()
        .with_environment(Default::default())
        .with_tools(|invocation| {
            let missing = std::io::Error::new(std::io::ErrorKind::NotFound, "No such file");
            Err(anyhow::Error::new(missing).context(format!("Could not start {}", invocation.argv[0])))
        })
}

/// A stand-in for a tool: argv and working directory in, output out.
pub type Runner = dyn Fn(&[String], &Path) -> anyhow::Result<Output> + Send + Sync;

/// What a runner gives an extractor process, for tests: trust, the working
/// checkout and how tools run (by default they are missing). The environment is
/// empty.
pub struct Process {
    pub trusted: bool,
    pub checkout: PathBuf,
    pub runner: Option<Arc<Runner>>,
}

impl Process {
    /// An untrusted process whose working checkout is `checkout`.
    pub fn new(checkout: &Path) -> Self {
        Self {
            trusted: false,
            checkout: checkout.to_path_buf(),
            runner: None,
        }
    }

    /// The context for `definition` examining `root`.
    pub fn context(&self, root: &Path, definition: Value) -> Context {
        let extractor = definition["extractor"].as_str().unwrap_or("test").to_owned();
        let mut request = request(root, definition, self.trusted);
        request["repository"]["checkout"] = json!(self.checkout);
        let runner = self.runner.clone();
        Context::new(&extractor, request)
            .unwrap()
            .with_environment(Default::default())
            .with_tools(move |call| match &runner {
                Some(runner) => runner(call.argv, call.cwd),
                None => {
                    let missing = std::io::Error::new(std::io::ErrorKind::NotFound, "No such file");
                    Err(anyhow::Error::new(missing).context(format!("Could not start {}", call.argv[0])))
                }
            })
    }
}

/// Compares `actual` with the JSON golden file, rewriting it when
/// `PROJECTIONS_UPDATE_GOLDEN=1`.
pub fn golden(path: &Path, actual: &Value) {
    let rendered = format!("{}\n", serde_json::to_string_pretty(actual).unwrap());
    if std::env::var("PROJECTIONS_UPDATE_GOLDEN").as_deref() == Ok("1") {
        fs::write(path, &rendered).unwrap();
        return;
    }
    let expected = fs::read_to_string(path).unwrap_or_else(|error| {
        panic!(
            "Cannot read golden file {} ({error}); set PROJECTIONS_UPDATE_GOLDEN=1 to create it",
            path.display()
        )
    });
    let expected: Value = serde_json::from_str(&expected).unwrap();
    assert!(
        &expected == actual,
        "{} differs from the extraction; set PROJECTIONS_UPDATE_GOLDEN=1 to accept:\n{rendered}",
        path.display()
    );
}
