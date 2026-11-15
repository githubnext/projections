use super::Integrity;
use crate::model::{Change, Collection, Correspondence, Side};
use crate::{Failure, fail, pointer};

impl Integrity<'_> {
    /// Records a change's ID, which must be unique. `path` is the ID's.
    pub(crate) fn claim_id(&mut self, id: &str, path: &str) -> Result<(), Failure> {
        if !self.change_ids.insert(id.to_owned()) {
            return Err(fail("duplicate-change", path, "Change IDs must be unique"));
        }
        Ok(())
    }

    /// Only one-to-one changes have `varied`. `path` is the `varied` list's.
    pub(crate) fn allow_varied(correspondence: Correspondence, path: &str) -> Result<(), Failure> {
        if !correspondence.one_to_one() {
            return Err(fail("unexpected-varied", path, "Only one-to-one changes have varied"));
        }
        Ok(())
    }

    /// Records the IDs a change references on one side: each an item that
    /// exists there and belongs to no other change. `path` is the side's list.
    pub(crate) fn reference(&mut self, collection: Collection, side: Side, ids: &[String], path: &str) -> Result<(), Failure> {
        for (position, id) in ids.iter().enumerate() {
            let member_path = pointer(path, &position.to_string());
            if !self.items(collection, side).contains_key(id.as_str()) {
                return Err(fail(
                    "unknown-reference",
                    &member_path,
                    &format!("No {} item with this ID exists {}", collection.name(), side.name()),
                ));
            }
            if !self.referenced.insert((collection, side, id.clone())) {
                return Err(fail(
                    "duplicate-reference",
                    &member_path,
                    "An item may belong to at most one change",
                ));
            }
        }
        Ok(())
    }

    /// Records a change whose ID and references are recorded: its status and
    /// correspondence must fit its before and after IDs. `path` is the
    /// change's.
    pub(crate) fn record(&mut self, change: Change, path: String) -> Result<(), Failure> {
        if !shape(&change) {
            return Err(fail(
                "invalid-change-shape",
                &path,
                "Status and correspondence do not match the change's before and after IDs",
            ));
        }
        if change.is_variation() {
            self.variation.insert(change.id.clone());
        }
        self.claimed.push((change, path));
        Ok(())
    }
}

/// Whether the change's status and correspondence fit its before and after
/// IDs: the proved rule in [`projections_engine_verified::correspondence`].
fn shape(change: &Change) -> bool {
    let same_id = matches!((change.before.as_slice(), change.after.as_slice()), ([before], [after]) if before == after);
    projections_engine_verified::correspondence::shape(
        change.correspondence,
        change.status,
        change.before.len(),
        change.after.len(),
        same_id,
    )
}
