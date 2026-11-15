//! Cross-file definition references from a SCIP index, produced at each revision
//! by the project's own SCIP indexer or read from an existing index file.

use anyhow::{Context as _, Result, bail, ensure};
use projections_extractor_sdk::{
    Context, Descriptor, Scratch, Trust, execute, extraction, input, path, percent, read_file, relative_path, strings,
};
use protobuf::Message;
use scip::symbol::{SymbolFormatOptions, format_symbol_with, is_local_symbol, parse_symbol};
use scip::types::{Index, SymbolRole};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

pub const ID: &str = "scip-file-references";

/// The argv token replaced with a private index path outside the revision.
const OUTPUT: &str = "{output}";
/// Where SCIP indexers write when not told otherwise.
const DEFAULT_INDEX: &str = "index.scip";
const MAX_INDEX_BYTES: usize = 128 * 1024 * 1024;
/// Symbols listed per relationship; `symbolCount` reports the full number.
const MAX_SYMBOLS: usize = 50;

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "SCIP file references",
        description: "Cross-file definition references from a SCIP index produced by the project's own indexer",
        schema: "graph/v0",
        renderer: "graph",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({
            "indexer":"SCIP indexer argv run at each revision, such as [\"scip-typescript\",\"index\",\"--output\",\"{output}\"]; {output} names a private index path, otherwise the indexer writes index.scip in its working directory. Requires --trust",
            "index":"Repository-relative SCIP index to read instead of running an indexer; it must match the revision",
            "root":"Repository-relative directory the indexer runs in and the index's document paths are relative to; default \".\""
        }),
        template_inputs: Some(json!({"indexer":["scip-typescript","index","--output",OUTPUT]})),
        detects: &["*.scip", "**/*.scip"],
    }
}

/// Running an indexer executes the project's tooling; reading an index does not.
pub fn requires_trust(inputs: &Value) -> bool {
    inputs.get("index").is_none_or(Value::is_null)
}

pub fn collect(cx: &Context) -> Result<Value> {
    let (root, files, definition) = (cx.root(), cx.files()?, cx.definition());
    let inputs = &definition["inputs"];
    let prefix = relative_path(input(definition, "root", Some("."))?)?
        .to_string_lossy()
        .replace('\\', "/");
    let has = |name: &str| inputs.get(name).is_some_and(|v| !v.is_null());
    let (bytes, source, generated) = match (has("indexer"), has("index")) {
        (true, true) => bail!("Set inputs.indexer or inputs.index, not both"),
        (false, false) => bail!(
            "Set inputs.indexer to the project's SCIP indexer (for example [\"scip-typescript\",\"index\",\"--output\",\"{{output}}\"]) or inputs.index to an existing index"
        ),
        (false, true) => {
            let index = input(definition, "index", None)?;
            // A revision without the declared index (before it was added) references nothing.
            if !cx.input_exists(index)? {
                return references(Index::default(), files, &prefix, index, false);
            }
            let file = path(root, index, false, false)?;
            (read_file(&file, MAX_INDEX_BYTES)?, index.to_owned(), false)
        }
        (true, false) if !prefix.is_empty() && !cx.input_exists(&prefix)? => {
            return references(Index::default(), files, &prefix, "indexer", true);
        }
        (true, false) => (index(root, files, &prefix, definition, cx)?, "indexer".into(), true),
    };
    let index = Index::parse_from_bytes(&bytes).context("Invalid SCIP index")?;
    references(index, files, &prefix, &source, generated)
}

