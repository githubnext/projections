use crate::Position;
use serde_json::{Map, Value, json};
use std::collections::HashMap;

/// A 1-based line and column in the test file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Location {
    pub line: usize,
    pub column: usize,
}

/// A problem with the test file itself, at a JSON pointer into it.
#[derive(Debug, Clone, PartialEq)]
pub struct Diagnostic {
    pub pointer: String,
    pub message: String,
    pub location: Location,
}

impl Diagnostic {
    pub fn to_json(&self) -> Value {
        json!({"pointer": self.pointer, "message": self.message,
            "line": self.location.line, "column": self.location.column})
    }
}

/// Where a case's extraction comes from.
#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    /// A file, relative to the test file: an extraction, or a
    /// `projections.extraction` document.
    File(String),
    /// An extraction written in the test file.
    Extraction(Value),
    /// The projection extracted at a revision (`working-tree` for the
    /// working tree) with the working tree's definition.
    Revision(String),
}

/// Which change a change expectation is about.
#[derive(Debug, Clone, PartialEq)]
pub enum Selector {
    /// The changes whose `before` or `after` includes this item ID.
    Item(String),
    /// The change with this ID.
    Id(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChangeExpectation {
    pub selector: Selector,
    /// Narrows the selection to one collection.
    pub collection: Option<String>,
    /// The fields checked: `status`, `correspondence`, `summary`, `before`, `after`.
    pub fields: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct StepExpectation {
    pub kind: Option<Value>,
    pub summary: Option<Value>,
    /// Change IDs or item IDs; together they must name exactly the step's changes.
    pub changes: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Expectations {
    pub order: Option<Vec<String>>,
    pub steps: Option<Vec<StepExpectation>>,
    pub changes: Vec<ChangeExpectation>,
    pub count_changes: Option<u64>,
    pub count_steps: Option<u64>,
    pub metadata: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Case {
    /// Its position in `cases`.
    pub index: usize,
    /// Unique within the file: the case's ID.
    pub name: String,
    pub location: Location,
    pub before: Source,
    pub after: Source,
    /// Comparator options for this case, replacing the file's.
    pub options: Option<Value>,
    pub expect: Option<Expectations>,
    /// The whole comparison's snapshot file, relative to the test file.
    pub snapshot: Option<String>,
}

impl Case {
    /// Whether either side is extracted at a revision.
    pub fn uses_revisions(&self) -> bool {
        matches!(self.before, Source::Revision(_)) || matches!(self.after, Source::Revision(_))
    }

    pub(super) fn pointer(&self) -> String {
        format!("/cases/{}", self.index)
    }
}

/// A parsed test file.
#[derive(Debug, Clone)]
pub struct Suite {
    /// Comparator options for every case that has none of its own.
    pub options: Option<Value>,
    pub cases: Vec<Case>,
    pub(super) positions: HashMap<String, Position>,
}

/// An expectation a comparison did not meet.
#[derive(Debug, Clone, PartialEq)]
pub struct Failure {
    /// The JSON pointer of the expectation in the test file.
    pub expectation: String,
    /// One line.
    pub message: String,
    pub location: Location,
    pub expected: Option<Value>,
    pub actual: Option<Value>,
    /// A line diff of the expected and actual values' JSON.
    pub diff: Option<String>,
}

impl Failure {
    pub fn to_json(&self) -> Value {
        let mut value = json!({"expectation": self.expectation, "message": self.message,
            "location": {"line": self.location.line, "column": self.location.column}});
        if let Some(expected) = &self.expected {
            value["expected"] = expected.clone();
        }
        if let Some(actual) = &self.actual {
            value["actual"] = actual.clone();
        }
        if let Some(diff) = &self.diff {
            value["diff"] = json!(diff);
        }
        value
    }
}

/// What running a case's comparator produced.
#[derive(Debug, Clone, Copy)]
pub enum Outcome<'a> {
    /// The comparison, validated by the Engine.
    Comparison(&'a Value),
    /// The comparator failed with this message.
    Error(&'a str),
}
