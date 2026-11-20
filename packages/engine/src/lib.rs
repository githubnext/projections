//! The shared Projections Engine: strict JSON, extraction validation and
//! canonicalization, and comparison integrity, for native and Wasm hosts.

mod canonical;
mod comparison;
pub mod context;
mod data_rules;
pub mod model;
mod parse;
mod validate;
pub mod volatility;
#[cfg(all(target_arch = "wasm32", feature = "abi"))]
mod wasm;

use std::cmp::Ordering;

pub use data_rules::{DATA_RULES, DataRule, Field, FieldType, Record, VOCABULARIES};
pub use model::{
    Change, Collection, Comparison, Context, Correspondence, Counts, Datum, Entity, Extraction, Fields, ItemRef, Number, Relationship,
    Reverse, Side, Status, Step, StepKind,
};
pub use parse::{
    canonical, canonicalize, check_comparison, content, content_value, diagnostic_response, handle, normalize, parse_json, semantic,
    validate_comparison,
};
/// The Engine's formally verified decisions (see `VERIFICATION.md`).
pub use projections_engine_verified as verified;
pub use validate::{MAX_ENTITIES, MAX_EXTRACTION_BYTES, MAX_RELATIONSHIPS, SCHEMAS};

/// The two collections, in the order every pass runs over them.
pub const COLLECTIONS: [&str; 2] = ["entities", "relationships"];

/// Engine request ABI version, independent of the wire protocol version.
pub const ABI_VERSION: u32 = 0;
pub const PROTOCOL_VERSION: u32 = 0;
pub const MAX_REQUEST_BYTES: usize = 128 * 1024 * 1024;
pub const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_JSON_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub path: String,
    pub message: String,
}

impl Diagnostic {
    pub fn new(code: &str, path: &str, message: &str) -> Self {
        Self {
            code: code.to_owned(),
            path: path.to_owned(),
            message: message.to_owned(),
        }
    }
}

impl std::fmt::Display for Diagnostic {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let path = if self.path.is_empty() { "/" } else { &self.path };
        write!(formatter, "{} at {path}: {}", self.code, self.message)
    }
}

pub type Failure = Vec<Diagnostic>;

pub fn fail(code: &str, path: &str, message: &str) -> Failure {
    vec![Diagnostic::new(code, path, message)]
}

pub fn pointer(path: &str, key: &str) -> String {
    format!("{path}/{}", key.replace('~', "~0").replace('/', "~1"))
}

/// Orders IDs by UTF-16 code units, as JavaScript and RFC 8785 do.
pub fn utf16_cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}
