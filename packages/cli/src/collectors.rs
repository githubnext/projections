//! Built-in extractors. Each runs as its own process, `projections __extract
//! <id>`, through the same path as a custom extractor's command.

use crate::runtime::Runner;
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::path::Path;

pub use projections_extractor_catalog::{
    IDS, catalog, default_definitions, determinism, per_file_input, reads_files_only, requires_trust, scope,
};

/// The hidden subcommand that runs one built-in extractor.
pub const ENTRYPOINT: &str = "__extract";

/// The argv that runs the built-in extractor `id`: this executable's extractor
/// entrypoint, given this executable's own helper configuration.
pub fn command(runner: &Runner, id: &str) -> Result<Vec<String>> {
    ensure!(
        projections_extractor_catalog::exists(id),
        "No built-in extractor is registered for {id}"
    );
    let mut argv = vec![runner.executable()?.to_string_lossy().into_owned(), ENTRYPOINT.into(), id.into()];
    // The extractor process receives only the declared environment, so this
    // executable tells its own entrypoint where its helpers are.
    if let Some(directory) = crate::assets::collector_override()? {
        argv.extend(["--helpers".into(), directory.to_string_lossy().into_owned()]);
    } else if crate::assets::embedded_helpers()
        && let Ok(cache) = crate::cache::base()
    {
        argv.extend(["--cache-dir".into(), cache.to_string_lossy().into_owned()]);
    }
    Ok(argv)
}

/// Runs a built-in extractor on `root` and returns its normalized extraction.
pub fn collect(root: &Path, definition: &Value, runner: &Runner) -> Result<Value> {
    let id = definition["extractor"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("extractor must name a built-in extractor"))?;
    let argv = command(runner, id)?;
    let extraction = runner.run_extractor(definition, &argv, root, root)?;
    crate::engine("normalize", json!({"extraction":extraction}))
}
