//! Declarative step operations: new steps made of the changes a predicate
//! selects, ranking, and step summaries. The engine does the list work:
//! changes the comparison no longer has and selected changes leave the steps
//! they were in, empty steps go, members
//! are in canonical order (entities, then relationships, each by ID in UTF-16
//! order) unless a sort key says otherwise, and sorting is stable.

use crate::core::Change;
use crate::eval::{evaluate, json};
use crate::rules::{Expression, NewStep, Place};
use crate::value::{list, string, to_cel};
use cel::{Context, Value as Cel};
use projections_engine::{Failure, fail};
use serde_json::{Value, json};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

pub struct Plan<'a> {
    pub add: &'a [NewStep],
    pub rank: Option<&'a Expression>,
    pub descending: bool,
    pub summary: Option<&'a Expression>,
}

/// A sort key: null, then booleans, numbers, strings (by UTF-16 code units)
/// and lists (element by element).
#[derive(PartialEq)]
enum Key {
    Null,
    Bool(bool),
    Number(f64),
    Text(Vec<u16>),
    List(Vec<Key>),
}

impl Key {
    fn new(value: &Cel, expression: &Expression) -> Result<Key, Failure> {
        Ok(match value {
            Cel::Null => Key::Null,
            Cel::Bool(value) => Key::Bool(*value),
            Cel::Int(value) => Key::Number(*value as f64),
            Cel::UInt(value) => Key::Number(*value as f64),
            Cel::Float(value) => Key::Number(*value),
            Cel::String(text) => Key::Text(text.encode_utf16().collect()),
            Cel::List(items) => Key::List(items.iter().map(|item| Key::new(item, expression)).collect::<Result<_, _>>()?),
            _ => {
                return Err(fail(
                    "rules-evaluation",
                    &expression.location.path,
                    "Expected a sort key: null, a bool, a number, a string or a list of them",
                ));
            }
        })
    }

    fn order(&self) -> u8 {
        match self {
            Key::Null => 0,
            Key::Bool(_) => 1,
            Key::Number(_) => 2,
            Key::Text(_) => 3,
            Key::List(_) => 4,
        }
    }

    fn cmp(&self, other: &Key) -> Ordering {
        match (self, other) {
            (Key::Bool(a), Key::Bool(b)) => a.cmp(b),
            (Key::Number(a), Key::Number(b)) => a.total_cmp(b),
            (Key::Text(a), Key::Text(b)) => a.cmp(b),
            (Key::List(a), Key::List(b)) => {
                for (a, b) in a.iter().zip(b) {
                    let ordering = a.cmp(b);
                    if ordering != Ordering::Equal {
                        return ordering;
                    }
                }
                a.len().cmp(&b.len())
            }
            _ => self.order().cmp(&other.order()),
        }
    }
}

struct Member<'a> {
    change: &'a Change,
}

impl Member<'_> {
    /// The change as CEL sees it, converted when an expression reads it, so
    /// limit-sized comparisons don't hold every change's CEL form at once.
    fn value(&self) -> Cel {
        self.change.to_cel()
    }
}

/// A change's rank: a number, the smallest of a list of numbers, or none.
fn rank(value: &Cel, expression: &Expression) -> Result<Option<f64>, Failure> {
    let number = |value: &Cel| match value {
        Cel::Int(value) => Some(*value as f64),
        Cel::UInt(value) => Some(*value as f64),
        Cel::Float(value) => Some(*value),
        _ => None,
    };
    match value {
        Cel::Null => Ok(None),
        Cel::List(items) => {
            let mut least: Option<f64> = None;
            for item in items.iter() {
                let rank = number(item).ok_or_else(|| {
                    fail(
                        "rules-evaluation",
                        &expression.location.path,
                        "Expected a rank: a number, a list of numbers or null",
                    )
                })?;
                least = Some(least.map_or(rank, |least| least.min(rank)));
            }
            Ok(least)
        }
        value => number(value).map(Some).ok_or_else(|| {
            fail(
                "rules-evaluation",
                &expression.location.path,
                "Expected a rank: a number, a list of numbers or null",
            )
        }),
    }
}