/// Runs the configured indexer in the revision and returns the index it wrote.
fn index(root: &Path, files: &[String], prefix: &str, definition: &Value, cx: &Context) -> Result<Vec<u8>> {
    let argv = strings(&definition["inputs"]["indexer"], "inputs.indexer")?;
    ensure!(!argv.is_empty(), "inputs.indexer must be a nonempty argv");
    let directory = if prefix.is_empty() {
        root.to_path_buf()
    } else {
        path(root, prefix, false, false)?
    };
    ensure!(directory.is_dir(), "inputs.root must be a directory in the revision: {prefix}");
    let scratch;
    let (argv, output): (Vec<String>, PathBuf) = if argv.iter().any(|a| a.contains(OUTPUT)) {
        scratch = Scratch::new(&std::env::temp_dir(), "scip")?;
        let output = scratch.0.join(DEFAULT_INDEX);
        let text = output.to_str().context("Temporary index path is not UTF-8")?;
        (argv.iter().map(|a| a.replace(OUTPUT, text)).collect(), output)
    } else {
        let output = directory.join(DEFAULT_INDEX);
        ensure!(
            fs::symlink_metadata(&output).is_err(),
            "The revision already contains {DEFAULT_INDEX} where the indexer writes; read it with inputs.index or pass {OUTPUT} in inputs.indexer"
        );
        (argv, output)
    };
    cx.require_trust()?;
    let links = Links::new(root, &cx.checkout()?, files)?;
    let ran = execute(cx, &directory, argv, None, BTreeMap::new(), true);
    drop(links);
    ran?;
    let bytes =
        read_file(&output, MAX_INDEX_BYTES).with_context(|| format!("The SCIP indexer did not write an index to {}", output.display()));
    if output.starts_with(&directory) {
        let _ = fs::remove_file(&output);
    }
    bytes
}

/// The checkout's installed `node_modules` directories, linked into a
/// materialized revision while its indexer runs and removed afterward.
///
/// Revisions are materialized without ignored files, so the packages the project
/// installed exist only in the repository checkout. Linking them at the same
/// relative paths lets an indexer resolve external types as it would in the
/// checkout, as the Node helper resolves the project's own packages there.
struct Links(Vec<PathBuf>);

impl Links {
    fn new(root: &Path, checkout: &Path, files: &[String]) -> Result<Self> {
        let mut links = Self(vec![]);
        let checkout = projections_extractor_sdk::canonical(checkout).context("Cannot resolve the repository checkout")?;
        if checkout == root {
            return Ok(links);
        }
        let mut directories = BTreeSet::from([String::new()]);
        for file in files {
            let mut parent = file.as_str();
            while let Some((directory, _)) = parent.rsplit_once('/') {
                if !directories.insert(directory.to_owned()) {
                    break;
                }
                parent = directory;
            }
        }
        for directory in directories {
            if directory.split('/').any(|segment| segment == "node_modules") {
                continue;
            }
            let installed = checkout.join(&directory).join("node_modules");
            let link = root.join(&directory).join("node_modules");
            if !fs::metadata(&installed).is_ok_and(|m| m.is_dir())
                || fs::symlink_metadata(&link).is_ok()
                || !fs::symlink_metadata(root.join(&directory)).is_ok_and(|m| m.is_dir())
            {
                continue;
            }
            symlink(&installed, &link).with_context(|| format!("Cannot link installed packages at {}", link.display()))?;
            links.0.push(link);
        }
        Ok(links)
    }
}

impl Drop for Links {
    fn drop(&mut self) {
        for link in &self.0 {
            let _ = fs::remove_file(link).or_else(|_| fs::remove_dir(link));
        }
    }
}

#[cfg(unix)]
fn symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link)
}

/// A symbol's identity without its package version, so a version bump alone
/// doesn't change which symbols a file refers to.
fn symbol_key(symbol: &str) -> String {
    match parse_symbol(symbol) {
        Ok(parsed) => format_symbol_with(
            parsed,
            SymbolFormatOptions {
                include_scheme: true,
                include_package_manager: true,
                include_package_name: true,
                include_package_version: false,
                include_descriptor: true,
            },
        ),
        Err(_) => symbol.to_owned(),
    }
}

#[derive(Default)]
struct Connection {
    references: BTreeSet<(i32, i32, String)>,
    symbols: BTreeSet<String>,
    evidence: Vec<Value>,
}

