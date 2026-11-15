use super::Integrity;
use crate::model::Reverse;
use crate::{Failure, fail};
use std::collections::HashSet;

/// One list of steps being checked: every change appears in exactly one
/// step, except changes that are only expected variation, which appear in
/// none.
pub(crate) struct Coverage<'i> {
    changes: &'i HashSet<String>,
    variation: &'i HashSet<String>,
    covered: HashSet<String>,
}

impl Integrity<'_> {
    pub(crate) fn coverage(&self) -> Coverage<'_> {
        Coverage {
            changes: &self.change_ids,
            variation: &self.variation,
            covered: HashSet::new(),
        }
    }
}

impl Coverage<'_> {
    /// Records one member of a step, at `path`.
    pub(crate) fn member(&mut self, id: &str, path: &str) -> Result<(), Failure> {
        if !self.changes.contains(id) {
            return Err(fail("unknown-change", path, "Step references an unknown change"));
        }
        if self.variation.contains(id) {
            return Err(fail(
                "variation-in-step",
                path,
                "A change that is only expected variation belongs to no step",
            ));
        }
        if !self.covered.insert(id.to_owned()) {
            return Err(fail("step-coverage", path, "Every change must appear in exactly one step"));
        }
        Ok(())
    }

    /// Checks that the steps, at `path`, covered every change they must.
    pub(crate) fn complete(&self, path: &str) -> Result<(), Failure> {
        if self.covered.len() != self.changes.len() - self.variation.len() {
            return Err(fail("step-coverage", path, "Every change must appear in exactly one step"));
        }
        Ok(())
    }
}

/// Whether a comparison's `reverseSteps`, at `path`, are to be checked: an
/// explicit reverse order requires them, and only it allows them.
pub(crate) fn reverse_steps(reverse: Reverse, present: bool, path: &str) -> Result<bool, Failure> {
    match (reverse, present) {
        (Reverse::Explicit, true) => Ok(true),
        (Reverse::Explicit, false) => Err(fail(
            "missing-reverse-steps",
            path,
            "An explicit reverse order requires reverseSteps",
        )),
        (Reverse::Mirror, true) => Err(fail(
            "unexpected-reverse-steps",
            path,
            "reverseSteps require order.reverse explicit",
        )),
        (Reverse::Mirror, false) => Ok(false),
    }
}
