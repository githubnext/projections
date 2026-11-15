use super::{Collection, Fields};
use crate::volatility::Varied;
pub use projections_engine_verified::{Correspondence, Status};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepKind {
    Remove,
    Restructure,
    Add,
}

impl StepKind {
    pub const ALL: [StepKind; 3] = [StepKind::Remove, StepKind::Restructure, StepKind::Add];

    pub fn name(self) -> &'static str {
        match self {
            StepKind::Remove => "remove",
            StepKind::Restructure => "restructure",
            StepKind::Add => "add",
        }
    }
}

/// How a comparison plays backwards: its steps mirrored, or its own
/// `reverseSteps`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reverse {
    Mirror,
    Explicit,
}

/// One change a comparator claims. `varied` is empty exactly when the
/// change has none.
#[derive(Debug, Clone, PartialEq)]
pub struct Change {
    pub id: String,
    pub collection: Collection,
    pub before: Vec<String>,
    pub after: Vec<String>,
    pub status: Status,
    pub correspondence: Correspondence,
    pub varied: Vec<Varied>,
    pub summary: Option<String>,
}

impl Change {
    /// Whether the change is only expected variation: an exact pair whose
    /// every difference is within. Such changes are listed, so variation
    /// stays visible, but belong to no step.
    pub fn is_variation(&self) -> bool {
        self.status == Status::Unchanged && self.correspondence == Correspondence::Exact && !self.varied.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    pub changes: Vec<String>,
    pub kind: Option<StepKind>,
    pub summary: Option<String>,
}

/// A comparison's `variation`: `within` counts the unchanged changes with
/// `varied`, `beyond` the modified changes with a difference beyond
/// tolerance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Counts {
    pub within: usize,
    pub beyond: usize,
}

impl std::fmt::Display for Counts {
    /// As canonical JSON writes it.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{{\"beyond\":{},\"within\":{}}}", self.beyond, self.within)
    }
}

/// A comparison as a comparator writes it, before the Engine checks it.
#[derive(Debug, Clone, PartialEq)]
pub struct Comparison {
    pub changes: Vec<Change>,
    pub steps: Vec<Step>,
    pub order: Option<Reverse>,
    pub reverse_steps: Option<Vec<Step>>,
    pub variation: Option<Counts>,
    pub metadata: Option<Fields>,
}

/// The `variation` summary of some changes; none when no change has
/// `varied`.
pub fn variation<'a>(changes: impl IntoIterator<Item = &'a Change>) -> Option<Counts> {
    let varied: Vec<&Change> = changes.into_iter().filter(|change| !change.varied.is_empty()).collect();
    if varied.is_empty() {
        return None;
    }
    Some(Counts {
        within: varied.iter().filter(|change| change.status == Status::Unchanged).count(),
        beyond: varied
            .iter()
            .filter(|change| change.status == Status::Modified && change.varied.iter().any(|varied| !varied.within))
            .count(),
    })
}
