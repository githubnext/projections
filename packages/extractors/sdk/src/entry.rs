use crate::Context;
use crate::context::bounded;
use anyhow::Result;
use serde_json::Value;
use std::io::Write;
use std::process::ExitCode;

/// Error text stays well inside the runner's 64 KiB stderr bound.
const MAX_ERROR_BYTES: usize = 16 * 1024;

/// Runs an extractor process: reads the request on stdin, calls `collect` and
/// writes its extraction on stdout, or its failure on stderr with a nonzero exit.
///
/// ```no_run
/// use projections_extractor_sdk::{Context, extraction, key, read_source, relationship};
/// use serde_json::json;
///
/// fn main() -> std::process::ExitCode {
///     projections_extractor_sdk::main("flags", |cx: &Context| {
///         let mut entities = vec![];
///         let mut relationships = vec![];
///         for file in cx.files()?.iter().filter(|file| file.ends_with("flags.txt")) {
///             let owner = format!("file:{file}");
///             entities.push(json!({"id": owner, "kind": "file", "label": file}));
///             for flag in read_source(cx.root(), file)?.lines().filter(|line| !line.is_empty()) {
///                 let id = key(&["flag", flag]);
///                 entities.push(json!({"id": id, "kind": "flag", "label": flag}));
///                 relationships.push(relationship("declares", &owner, &id));
///             }
///         }
///         Ok(extraction("graph/v0", entities, relationships, None))
///     })
/// }
/// ```
pub fn main(extractor: &str, collect: impl FnOnce(&Context) -> Result<Value>) -> ExitCode {
    serve(Context::read(extractor), collect)
}

/// [`main`] for a context the caller prepared, for example with its helper
/// directory.
pub fn serve(context: Result<Context>, collect: impl FnOnce(&Context) -> Result<Value>) -> ExitCode {
    let (result, diagnostics) = match context {
        Ok(cx) => (
            collect(&cx).and_then(|value| Ok(serde_json::to_string(&cx.finish(value))?)),
            cx.diagnostics(),
        ),
        Err(error) => (Err(error), String::new()),
    };
    let mut stderr = std::io::stderr().lock();
    let code = match result {
        Ok(extraction) => {
            let mut stdout = std::io::stdout().lock();
            match stdout.write_all(extraction.as_bytes()).and_then(|()| stdout.flush()) {
                Ok(()) => ExitCode::SUCCESS,
                Err(_) => ExitCode::FAILURE,
            }
        }
        Err(error) => {
            // The failure comes first: runners show the beginning of stderr.
            let _ = writeln!(stderr, "{}", bounded(&format!("{error:#}"), MAX_ERROR_BYTES));
            ExitCode::FAILURE
        }
    };
    let _ = stderr.write_all(diagnostics.as_bytes());
    code
}
