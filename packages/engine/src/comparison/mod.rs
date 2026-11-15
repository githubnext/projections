//! Comparison integrity. Comparators decide correspondence, interpretation and
//! order; the Engine checks every claim against both extractions.
//!
//! The parser reads a comparison's JSON and calls these checks in the order
//! the contract fixes, so the first problem reported is the same whichever
//! part of a change it is in: each change's ID, its `varied`, its references
//! and its shape ([`Integrity::claim_id`] to [`Integrity::record`]), then
//! every pair's assessment, the variation summary, hidden changes and the
//! steps' coverage.

mod changes;
mod integrity;
mod steps;

pub(crate) use integrity::Inconsistent;
pub(crate) use steps::reverse_steps;

use crate::model::{Change, Collection, Extraction, ItemRef, Side};
use crate::volatility::Declarations;
use crate::{Failure, fail};
use std::collections::{HashMap, HashSet};

/// Every item of both extractions, by collection and side, then ID.
type Sides<'a> = HashMap<(Collection, Side), HashMap<&'a str, ItemRef<'a>>>;

/// A comparison's claims, checked as they are read.
pub(crate) struct Integrity<'a> {
    sides: Sides<'a>,
    declarations: Declarations,
    change_ids: HashSet<String>,
    referenced: HashSet<(Collection, Side, String)>,
    claimed: Vec<(Change, String)>,
    /// The changes that are only expected variation.
    variation: HashSet<String>,
}

impl<'a> Integrity<'a> {
    /// Starts checking a comparison of two extractions, which must have the
    /// same domain schema.
    pub(crate) fn new(before: &'a Extraction, after: &'a Extraction) -> Result<Integrity<'a>, Failure> {
        if before.schema() != after.schema() {
            return Err(fail(
                "schema-mismatch",
                "/after/schema",
                "Comparisons require the same domain schema",
            ));
        }
        let mut sides = Sides::new();
        for collection in Collection::ALL {
            for (side, extraction) in [(Side::Before, before), (Side::After, after)] {
                let items = extraction.items(collection).into_iter().map(|item| (item.id, item)).collect();
                sides.insert((collection, side), items);
            }
        }
        Ok(Integrity {
            sides,
            declarations: Declarations::of(before, after),
            change_ids: HashSet::new(),
            referenced: HashSet::new(),
            claimed: Vec::new(),
            variation: HashSet::new(),
        })
    }

    fn items(&self, collection: Collection, side: Side) -> &HashMap<&'a str, ItemRef<'a>> {
        &self.sides[&(collection, side)]
    }
}
