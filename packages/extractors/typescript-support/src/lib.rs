//! Runs the Node extractor helper this package builds, for the built-in
//! TypeScript compiler extractors (`typescript-public-api` and `nestjs-di`).

use anyhow::{Result, ensure};
use projections_extractor_sdk::{Context, MAX_REQUEST_BYTES, execute_reporting, parse_json};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

/// Runs the Node helper shipped with Projections for the TypeScript compiler
/// extractors.
///
/// These extractors examine Node projects, so they use the project's own Node.js
/// (`node` on PATH) and its own installed `typescript` package, resolved
/// from the repository checkout. The helper itself is one self-contained file that
/// needs nothing else; Projections never installs packages.
pub fn node_helper(cx: &Context) -> Result<Value> {
    node_helper_with(cx, cx.request())
}

/// [`node_helper`] with `request` in place of the context's own, for example one
/// whose declared inputs leave out what the revision lacks ([`present_inputs`]).
pub fn node_helper_with(cx: &Context, request: &Value) -> Result<Value> {
    let id = cx.extractor().to_owned();
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("dist/extractor.mjs");
    let helper = cx.helper("helpers/node/extractor.mjs", source)?;
    ensure!(
        helper.is_file(),
        "{id} requires the Node extractor helper shipped with Projections ({}); this distribution is incomplete. \
         In a source checkout, build it with `npm run build --workspace @githubnext/projections-typescript-support`",
        helper.display()
    );
    let path = cx.environment(&[]).get("PATH").cloned().unwrap_or_default();
    ensure!(
        std::env::split_paths(&path).any(|directory| ["node", "node.exe"].iter().any(|name| directory.join(name).is_file())),
        "{id} examines a Node project with the repository's own Node.js 20 or newer, \
         which was not found on PATH. Install Node.js as the project's own build does"
    );
    let checkout = cx.checkout()?;
    let request = serde_json::to_string(request)?;
    ensure!(request.len() <= MAX_REQUEST_BYTES, "Extractor request exceeds 2 MiB");
    let argv = vec![
        "node".into(),
        helper.to_string_lossy().into_owned(),
        id,
        checkout.to_string_lossy().into_owned(),
    ];
    let output = execute_reporting(cx, cx.root(), argv, Some(&request), BTreeMap::new(), false)?;
    parse_json(&output)
}

/// The request with only the declared `tsconfig`, `tsconfigs` and `entrypoints`
/// the examined revision has, or `None` when it has none of them (the project
/// predates them). Each one it lacks is recorded as a missing input.
pub fn present_inputs(cx: &Context) -> Result<Option<Value>> {
    let mut request = cx.request().clone();
    let inputs = &mut request["projection"]["definition"]["inputs"];
    let (mut declared, mut present) = (0, 0);
    let mut keep = |cx: &Context, value: &Value| -> Result<bool> {
        let Some(path) = value.as_str() else {
            return Ok(true);
        };
        declared += 1;
        let exists = cx.input_exists(path)?;
        present += usize::from(exists);
        Ok(exists)
    };
    if let Some(tsconfig) = inputs.get("tsconfig").cloned()
        && !keep(cx, &tsconfig)?
    {
        inputs.as_object_mut().map(|inputs| inputs.remove("tsconfig"));
    }
    for name in ["tsconfigs", "entrypoints"] {
        match inputs.get_mut(name) {
            Some(Value::Array(items)) => {
                let mut kept = vec![];
                for item in items.drain(..) {
                    if keep(cx, &item)? {
                        kept.push(item);
                    }
                }
                *items = kept;
            }
            Some(Value::Object(entries)) => {
                let mut kept = serde_json::Map::new();
                for (key, value) in std::mem::take(entries) {
                    if keep(cx, &value)? {
                        kept.insert(key, value);
                    }
                }
                *entries = kept;
            }
            _ => {}
        }
        if inputs
            .get(name)
            .is_some_and(|value| value.as_array().is_some_and(Vec::is_empty) || value.as_object().is_some_and(serde_json::Map::is_empty))
        {
            inputs.as_object_mut().map(|inputs| inputs.remove(name));
        }
    }
    Ok((declared == 0 || present > 0).then_some(request))
}
