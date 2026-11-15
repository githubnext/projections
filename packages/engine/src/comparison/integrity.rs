use super::Integrity;
use crate::model::{Collection, Counts, Side, variation};
use crate::volatility::{Varied, same_content};
use crate::{Failure, fail, pointer};
use projections_engine_verified::unchanged;
use std::collections::HashMap;

/// A one-to-one change whose claim differs from the Engine's own assessment.
#[derive(Debug)]
pub(crate) enum Inconsistent {
    /// Its `varied`, at `path`; `expected` is what it should be.
    Varied { path: String, expected: Vec<Varied> },
    /// Its status, at `path`.
    Status { path: String, message: &'static str },
}

impl Integrity<'_> {
    /// One-to-one entity correspondence, explicit or implied by unreferenced
    /// identical IDs, which normalizes relationship endpoints.
    pub(crate) fn aliases(&self) -> HashMap<String, String> {
        let mut aliases = HashMap::new();
        for (change, _) in &self.claimed {
            if change.collection == Collection::Entities && change.correspondence.one_to_one() {
                aliases.insert(change.before[0].clone(), change.after[0].clone());
            }
        }
        let after = self.items(Collection::Entities, Side::After);
        for id in self.items(Collection::Entities, Side::Before).keys() {
            if !self.referenced.contains(&(Collection::Entities, Side::Before, (*id).to_owned())) && after.contains_key(id) {
                aliases.insert((*id).to_owned(), (*id).to_owned());
            }
        }
        aliases
    }

    /// Checks every one-to-one change's claimed `varied` and status against
    /// the Engine's own assessment of the pair.
    pub(crate) fn assessments(&self, aliases: &HashMap<String, String>) -> Result<(), Inconsistent> {
        for (change, path) in self.claimed.iter().filter(|(change, _)| change.correspondence.one_to_one()) {
            let collection = change.collection;
            let endpoints = (collection == Collection::Relationships).then_some(aliases);
            let assessment = self.declarations.assess(
                self.items(collection, Side::Before)[change.before[0].as_str()],
                self.items(collection, Side::After)[change.after[0].as_str()],
                endpoints,
            );
            if change.varied != assessment.varied {
                return Err(Inconsistent::Varied {
                    path: pointer(path, "varied"),
                    expected: assessment.varied,
                });
            }
            let unchanged = assessment.unchanged();
            if !unchanged::status_accepted(change.status, unchanged) {
                return Err(Inconsistent::Status {
                    path: pointer(path, "status"),
                    message: match (unchanged, assessment.varied.is_empty()) {
                        (true, true) => "Content is canonically equal, so the change cannot be modified",
                        (true, false) => "Content differs only within declared variation, so the change is unchanged",
                        (false, _) => "Content differs, so the change must be modified",
                    },
                });
            }
        }
        Ok(())
    }

    /// The `variation` the claimed changes call for, given whether the
    /// comparison has one: none, or the counts it must equal.
    pub(crate) fn variation(&self, claimed: bool, path: &str) -> Result<Option<Counts>, Failure> {
        match (claimed, variation(self.claimed.iter().map(|(change, _)| change))) {
            (false, None) => Ok(None),
            (true, None) => Err(fail(
                "unexpected-variation",
                path,
                "No change has varied, so the comparison has no variation",
            )),
            (false, Some(_)) => Err(fail(
                "missing-variation",
                path,
                "A change has varied, so the comparison counts its variation",
            )),
            (true, Some(expected)) => Ok(Some(expected)),
        }
    }

    /// A comparator cannot hide a change: every unreferenced item must be an
    /// identical item with the same ID on the other side. Variation within
    /// tolerance is listed too, so it can't hide either.
    pub(crate) fn hidden(&self, aliases: &HashMap<String, String>, changes_path: &str) -> Result<(), Failure> {
        for collection in Collection::ALL {
            let endpoints = (collection == Collection::Relationships).then_some(aliases);
            for (side, other) in [(Side::Before, Side::After), (Side::After, Side::Before)] {
                for (id, item) in self.items(collection, side) {
                    if self.referenced.contains(&(collection, side, (*id).to_owned())) {
                        continue;
                    }
                    let counterpart = self
                        .items(collection, other)
                        .get(id)
                        .filter(|_| !self.referenced.contains(&(collection, other, (*id).to_owned())));
                    let hidden = unchanged::hides(counterpart.map(|counterpart| {
                        let (old, new) = if side == Side::Before {
                            (item, counterpart)
                        } else {
                            (counterpart, item)
                        };
                        same_content(old, new, endpoints)
                    }));
                    if hidden {
                        return Err(fail(
                            "hidden-change",
                            changes_path,
                            &format!("The comparison omits a change to {} item {id:?}", collection.name()),
                        ));
                    }
                }
            }
        }
        Ok(())
    }
}
