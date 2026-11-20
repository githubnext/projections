//! The typed model the Engine core works on. The parser (`crate::parse`)
//! builds it once from JSON, establishing every fact validation checks, and
//! encodes it back; nothing else reads or writes JSON.

mod comparison;
mod extraction;

pub use comparison::{Change, Comparison, Context, Correspondence, Counts, Reverse, Status, Step, StepKind, variation};
pub use extraction::{Confidence, Entity, Evidence, Extraction, Item, ItemRef, Link, Location, Node, Relationship};
pub use projections_engine_verified::datum::{Datum, Fields, Number, lookup};

/// An extraction's two collections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Collection {
    Entities,
    Relationships,
}

impl Collection {
    /// Both, entities first.
    pub const ALL: [Collection; 2] = [Collection::Entities, Collection::Relationships];

    pub fn name(self) -> &'static str {
        match self {
            Collection::Entities => "entities",
            Collection::Relationships => "relationships",
        }
    }
}

/// Which extraction of a comparison.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Side {
    Before,
    After,
}

impl Side {
    pub fn name(self) -> &'static str {
        match self {
            Side::Before => "before",
            Side::After => "after",
        }
    }
}
