//! rustdoc JSON (format 61) to `api/v0`: every item reachable from the crate
//! root through public modules and re-exports, with its signature and the
//! contract facts the Cargo SemVer reference's rules inspect, in the
//! language-neutral terms of `packages/schemas/src/domains.ts`; the Rust-only ones are
//! in `contract.native` (see the README).

mod builder;
mod contract;
mod function;
mod generics;
mod impls;
mod items;
mod rustdoc;
mod structures;
mod traits;
mod types;

use anyhow::{Context, Result, ensure};
use builder::Builder;
use contract::api_contract;
use projections_extractor_sdk::extraction;
use rustdoc::key;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::ops::RangeInclusive;

/// The rustdoc JSON format versions this converter reads.
pub const FORMAT_VERSIONS: RangeInclusive<u64> = 61..=61;

/// Converts a rustdoc JSON document; `base` is the directory (relative to the
/// repository root) its span file names are relative to.
pub fn api(document: &Value, base: &str) -> Result<Value> {
    let version = document["format_version"]
        .as_u64()
        .context("rustdoc JSON has no `format_version`")?;
    ensure!(
        FORMAT_VERSIONS.contains(&version),
        "rustdoc JSON format `{version}` is not supported; `rust-public-api` reads formats `{}`–`{}` (rustdoc from `nightly-2026-09-17`). Pin a matching nightly with `inputs.toolchain`",
        FORMAT_VERSIONS.start(),
        FORMAT_VERSIONS.end()
    );
    let index = document["index"].as_object().context("rustdoc JSON has no index")?;
    let root = key(&document["root"])?;
    let crate_item = index.get(&root).context("rustdoc JSON root is missing")?;
    let name = crate_item["name"].as_str().context("rustdoc JSON crate has no name")?;
    let mut builder = Builder {
        index,
        paths: document["paths"].as_object(),
        base,
        reachable: BTreeSet::new(),
        entities: BTreeMap::new(),
        relationships: Vec::new(),
        emitted: BTreeMap::new(),
    };
    builder.reach(&root, &mut BTreeSet::new());
    let crate_id = format!("rust:{name}");
    builder.entity(
        &crate_id,
        "crate",
        name,
        format!("crate {name}"),
        api_contract("package", "crate", json!({})),
        crate_item,
    );
    builder.module(crate_item, &crate_id, name, &mut BTreeSet::new())?;
    let mut entities: Vec<Value> = builder.entities.into_values().collect();
    entities.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    let mut relationships = builder.relationships;
    relationships.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    relationships.dedup_by(|a, b| a["id"] == b["id"]);
    let mut metadata = json!({"ecosystem": "rust", "crate": name, "rustdocFormat": version});
    if let Some(crate_version) = document["crate_version"].as_str() {
        metadata["crateVersion"] = json!(crate_version);
    }
    Ok(extraction("api/v0", entities, relationships, Some(metadata)))
}
