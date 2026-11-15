//! Prisma schema.
//!
//! Prisma schema files are parsed natively by this crate's own Prisma Schema
//! Language parser. This is a deliberate exception to using the examined project's
//! installed tools: Prisma publishes no stable programmatic API for its schema
//! (its internal schema engine WebAssembly interface changes without notice), and
//! the schema language itself is a stable, documented format.

mod extract;

pub use extract::database_type;
mod model;
mod parse;

use anyhow::{Result, ensure};
use projections_extractor_sdk::{Context, Descriptor, Trust, database_extraction, pre_exported_schema, strings};
use serde_json::{Value, json};

pub const ID: &str = "prisma-schema";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Prisma schema",
        description: "Prisma data model: tables, columns, keys, indexes, relations and enums",
        schema: "database/v0",
        renderer: "database",
        trust: Trust::None,
        access: projections_extractor_sdk::Access::Files,
        determinism: projections_extractor_sdk::Determinism::Pure,
        inputs: json!({"schema":"Prisma schema file or folder; otherwise discovers .prisma files","schemas":"Multiple schema files or folders","snapshot":"Pre-exported effective schema"}),
        template_inputs: None,
        detects: &["*.prisma", "**/*.prisma"],
    }
}

pub fn requires_trust(_inputs: &Value) -> bool {
    false
}

const LIMITATIONS: [&str; 5] = [
    "Desired Prisma model, not a live database or migration history; no database connection, generation or Prisma installation is involved.",
    "Ignored (@ignore, @@ignore) and Unsupported fields are not columns; composite types are not relational columns.",
    "Implicit many-to-many relations are relationships, not invented physical join tables.",
    "Unnamed constraint identities use ordered database columns, not connector-generated SQL names; relationMode, mapped foreign-key names and implicit referential-action defaults are not inferred.",
    "Connector-specific capability checks (supported native types, index types and arguments per database) are left to Prisma.",
];

/// Repository-relative schema files: each selected path is a file or a schema
/// folder, whose `.prisma` files (including nested folders) form one schema.
fn schema_files(cx: &Context, files: &[String], definition: &Value) -> Result<Vec<String>> {
    let selected = definition["inputs"].get("schemas").or_else(|| definition["inputs"].get("schema"));
    let selected = match selected {
        Some(Value::String(s)) => vec![s.clone()],
        Some(v) => strings(v, "Prisma schemas")?,
        None => {
            let mut discovered: Vec<String> = files.iter().filter(|s| s.ends_with(".prisma")).cloned().collect();
            discovered.sort();
            ensure!(
                !discovered.is_empty(),
                "Prisma requires inputs.schema, inputs.schemas, or repository .prisma files"
            );
            return Ok(discovered);
        }
    };
    ensure!(
        !selected.is_empty(),
        "Prisma requires inputs.schema, inputs.schemas, or repository .prisma files"
    );
    let mut result = Vec::new();
    for selection in selected {
        let trimmed = selection.trim_end_matches('/');
        // A revision without the file or folder (one before it was added) has no schema there.
        if !cx.input_exists(trimmed)? {
            continue;
        }
        if cx.is_dir(trimmed)? {
            let prefix = format!("{trimmed}/");
            let mut folder: Vec<String> = files
                .iter()
                .filter(|f| f.starts_with(&prefix) && f.ends_with(".prisma"))
                .cloned()
                .collect();
            folder.sort();
            ensure!(!folder.is_empty(), "Prisma schema folder {trimmed} contains no .prisma files");
            result.extend(folder);
        } else {
            result.push(selection);
        }
    }
    let mut seen = std::collections::BTreeSet::new();
    result.retain(|file| seen.insert(file.clone()));
    Ok(result)
}

/// Parses schema files, given as repository-relative paths and contents.
pub fn extract(sources: &[(String, String)]) -> Result<Value> {
    let mut files = Vec::new();
    for (index, (path, source)) in sources.iter().enumerate() {
        files.push(model::File {
            path,
            blocks: parse::parse(source, path, index)?,
        });
    }
    let schema = model::resolve(&files)?;
    let paths: Vec<String> = sources.iter().map(|(path, _)| path.clone()).collect();
    let (entities, relationships) = extract::extraction(&schema, &paths)?;
    Ok(json!({
        "protocolVersion": 0,
        "schema": "database/v0",
        "entities": entities,
        "relationships": relationships,
        "metadata": {
            "framework": "prisma",
            "authority": "Prisma schema language, parsed by Projections",
            "sources": paths,
            "limitations": LIMITATIONS,
        },
    }))
}

pub fn collect(cx: &Context) -> Result<Value> {
    let (files, d) = (cx.files()?, cx.definition());
    if d["inputs"].get("snapshot").is_some() {
        return pre_exported_schema(cx, d);
    }
    let sources = schema_files(cx, files, d)?
        .into_iter()
        .map(|file| {
            let source = cx.read_source(&file)?;
            Ok((file, source))
        })
        .collect::<Result<Vec<_>>>()?;
    database_extraction(extract(&sources)?)
}
