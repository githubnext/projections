//! Declarative tests for custom comparators: a `*.comparator.test.yaml` file
//! beside the comparator file (see `docs/contracts/comparisons.md`, "Comparator tests").
//!
//! This module only reads a test file into a [`Suite`] and judges outcomes
//! against a case's expectations. It never runs rules: hosts run them in the
//! sandboxed rules interpreter and hand the comparison (or the failure) here.
//!
//! Expectations are partial. Objects match on the keys they list; arrays and
//! scalars match exactly; a `null` expected value also matches an absent key.

mod changes;
mod diff;
mod evaluate;
mod expect;
mod matching;
mod model;
mod order;
mod read;

pub use self::diff::diff;
pub use self::matching::matches;
pub use self::model::{
    Case, ChangeExpectation, Diagnostic, Expectations, Failure, Location, Outcome, Selector, Source, StepExpectation, Suite,
};
use self::read::Reader;
use crate::Position;
use serde_json::Value;
use std::collections::HashMap;

/// The `format` of a comparator test file.
pub const FORMAT: &str = "projections.comparator-tests";
/// The published JSON Schema of the format, for editors.
pub const SCHEMA: &str = "https://schemas.projections.githubnext.com/comparator-tests/v0.json";
/// Largest test file, in bytes.
pub const MAX_BYTES: usize = crate::MAX_BYTES;

const STATUSES: [&str; 4] = ["added", "removed", "modified", "unchanged"];
const CORRESPONDENCES: [&str; 5] = ["exact", "declared", "split", "merge", "none"];
const COLLECTIONS: [&str; 2] = ["entities", "relationships"];
const KINDS: [&str; 3] = ["remove", "restructure", "add"];

/// The test file beside a comparator file: `X.comparator.yaml` →
/// `X.comparator.test.yaml` (`.yml` likewise); `None` for a path that isn't a
/// comparator file.
pub fn tests_path(rules: &str) -> Option<String> {
    ["yaml", "yml"].iter().find_map(|extension| {
        rules
            .strip_suffix(&format!(".comparator.{extension}"))
            .map(|stem| format!("{stem}.comparator.test.{extension}"))
    })
}

/// The comparator file a test file is beside; `None` for a path that isn't a test file.
pub fn rules_path(tests: &str) -> Option<String> {
    ["yaml", "yml"].iter().find_map(|extension| {
        tests
            .strip_suffix(&format!(".comparator.test.{extension}"))
            .map(|stem| format!("{stem}.comparator.{extension}"))
    })
}

/// A comparison as a snapshot file holds it: pretty JSON with sorted keys and
/// a trailing newline.
pub fn snapshot(comparison: &Value) -> String {
    format!("{}\n", pretty(&sorted(comparison)))
}

fn sorted(value: &Value) -> Value {
    match value {
        Value::Object(fields) => {
            let mut keys: Vec<&String> = fields.keys().collect();
            keys.sort_by(|a, b| projections_engine::utf16_cmp(a, b));
            Value::Object(keys.into_iter().map(|key| (key.clone(), sorted(&fields[key]))).collect())
        }
        Value::Array(items) => Value::Array(items.iter().map(sorted).collect()),
        other => other.clone(),
    }
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

/// Reads a test file.
pub fn parse(text: &str) -> Result<Suite, Vec<Diagnostic>> {
    if text.len() > MAX_BYTES {
        return Err(vec![Diagnostic {
            pointer: String::new(),
            message: "Comparator test files are at most 1 MiB".into(),
            location: Location { line: 1, column: 1 },
        }]);
    }
    let document = crate::parse(text).map_err(|failure| {
        failure
            .iter()
            .map(|diagnostic| yaml_diagnostic(&diagnostic.message))
            .collect::<Vec<_>>()
    })?;
    let mut reader = Reader {
        positions: document.positions,
        diagnostics: Vec::new(),
    };
    let suite = reader.suite(&document.value);
    if reader.diagnostics.is_empty() {
        Ok(Suite {
            positions: reader.positions,
            ..suite
        })
    } else {
        Err(reader.diagnostics)
    }
}

/// A YAML reader error, "Line L, column C: message", as a diagnostic.
fn yaml_diagnostic(message: &str) -> Diagnostic {
    let located = message.strip_prefix("Line ").and_then(|rest| {
        let (line, rest) = rest.split_once(", column ")?;
        let (column, message) = rest.split_once(": ")?;
        Some((line.parse().ok()?, column.parse().ok()?, message))
    });
    match located {
        Some((line, column, message)) => Diagnostic {
            pointer: String::new(),
            message: message.to_owned(),
            location: Location { line, column },
        },
        None => Diagnostic {
            pointer: String::new(),
            message: message.to_owned(),
            location: Location { line: 1, column: 1 },
        },
    }
}

fn location_in(positions: &HashMap<String, Position>, pointer: &str) -> Location {
    // A block mapping's own position is where its first value starts; a
    // case is better found by its name.
    let named = format!("{pointer}/name");
    let mut path = if pointer.starts_with("/cases/") && positions.contains_key(&named) {
        named.as_str()
    } else {
        pointer
    };
    loop {
        if let Some(position) = positions.get(path) {
            return Location {
                line: position.line,
                column: position.column,
            };
        }
        match path.rfind('/') {
            Some(index) => path = &path[..index],
            None => return Location { line: 1, column: 1 },
        }
    }
}
