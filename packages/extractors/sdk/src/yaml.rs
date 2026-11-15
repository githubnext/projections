//! YAML input read into JSON with yaml-rust2, a parser written in safe Rust.
//!
//! Values read as they did with serde_yaml 0.9, which the extractors used
//! before: plain scalars resolve by YAML 1.2's core schema (see [`scalar`]),
//! anchors and aliases expand, `<<` is an ordinary key (no merging), and a
//! document nests at most 128 levels. Aliases may jump at most 100 times per
//! event of their document, which bounds alias bombs. Duplicate mapping keys,
//! nonfinite numbers, local tags (`!name`) and keys JSON can't hold are
//! rejected.

mod build;
mod scalar;

use anyhow::{Context, Result, bail};
use build::Document;
use serde_json::Value;

/// Parses one YAML document into JSON, rejecting duplicate keys and nonfinite numbers.
pub fn parse_yaml(source: &str, label: &str) -> Result<Value> {
    let mut documents = Document::stream(source);
    let document = documents.next().unwrap_or_else(|| Ok(Document::default()));
    let node = document
        .and_then(|document| document.root())
        .with_context(|| format!("Invalid YAML in {label}"))?;
    if documents.next().is_some() {
        bail!("Invalid YAML in {label}: a YAML stream with more than one document isn't supported");
    }
    node.into_json()
        .with_context(|| format!("YAML keys in {label} must be JSON-compatible"))
}

/// Parses every document of a multi-document YAML stream into JSON, in order.
/// Empty documents (such as a trailing `---`) become `null`.
pub fn parse_yaml_documents(source: &str, label: &str) -> Result<Vec<Value>> {
    Document::stream(source)
        .enumerate()
        .map(|(index, document)| {
            let node = document
                .and_then(|document| document.root())
                .with_context(|| format!("Invalid YAML in {label} (document {})", index + 1))?;
            node.into_json()
                .with_context(|| format!("YAML keys in {label} must be JSON-compatible"))
        })
        .collect()
}

#[cfg(test)]
mod tests;