pub fn plan(
    scope: &Context,
    changes: &[Change],
    annotations: &HashMap<String, Cel>,
    mut steps: Vec<Value>,
    plan: Plan,
) -> Result<Value, Failure> {
    // Expected variation belongs to no step.
    let members: Vec<Member> = changes
        .iter()
        .filter(|change| !change.is_variation())
        .map(|change| Member { change })
        .collect();
    let by_id: HashMap<&str, &Member> = members.iter().map(|m| (m.change.id.as_str(), m)).collect();
    let variables = |member: &Member| {
        [
            ("change", member.value()),
            ("origin", member.change.origin.as_deref().map(string).unwrap_or(Cel::Null)),
            ("annotation", annotations.get(&member.change.id).cloned().unwrap_or(Cel::Null)),
        ]
    };
    // Steps keep only changes the comparison still has: identity passes after
    // the baseline's replace some of its additions and removals.
    for step in &mut steps {
        step["changes"]
            .as_array_mut()
            .unwrap()
            .retain(|id| by_id.contains_key(id.as_str().unwrap()));
    }
    steps.retain(|step| !step["changes"].as_array().unwrap().is_empty());
    let collection = |member: &Member| u8::from(member.change.collection == projections_engine::Collection::Relationships);
    for new in plan.add {
        let mut selected = Vec::new();
        for member in &members {
            match evaluate(scope, &variables(member), &new.changes)? {
                Cel::Bool(true) => selected.push(member),
                Cel::Bool(false) => {}
                _ => {
                    return Err(fail("rules-evaluation", &new.changes.location.path, "Expected a bool"));
                }
            }
        }
        if selected.is_empty() {
            continue;
        }
        let mut keyed = Vec::new();
        for member in selected {
            let key = match &new.sort {
                Some(sort) => Key::new(&evaluate(scope, &variables(member), sort)?, sort)?,
                None => Key::List(vec![
                    Key::Number(f64::from(collection(member))),
                    Key::Text(member.change.id.encode_utf16().collect()),
                ]),
            };
            keyed.push((key, member));
        }
        keyed.sort_by(|(a, _), (b, _)| a.cmp(b));
        let ids: Vec<&str> = keyed.iter().map(|(_, member)| member.change.id.as_str()).collect();
        let taken: HashSet<&str> = ids.iter().copied().collect();
        for step in &mut steps {
            step["changes"]
                .as_array_mut()
                .unwrap()
                .retain(|id| !taken.contains(id.as_str().unwrap()));
        }
        steps.retain(|step| !step["changes"].as_array().unwrap().is_empty());
        let mut step = json!({"changes": ids});
        if let Some(kind) = new.kind {
            step["kind"] = json!(kind);
        }
        if let Some(summary) = &new.summary {
            let value = evaluate(scope, &[("members", list(keyed.iter().map(|(_, member)| member.value())))], summary)?;
            if value != Cel::Null {
                step["summary"] = json(summary, &value)?;
            }
        }
        let of_kind = |step: &Value, kind: &str| step["kind"] == kind;
        let at = match new.place {
            Place::Start => 0,
            Place::End => steps.len(),
            Place::Before(kind) => steps.iter().position(|step| of_kind(step, kind)).unwrap_or(steps.len()),
            Place::After(kind) => steps.iter().rposition(|step| of_kind(step, kind)).map_or(0, |at| at + 1),
        };
        steps.insert(at, step);
    }
    let mut ranks: HashMap<&str, f64> = HashMap::new();
    if let Some(expression) = plan.rank {
        for member in &members {
            if let Some(value) = rank(&evaluate(scope, &variables(member), expression)?, expression)? {
                ranks.insert(member.change.id.as_str(), value);
            }
        }
        let step_rank = |step: &Value| {
            step["changes"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|id| ranks.get(id.as_str().unwrap()).copied())
                .reduce(f64::min)
        };
        let mut ranked: Vec<(Option<f64>, Value)> = steps.into_iter().map(|step| (step_rank(&step), step)).collect();
        ranked.sort_by(|(a, _), (b, _)| match (a, b) {
            (Some(a), Some(b)) if plan.descending => b.total_cmp(a),
            (Some(a), Some(b)) => a.total_cmp(b),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        });
        steps = ranked.into_iter().map(|(_, step)| step).collect();
    }
    if let Some(expression) = plan.summary {
        for step in &mut steps {
            let ids: Vec<&str> = step["changes"].as_array().unwrap().iter().map(|id| id.as_str().unwrap()).collect();
            let step_members: Vec<&Member> = ids.iter().filter_map(|id| by_id.get(id).copied()).collect();
            // The lead is the first member with the best rank, if any is ranked.
            let lead = step_members
                .iter()
                .filter_map(|member| ranks.get(member.change.id.as_str()).map(|rank| (*rank, member)))
                .fold(None, |best: Option<(f64, &&Member)>, (rank, member)| match best {
                    Some((least, _)) if !better(rank, least, plan.descending) => best,
                    _ => Some((rank, member)),
                })
                .map(|(_, member)| member.value())
                .unwrap_or(Cel::Null);
            let value = evaluate(
                scope,
                &[
                    ("step", to_cel(step)),
                    ("members", list(step_members.iter().map(|member| member.value()))),
                    ("lead", lead),
                ],
                expression,
            )?;
            if value != Cel::Null {
                step["summary"] = json(expression, &value)?;
            }
        }
    }
    Ok(Value::Array(steps))
}

fn better(rank: f64, than: f64, descending: bool) -> bool {
    if descending { rank > than } else { rank < than }
}
