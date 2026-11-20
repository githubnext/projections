//! Each change's context: the core's, then what the file's `context` rules
//! add. Rules only add: they never remove the core's context, and they
//! never hide a change.

use super::classify::{Index, bind_change, bind_items, index};
use crate::Comparator;
use crate::core::Change;
use crate::eval::{bind, run};
use crate::rules::{ContextRule, Expression};
use cel::{Context, Value as Cel};
use projections_engine::context::{Budget, Core, MAX_CONTEXT, MAX_CONTEXT_BYTES, MAX_CONTEXT_TOTAL, extend};
use projections_engine::{Extraction, Failure, Side};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

impl Comparator {
    /// Sets each change's context: the core's, with what each `context` rule
    /// that selects the change adds, in the file's order.
    pub(super) fn context(
        &self,
        typed: [&Extraction; 2],
        staged: &Context,
        sides: [&Value; 2],
        changes: &mut [Change],
        annotations: &HashMap<String, Cel>,
    ) -> Result<(), Failure> {
        let mut core = Core::new(typed[0], typed[1]);
        let mut budget = Budget::COMPARISON;
        for change in changes.iter_mut().filter(|change| change.is_scope_change()) {
            change.context = core.of(change.collection, &change.before, &change.after);
            spend(&mut budget, change.context.as_ref(), None);
        }
        if self.rules.context.is_empty() {
            return Ok(());
        }
        let index = index(sides);
        for change in changes.iter_mut().filter(|change| change.is_scope_change()) {
            let mut child = staged.new_inner_scope();
            bind_change(&mut child, change);
            bind_items(&mut child, &index, change);
            child.add_variable_from_value("annotation", annotations.get(&change.id).cloned().unwrap_or(Cel::Null));
            for rule in &self.rules.context {
                let had = change.context.clone();
                add_context(rule, &child, &index, change)?;
                // The comparison's context stays within its bound as it grows, not only when it is checked.
                if !spend(&mut budget, change.context.as_ref(), had.as_ref()) {
                    let expression = rule
                        .before
                        .as_ref()
                        .or(rule.after.as_ref())
                        .expect("a context rule has before or after");
                    return Err(expression.fail(
                        "context-limit",
                        &format!(
                            "A comparison's changes have at most {MAX_CONTEXT_TOTAL} context IDs, of at most {MAX_CONTEXT_BYTES} bytes; rule `{}` exceeds it at {}",
                            rule.name, change.id
                        ),
                    ));
                }
            }
        }
        Ok(())
    }
}

/// Spends what a change's context gained over `had` from the comparison's
/// budget; false when it doesn't fit.
fn spend(budget: &mut Budget, context: Option<&projections_engine::Context>, had: Option<&projections_engine::Context>) -> bool {
    let Some(context) = context else { return true };
    let new = |ids: &[String], old: Option<&[String]>| -> Vec<String> {
        let old: HashSet<&str> = old.into_iter().flatten().map(String::as_str).collect();
        ids.iter().filter(|id| !old.contains(id.as_str())).cloned().collect()
    };
    budget.spend(&new(&context.before, had.map(|had| had.before.as_slice())))
        && budget.spend(&new(&context.after, had.map(|had| had.after.as_slice())))
}

/// Adds what one rule says to a change's context, when its `where` selects
/// the change, and names the rule when it added an ID.
fn add_context(rule: &ContextRule, scope: &Context, index: &Index, change: &mut Change) -> Result<(), Failure> {
    let mut child = scope.new_inner_scope();
    if let Some(when) = &rule.when {
        match run(&child, when)? {
            Cel::Bool(true) => {}
            Cel::Bool(false) => return Ok(()),
            _ => return Err(when.fail("rules-evaluation", "Expected a bool")),
        }
    }
    bind(&mut child, &rule.variables)?;
    let mut context = change.context.take().unwrap_or_default();
    let mut added = false;
    for (side, expression) in [(Side::Before, &rule.before), (Side::After, &rule.after)] {
        let Some(expression) = expression else { continue };
        let ids = context_ids(&run(&child, expression)?, expression, index, side, change)?;
        let list = match side {
            Side::Before => &mut context.before,
            Side::After => &mut context.after,
        };
        let had = list.len();
        extend(list, ids);
        added |= list.len() > had;
        if list.len() > MAX_CONTEXT {
            return Err(expression.fail(
                "context-limit",
                &format!(
                    "A change has at most {MAX_CONTEXT} context IDs in each revision; {} has more {}",
                    change.id,
                    side.name()
                ),
            ));
        }
    }
    if added {
        context.rules.push(rule.name.clone());
    }
    change.context = (!context.is_empty()).then_some(context);
    Ok(())
}

/// The IDs one of a rule's lists names: items of that revision, the change's
/// own items left out.
fn context_ids(value: &Cel, expression: &Expression, index: &Index, side: Side, change: &Change) -> Result<Vec<String>, Failure> {
    let Cel::List(values) = value else {
        return Err(expression.fail("rules-evaluation", "Expected a list of IDs"));
    };
    let at = usize::from(side == Side::After);
    let own: HashSet<&str> = change.side(side).iter().map(String::as_str).collect();
    let mut ids = Vec::with_capacity(values.len());
    for value in values.iter() {
        let Cel::String(id) = value else {
            return Err(expression.fail("rules-evaluation", "Expected a list of IDs"));
        };
        let id = id.as_ref();
        if !["entities", "relationships"]
            .iter()
            .any(|collection| index[at].contains_key(&(*collection, id.as_str())))
        {
            return Err(expression.fail(
                "invalid-context",
                &format!("{id:?} is no item {}, so it can't be context of {}", side.name(), change.id),
            ));
        }
        if !own.contains(id.as_str()) {
            ids.push(id.clone());
        }
    }
    Ok(ids)
}
