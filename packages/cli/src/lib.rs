pub mod artifact;
pub mod assets;
pub mod browser;
pub mod cache;
pub mod check;
pub mod ci_artifacts;
pub mod collectors;
pub mod commands;
pub mod comparator_tests;
pub mod definition_file;
pub mod determinism;
pub mod dev_server;
pub mod diagnostics;
pub mod docs;
pub mod doctor;
pub mod environment;
pub mod explore;
pub mod extract;
pub mod extraction_cache;
pub mod fixtures;
pub mod generation_store;
pub mod headless;
pub mod help_text;
pub mod history;
pub mod json_text;
pub mod mcp;
pub mod onboard;
pub mod project;
pub mod pull_request;
pub mod python;
pub mod reference;
pub mod render;
pub mod renderer_builds;
pub mod runtime;
pub mod scaffold;
pub mod service;
pub mod signals;
pub mod skill;
pub mod snapshot;
pub mod stdio;
pub(crate) mod supervision;
pub mod sweep;
pub mod tools;
pub mod view;
pub mod workspace;
pub mod workspaces;

use anyhow::{Result, bail};
use serde_json::{Value, json};

pub fn engine(operation: &str, fields: Value) -> Result<Value> {
    let mut request = fields
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("Engine fields must be an object"))?
        .clone();
    request.insert("version".into(), json!(projections_engine::ABI_VERSION));
    request.insert("operation".into(), json!(operation));
    let response = projections_engine::handle(&serde_json::to_vec(&request)?);
    if response["ok"] != true {
        bail!("Engine rejected input: {}", response["diagnostics"]);
    }
    Ok(response["result"].clone())
}

/// Writes `bytes` to a new file, never replacing one; a failed write leaves no file.
pub fn create_file(path: &std::path::Path, bytes: &[u8]) -> Result<()> {
    use anyhow::Context;
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).with_context(|| format!("Cannot create {}", path.display()))?;
    if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err(error).with_context(|| format!("Cannot write {}", path.display()));
    }
    Ok(())
}
