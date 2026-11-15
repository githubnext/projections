//! Extraction documents: validation and provenance.

use anyhow::{Context, Result, ensure};
use serde_json::{Map, Value, json};

use super::{
    fields, identifier, object, text, validate_definition, validate_execution,
    values::{hex, reproducibility, strings},
};

pub(super) fn revision(value: &Value) -> Result<Value> {
    fields(value, &["kind", "ref", "commit", "dirty"], "provenance.revision")?;
    let kind = value["kind"].as_str().context("Unsupported repository revision kind")?;
    ensure!(matches!(kind, "commit" | "working-tree"), "Unsupported repository revision kind");
    let commit = text(&value["commit"], "repository commit")?;
    let dirty = value["dirty"]
        .as_bool()
        .context("Revision requires an immutable Git commit and actual dirty flag")?;
    ensure!(
        hex(commit, &[40, 64]),
        "Revision requires an immutable Git commit and actual dirty flag"
    );
    let reference = text(&value["ref"], "repository ref")?;
    if kind == "commit" {
        ensure!(
            !dirty && reference == commit,
            "Commit extraction provenance must be clean and use its immutable commit as ref"
        );
    } else {
        ensure!(reference == "working-tree", "Working-tree provenance must use working-tree ref");
    }
    Ok(json!({"kind": kind, "ref": reference, "commit": commit, "dirty": dirty}))
}

pub(super) fn sha256_digest(value: &Value, label: &str) -> Result<String> {
    let digest = value.as_str().with_context(|| format!("{label} must be sha256:<lowercase hex>"))?;
    ensure!(
        digest.strip_prefix("sha256:").is_some_and(|hex_digest| hex(hex_digest, &[64])),
        "{label} must be sha256:<lowercase hex>"
    );
    Ok(digest.to_owned())
}

/// The extractor identity a definition records in provenance.
pub fn extractor_id(definition: &Value) -> &str {
    definition["extractor"].as_str().unwrap_or("executable")
}

/// Validates a saved extraction (`projections.extraction` version 0).
pub fn validate_extraction(value: &Value) -> Result<Value> {
    fields(
        value,
        &["format", "version", "projection", "extraction", "provenance", "digest"],
        "Extraction document",
    )?;
    ensure!(
        value["format"] == "projections.extraction" && value["version"].as_f64() == Some(0.0),
        "Unsupported extraction document format/version"
    );
    fields(&value["projection"], &["id", "title", "renderer"], "projection")?;
    let provenance = &value["provenance"];
    fields(
        provenance,
        &[
            "revision",
            "extractor",
            "definition",
            "definitionDigest",
            "reproducibility",
            "limitations",
            "toolchain",
            "execution",
            "generated",
        ],
        "provenance",
    )?;
    fields(&provenance["extractor"], &["id", "version"], "extractor")?;
    let definition = validate_definition(&provenance["definition"])?;
    let metadata = json!({
        "id": identifier(&value["projection"]["id"], "projection.id")?,
        "title": text(&value["projection"]["title"], "projection.title")?,
        "renderer": definition["renderer"],
    });
    let title = definition.get("title").unwrap_or(&definition["id"]);
    ensure!(
        definition["id"] == metadata["id"] && definition["renderer"] == value["projection"]["renderer"] && title == &metadata["title"],
        "Extraction projection metadata differs from its definition"
    );
    let extractor = text(&provenance["extractor"]["id"], "extractor.id")?;
    ensure!(
        extractor == extractor_id(&definition),
        "Extractor provenance differs from the definition"
    );
    let mut normalized_provenance = json!({
        "revision": revision(&provenance["revision"])?,
        "definition": definition,
        "definitionDigest": sha256_digest(&provenance["definitionDigest"], "provenance.definitionDigest")?,
        "extractor": {
            "id": extractor,
            "version": text(&provenance["extractor"]["version"], "extractor.version")?,
        },
        "reproducibility": reproducibility(&provenance["reproducibility"], "provenance reproducibility")?,
        "limitations": strings(&provenance["limitations"], "limitations")?,
    });
    if let Some(toolchain) = provenance.get("toolchain") {
        let mut normalized = Map::new();
        for (name, version) in object(toolchain, "toolchain")? {
            text(&json!(name), "toolchain name")?;
            normalized.insert(name.clone(), json!(text(version, "toolchain version")?));
        }
        normalized_provenance["toolchain"] = Value::Object(normalized);
    }
    if let Some(execution) = provenance.get("execution") {
        normalized_provenance["execution"] = validate_execution(execution)?;
    }
    if let Some(generated) = provenance.get("generated") {
        normalized_provenance["generated"] = validate_generated(generated)?;
    }
    let extraction = crate::engine("normalize", json!({"extraction": value["extraction"]}))?;
    let canonical = crate::engine("canonicalize", json!({"extraction": extraction}))?;
    let digest = value["digest"]
        .as_str()
        .context("Extraction digest mismatch: the document has no digest")?;
    ensure!(
        hex(digest, &[64]) && canonical["digest"].as_str() == Some(digest),
        "Extraction digest mismatch: {DIGEST_MISMATCH}"
    );
    Ok(json!({
        "format": "projections.extraction", "version": 0,
        "projection": metadata, "extraction": extraction,
        "provenance": normalized_provenance, "digest": digest,
    }))
}

/// Why a saved extraction's digest doesn't match it, and what to do instead.
pub const DIGEST_MISMATCH: &str = "its extraction was changed after it was saved. To use a hand-edited extraction, name its projection with -p ID (compare --before-extraction … -p ID, show --from … -p ID): the extraction is then taken as extractor output and digested again";

/// The largest integer JavaScript represents exactly.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// `provenance.generated`: how many generated values the extraction holds, how
/// many the generation store supplied, and from which stores.
fn validate_generated(value: &Value) -> Result<Value> {
    fields(value, &["values", "reused", "sources"], "provenance.generated")?;
    let count = |key: &str| {
        value[key]
            .as_u64()
            .filter(|count| *count <= MAX_SAFE_INTEGER)
            .with_context(|| format!("provenance.generated.{key} must be a nonnegative integer"))
    };
    let (values, reused) = (count("values")?, count("reused")?);
    ensure!(reused <= values, "provenance.generated.reused can't exceed its values");
    let mut sources = Vec::new();
    for source in value["sources"]
        .as_array()
        .context("provenance.generated.sources must be an array")?
    {
        let source = source
            .as_str()
            .filter(|source| ["local", "ci"].contains(source))
            .context("provenance.generated.sources are local or ci")?;
        ensure!(!sources.contains(&source), "provenance.generated.sources are listed once");
        sources.push(source);
    }
    sources.sort();
    Ok(json!({"values": values, "reused": reused, "sources": sources}))
}
