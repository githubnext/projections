use super::Integrity;
use crate::context::{Core, MAX_CONTEXT_BYTES, MAX_CONTEXT_TOTAL};
use crate::model::{Change, Collection, Context, Side};
use crate::{Failure, fail, pointer};
use std::collections::HashSet;

impl<'a> Integrity<'a> {
    /// Checks a change's `context`, at `path`, once its references are
    /// recorded: only a change a person reviews has one; each ID is another
    /// item of that revision; the comparison's context stays within its
    /// bound; and it holds at least the core's context, as rules only add.
    /// The core's context is the bounded one comparators make, in the
    /// comparison's order.
    pub(crate) fn context(&mut self, change: &Change, context: &Context, path: &str) -> Result<(), Failure> {
        if !change.is_scope_change() {
            return Err(fail(
                "unexpected-context",
                path,
                "Only a change whose status or identity changed has context",
            ));
        }
        if context.is_empty() {
            return Err(fail("invalid-context", path, "Expected a context ID; omit context otherwise"));
        }
        for side in [Side::Before, Side::After] {
            let side_path = pointer(path, side.name());
            let own: HashSet<&str> = change.side(side).iter().map(String::as_str).collect();
            for (position, id) in context.side(side).iter().enumerate() {
                let member_path = pointer(&side_path, &position.to_string());
                if !Collection::ALL
                    .iter()
                    .any(|collection| self.items(*collection, side).contains_key(id.as_str()))
                {
                    return Err(fail(
                        "unknown-reference",
                        &member_path,
                        &format!("No item with this ID exists {}", side.name()),
                    ));
                }
                if own.contains(id.as_str()) {
                    return Err(fail("invalid-context", &member_path, "A change's own items aren't its context"));
                }
            }
        }
        let named: usize = context.rules.iter().map(String::len).sum();
        if !(self.context_budget.spend(&context.before)
            && self.context_budget.spend(&context.after)
            && self.context_budget.spend_bytes(named))
        {
            return Err(fail(
                "context-limit",
                path,
                &format!(
                    "A comparison's changes have at most {MAX_CONTEXT_TOTAL} context IDs, of at most {MAX_CONTEXT_BYTES} bytes with the names of the rules that added them"
                ),
            ));
        }
        if let Some(expected) = self.core().context(change) {
            for side in [Side::Before, Side::After] {
                let claimed: HashSet<&str> = context.side(side).iter().map(String::as_str).collect();
                if let Some(id) = expected.side(side).iter().find(|id| !claimed.contains(id.as_str())) {
                    return Err(fail(
                        "missing-context",
                        &pointer(path, side.name()),
                        &format!("The context omits {id:?}, which the core's context of this change holds; rules only add context"),
                    ));
                }
            }
        }
        Ok(())
    }

    /// The core's context, its budget spent on the changes recorded so far,
    /// as comparators spend it: built when a change first claims context, so
    /// comparisons without any pay nothing.
    fn core(&mut self) -> &mut Core<'a> {
        if self.core.is_none() {
            let [before, after] = self.extractions;
            let mut core = Core::new(before, after);
            for (change, _) in &self.claimed {
                core.context(change);
            }
            self.core = Some(core);
        }
        self.core.as_mut().expect("the core is built")
    }

    /// Spends the core's budget on a recorded change that claims no context,
    /// once the core is built, so later changes' core context is the one
    /// comparators make.
    pub(crate) fn spend_core(&mut self, change: &Change) {
        if change.context.is_none()
            && let Some(core) = &mut self.core
        {
            core.context(change);
        }
    }
}
