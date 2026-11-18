//! `projections __extract <id>`: one built-in extractor, run as its own process.
//!
//! The runner starts built-in extractors exactly as it starts custom ones: as a
//! supervised process that reads the public extractor request on stdin and writes
//! one extraction on stdout, with diagnostics on stderr. This entrypoint is that
//! process for the extractors compiled into this executable, written with the
//! public extractor SDK as any Rust extractor would be.

use projections_extractor_sdk::{ComparisonRequest, Context};
use std::path::PathBuf;
use std::process::ExitCode;

/// Where this executable's helpers are: an explicit directory, or the embedded
/// set unpacked into the cache under an explicit or the default per-user base.
pub struct Helpers {
    pub directory: Option<PathBuf>,
    pub cache: Option<PathBuf>,
}

/// Runs the built-in extractor `id` on the request read from stdin.
pub fn main(id: &str, helpers: Helpers) -> ExitCode {
    let context = Context::read(id).map(|cx| {
        cx.with_helpers(move || match &helpers.directory {
            Some(directory) => Ok(Some(directory.clone())),
            None => crate::assets::collector_directory_in(helpers.cache.as_deref()),
        })
        .with_comparisons(compare)
    });
    projections_extractor_sdk::serve(context, |cx| projections_extractor_catalog::collect(id, cx))
}

/// Compares for a built-in extractor exactly as for a projection: the default
/// comparator module or a comparator file, run in the comparator runtime's
/// sandbox and validated by the Engine. Comparator files are data, so this runs
/// no repository code.
fn compare(request: &ComparisonRequest<'_>) -> anyhow::Result<serde_json::Value> {
    match request.file {
        Some((path, rules)) => crate::artifact::run_custom_comparator(path, rules, request.before, request.after, request.options)
            .map(|(comparison, _)| comparison),
        None => crate::artifact::default_comparison(request.before, request.after, request.options),
    }
}