fn references(index: Index, files: &[String], prefix: &str, source: &str, generated: bool) -> Result<Value> {
    let files: BTreeSet<_> = files.iter().map(String::as_str).collect();
    let definition_roles = SymbolRole::Definition as i32 | SymbolRole::ForwardDefinition as i32;
    let mut documents: BTreeMap<String, Vec<_>> = BTreeMap::new();
    let mut excluded = BTreeSet::new();
    for document in index.documents {
        let relative = relative_path(&document.relative_path)
            .with_context(|| format!("SCIP document path {:?}", document.relative_path))?
            .to_string_lossy()
            .replace('\\', "/");
        ensure!(!relative.is_empty(), "SCIP document has an empty path");
        let file = if prefix.is_empty() {
            relative
        } else {
            format!("{prefix}/{relative}")
        };
        if !files.contains(file.as_str()) {
            // A fresh index of this revision can include generated or ignored
            // files; a supplied index naming a missing file is stale.
            ensure!(
                generated,
                "SCIP document {file} is absent from the revision; regenerate the index for this revision"
            );
            excluded.insert(file);
            continue;
        }
        documents.entry(file).or_default().extend(document.occurrences);
    }
    let mut defined: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for (file, occurrences) in &documents {
        for occurrence in occurrences {
            if occurrence.symbol_roles & SymbolRole::Definition as i32 != 0
                && !occurrence.symbol.is_empty()
                && !is_local_symbol(&occurrence.symbol)
            {
                defined.entry(occurrence.symbol.as_str()).or_default().insert(file);
            }
        }
    }
    let mut connections: BTreeMap<(&str, &str), Connection> = BTreeMap::new();
    let mut external = 0u64;
    for (from, occurrences) in &documents {
        for occurrence in occurrences {
            if occurrence.symbol_roles & definition_roles != 0 || occurrence.symbol.is_empty() || is_local_symbol(&occurrence.symbol) {
                continue;
            }
            let range = &occurrence.range;
            ensure!(
                matches!(range.len(), 3 | 4) && range.iter().all(|n| *n >= 0),
                "SCIP occurrence in {from} has an invalid range {range:?}"
            );
            let Some(targets) = defined.get(occurrence.symbol.as_str()) else {
                external += 1;
                continue;
            };
            for to in targets.iter().filter(|to| *to != from) {
                let connection = connections.entry((from, to)).or_default();
                let reference = (range[0], range[1], occurrence.symbol.clone());
                if connection.references.insert(reference) {
                    connection.symbols.insert(symbol_key(&occurrence.symbol));
                    if connection.evidence.len() < 25 {
                        connection.evidence.push(json!({"kind":"scip-reference","source":from,
                            "location":{"line":range[0]+1,"column":range[1]+1}}));
                    }
                }
            }
        }
    }
    let participating: BTreeSet<_> = connections.keys().flat_map(|(a, b)| [*a, *b]).collect();
    let entities = participating
        .into_iter()
        .map(|file| {
            json!({"id":format!("file:{}",percent(file)),"kind":"file","label":file,
                "confidence":"derived","evidence":[{"kind":"scip-document","source":file}]})
        })
        .collect();
    let relationships = connections
        .into_iter()
        .map(|((from, to), c)| {
            json!({
                "id":format!("references:{}:{}",percent(from),percent(to)),"kind":"references",
                "from":format!("file:{}",percent(from)),"to":format!("file:{}",percent(to)),
                "data":{"references":c.references.len(),"symbolCount":c.symbols.len(),
                    "symbols":c.symbols.iter().take(MAX_SYMBOLS).collect::<Vec<_>>()},
                "confidence":"derived","evidence":c.evidence,
            })
        })
        .collect();
    let tool = index
        .metadata
        .tool_info
        .as_ref()
        .map(|tool| json!({"name":tool.name,"version":tool.version}));
    Ok(extraction(
        "graph/v0",
        entities,
        relationships,
        Some(json!({
            "source":"SCIP definition and reference occurrences","index":source,"tool":tool,
            "externalReferences":external,"excludedDocuments":excluded.len(),
            "limitations":[
                "Only cross-file references to definitions in indexed repository files are modeled; source positions are evidence, not identity.",
                "Symbols are SCIP symbol strings without their package version; each relationship lists at most 50, in sorted order, and counts all of them in symbolCount."
            ]
        })),
    ))
}
