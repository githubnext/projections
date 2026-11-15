use crate::Comparator;
use crate::core::Change;
use crate::eval::{Vars, bind, run};
use crate::rules::Classify;
use crate::value::{self, item_to_cel, list};
use cel::{Context, Value as Cel};
use projections_engine::Failure;
use serde_json::Value;
use std::collections::HashMap;

/// Each side's items by collection and ID.
type Index<'a> = [HashMap<(&'a str, &'a str), &'a Value>; 2];

impl Comparator {
    /// Runs `classify` over every change that isn't only expected variation,
    /// setting summaries and returning the annotations by change ID.
    pub(super) fn classify(
        &self,
        classify: &Classify,
        scope: &Context,
        sides: [&Value; 2],
        changes: &mut [Change],
        pairs: &Cel,
        change_of: &Cel,
    ) -> Result<Vec<(String, Cel)>, Failure> {
        let all = if self.uses("changes") {
            list(changes.iter().map(Change::to_cel))
        } else {
            Cel::Null
        };
        let stage = Vars::new([("changes", all), ("pairs", pairs.clone()), ("changeOf", change_of.clone())]);
        let index: [HashMap<(&str, &str), &Value>; 2] = sides.map(|side| {
            ["entities", "relationships"]
                .into_iter()
                .flat_map(|collection| {
                    side[collection]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(move |item| ((collection, item["id"].as_str().unwrap_or_default()), item))
                })
                .collect()
        });
        let mut annotations = Vec::new();
        // Expected variation needs no summary or annotation.
        for change in changes.iter_mut().filter(|change| !change.is_variation()) {
            if let Some(annotation) = classify_change(classify, scope, &stage, &index, change)? {
                annotations.push(annotation);
            }
        }
        Ok(annotations)
    }
}

/// Classifies one change: whether `where` selects it, its summary and its
/// annotation.
fn classify_change(
    classify: &Classify,
    scope: &Context,
    stage: &Vars,
    index: &Index,
    change: &mut Change,
) -> Result<Option<(String, Cel)>, Failure> {
    let items = |side: usize, ids: &[String]| -> Vec<Cel> {
        ids.iter()
            .map(|id| {
                index[side]
                    .get(&(change.collection.name(), id.as_str()))
                    .map_or(Cel::Null, |item| item_to_cel(item))
            })
            .collect()
    };
    let mut stage_scope = scope.new_inner_scope();
    stage_scope.set_variable_resolver(stage);
    let mut child = stage_scope.new_inner_scope();
    child.add_variable_from_value("change", change.to_cel());
    child.add_variable_from_value("origin", change.origin.as_deref().map(value::string).unwrap_or(Cel::Null));
    let mut items_bound = false;
    let mut bind_items = |child: &mut Context| {
        if items_bound {
            return;
        }
        items_bound = true;
        let befores = items(0, &change.before);
        let afters = items(1, &change.after);
        let single = |items: &[Cel]| match items {
            [item] => item.clone(),
            _ => Cel::Null,
        };
        // The change's item: the after one, or the before one when it was removed.
        let item = match single(&afters) {
            Cel::Null => single(&befores),
            after => after,
        };
        for (name, value) in [
            ("item", item),
            ("beforeItem", single(&befores)),
            ("afterItem", single(&afters)),
            ("befores", list(befores)),
            ("afters", list(afters)),
        ] {
            child.add_variable_from_value(name, value);
        }
    };
    if let Some(when) = &classify.when {
        // Items are converted only for the changes `where` selects,
        // unless `where` reads them.
        if classify.where_reads_items {
            bind_items(&mut child);
        }
        match run(&child, when)? {
            Cel::Bool(true) => {}
            Cel::Bool(false) => return Ok(None),
            _ => return Err(when.fail("rules-evaluation", "Expected a bool")),
        }
    }
    bind_items(&mut child);
    bind(&mut child, &classify.variables)?;
    if let Some(summary) = &classify.summary {
        match run(&child, summary)? {
            Cel::Null => {}
            Cel::String(text) => change.summary = Some(text.as_ref().clone()),
            _ => {
                return Err(summary.fail("rules-evaluation", &format!("Expected a string or null summary for {}", change.id)));
            }
        }
    }
    if let Some(annotation) = &classify.annotation {
        let value = run(&child, annotation)?;
        if value != Cel::Null {
            return Ok(Some((change.id.clone(), value)));
        }
    }
    Ok(None)
}
