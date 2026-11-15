//! Write Projections extractors in Rust: the extractor request and process,
//! repository paths and extraction values. Every built-in extractor is written
//! with this crate and nothing else from Projections; see the README.

mod context;
mod descriptor;
mod entry;
mod generation;
mod paths;
mod process;
mod source;
#[cfg(feature = "testing")]
pub mod testing;
mod values;
mod yaml;

pub use context::{Context, Invocation, MAX_REQUEST_BYTES, MAX_UPSTREAM_BYTES, execute, execute_reporting, run};
pub use descriptor::{Access, Descriptor, Determinism, Trust};
pub use entry::{main, serve};
pub use generation::{Basis, Generations, MAX_BASIS_PART_BYTES, MAX_BASIS_PARTS, basis_digest, sha256};
pub use paths::{
    Scratch, basename, canonical, glob, globs, parent, path, project_path, read_file, read_json, read_source, relative_path,
    repository_files,
};
pub use process::{Failure, MAX_STDERR, MAX_STDOUT, Output, spawn};
pub use source::{FileEntry, within};
pub use values::{
    array, database_extraction, exported, extraction, input, key, object, parse_json, percent, pre_exported_schema, relationship, stable,
    strings, text, unique_relationships,
};
pub use yaml::{parse_yaml, parse_yaml_documents};
