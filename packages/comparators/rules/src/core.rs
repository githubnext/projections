//! Rules on the matching core: the rules' identity passes as core passes,
//! the change list the later sections see, and the values they read.

use crate::eval::Vars;
use crate::rules::{Match, Pass};
use crate::value::{item_to_cel, list, object, string, to_json};
use cel::{Context, Value as Cel};
use projections_comparator_default::matching::{self, Answer, Pairs, Side};
use projections_engine::volatility::Varied;
use projections_engine::{Collection, Correspondence, Failure, ItemRef, Status, canonical};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct Change {
    pub id: String,
    pub collection: Collection,
    pub before: Vec<String>,
    pub after: Vec<String>,
    pub status: Status,
    pub correspondence: Correspondence,
    /// The identity pass that matched it; `None` for additions and removals.
    pub origin: Option<String>,
    /// A one-to-one pair's volatile values that differ.
    pub varied: Vec<Varied>,
    /// Whether a one-to-one pair differs outside its volatile values.
    pub residual: bool,
    pub summary: Option<String>,
    /// The core's context, with what the file's `context` rules add.
    pub context: Option<projections_engine::Context>,
}

impl From<matching::Change> for Change {
    fn from(change: matching::Change) -> Self {
        Change {
            id: change.id,
            collection: change.collection,
            before: change.before,
            after: change.after,
            status: change.status,
            correspondence: change.correspondence,
            origin: change.origin,
            varied: change.varied,
            residual: change.residual,
            summary: None,
            context: None,
        }
    }
}

/// A varied value as CEL sees it.
pub fn varied_to_cel(varied: &Varied) -> Cel {
    let mut fields = vec![
        ("path".to_owned(), string(&varied.path)),
        ("within".to_owned(), Cel::Bool(varied.within)),
    ];
    if let Some(reason) = &varied.reason {
        fields.push(("reason".to_owned(), string(reason)));
    }
    fields.push(("generated".to_owned(), Cel::Bool(varied.generated)));
    fields.push(("because".to_owned(), list(varied.because.iter().map(|part| string(part)))));
    object(fields)
}

impl Change {
    /// Whether the change is only expected variation: an exact pair whose
    /// every difference is within tolerance. It is listed, but classify
    /// doesn't run on it and steps don't hold it.
    pub fn is_variation(&self) -> bool {
        self.correspondence == Correspondence::Exact && self.status == Status::Unchanged && !self.varied.is_empty()
    }

    /// Whether a person reviews the change: its status, or its identity,
    /// changed. Only these have context.
    pub fn is_scope_change(&self) -> bool {
        self.status != Status::Unchanged || self.correspondence != Correspondence::Exact
    }

    /// The change's own IDs on one side.
    pub fn side(&self, side: projections_engine::Side) -> &[String] {
        match side {
            projections_engine::Side::Before => &self.before,
            projections_engine::Side::After => &self.after,
        }
    }

    /// The change as CEL sees it, built directly. `varied` is always a
    /// list, empty when no volatile value differs.
    pub fn to_cel(&self) -> Cel {
        let ids = |ids: &[String]| list(ids.iter().map(|id| string(id)));
        let mut fields = vec![
            ("id".to_owned(), string(&self.id)),
            ("collection".to_owned(), string(self.collection.name())),
            ("before".to_owned(), ids(&self.before)),
            ("after".to_owned(), ids(&self.after)),
            ("status".to_owned(), string(self.status.name())),
            ("correspondence".to_owned(), string(self.correspondence.name())),
            ("varied".to_owned(), list(self.varied.iter().map(varied_to_cel))),
        ];
        if let Some(summary) = &self.summary {
            fields.push(("summary".to_owned(), string(summary)));
        }
        object(fields)
    }

    /// The change as the comparison lists it.
    pub fn to_change(&self) -> projections_engine::Change {
        projections_engine::Change {
            id: self.id.clone(),
            collection: self.collection,
            before: self.before.clone(),
            after: self.after.clone(),
            status: self.status,
            correspondence: self.correspondence,
            varied: self.varied.clone(),
            summary: self.summary.clone(),
            context: self.context.clone(),
        }
    }
}

pub fn pairs_value(pairs: &Pairs) -> Cel {
    object(pairs.iter().map(|(pass, pairs)| {
        (
            pass.clone(),
            object(pairs.iter().map(|(before, after)| (before.clone(), string(after)))),
        )
    }))
}

/// For each collection and side, the change each item belongs to.
pub fn change_of(changes: &[Change]) -> Cel {
    let side = |collection: &str, before: bool| {
        object(
            changes
                .iter()
                .filter(|change| change.collection.name() == collection)
                .flat_map(|change| {
                    let ids = if before { &change.before } else { &change.after };
                    ids.iter().map(|id| (id.clone(), string(&change.id)))
                })
                .collect::<Vec<_>>(),
        )
    };
    object(["entities", "relationships"].map(|collection| {
        (
            collection.to_owned(),
            object([
                ("before".to_owned(), side(collection, true)),
                ("after".to_owned(), side(collection, false)),
            ]),
        )
    }))
}

/// A rules identity pass, run by the core.
pub struct RulesPass<'a, 'p, 'v> {
    pub pass: &'a Pass,
    pub scope: &'a Context<'p, 'v>,
    /// `pairs` as the pass sees it, set when the pass starts.
    pairs: RefCell<Vars>,
}

impl<'a, 'p, 'v> RulesPass<'a, 'p, 'v> {
    pub fn new(pass: &'a Pass, scope: &'a Context<'p, 'v>) -> Self {
        RulesPass {
            pass,
            scope,
            pairs: RefCell::new(Vars::default()),
        }
    }

    fn evaluate(&self, expression: &crate::rules::Expression, small: &[(&str, Cel)]) -> Result<Cel, Failure> {
        let pairs = self.pairs.borrow();
        let mut child = self.scope.new_inner_scope();
        child.set_variable_resolver(&*pairs);
        crate::eval::evaluate(&child, small, expression)
    }
}

impl matching::Pass for RulesPass<'_, '_, '_> {
    fn name(&self) -> &str {
        &self.pass.name
    }

    fn applies(&self, collection: Collection) -> bool {
        self.pass.collections.contains(&collection.name())
    }

    fn enabled(&self, pairs: &Pairs) -> Result<bool, Failure> {
        *self.pairs.borrow_mut() = Vars::new([("pairs", pairs_value(pairs))]);
        let Some(when) = &self.pass.when else {
            return Ok(true);
        };
        match self.evaluate(when, &[])? {
            Cel::Bool(enabled) => Ok(enabled),
            other => Err(when.fail("rules-evaluation", &format!("Expected a bool, not {:?}", other.type_of()))),
        }
    }

    fn answer(&self, side: Side, item: ItemRef, _: &Pairs) -> Result<Answer, Failure> {
        let id = item.id;
        let small = [("item", item_to_cel(&item.to_json())), ("side", string(side.name()))];
        match &self.pass.rule {
            Match::Key(expression) => {
                let key = self.evaluate(expression, &small)?;
                Ok(Answer::Key(match &key {
                    Cel::Null => None,
                    // Strings and structured keys never collide: a structured
                    // key is its canonical JSON behind a separator.
                    Cel::String(text) => Some(format!("\u{0}{text}")),
                    key => {
                        let json = to_json(key).map_err(|error| expression.fail("rules-evaluation", &error))?;
                        Some(format!("\u{1}{}", canonical(&json)?))
                    }
                }))
            }
            Match::Claims(expression) => {
                let value = self.evaluate(expression, &small)?;
                let Cel::List(targets) = value else {
                    return Err(expression.fail("rules-evaluation", &format!("Expected a list of IDs for {id}")));
                };
                targets
                    .iter()
                    .map(|target| match target {
                        Cel::String(target) => Ok(target.as_ref().clone()),
                        _ => Err(expression.fail("rules-evaluation", &format!("Expected a list of IDs for {id}"))),
                    })
                    .collect::<Result<_, _>>()
                    .map(Answer::Claims)
            }
        }
    }
}

/// Per side: entities and relationships by ID, and relationships by endpoint.
pub fn lookup(before: &Value, after: &Value) -> Cel {
    let side = |extraction: &Value| {
        let index = |collection: &str| {
            object(
                extraction[collection]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|item| (item["id"].as_str().unwrap().to_owned(), item_to_cel(item))),
            )
        };
        let mut incoming: BTreeMap<String, Vec<Cel>> = BTreeMap::new();
        let mut outgoing: BTreeMap<String, Vec<Cel>> = BTreeMap::new();
        for relationship in extraction["relationships"].as_array().unwrap() {
            let cel = item_to_cel(relationship);
            incoming
                .entry(relationship["to"].as_str().unwrap().to_owned())
                .or_default()
                .push(cel.clone());
            outgoing
                .entry(relationship["from"].as_str().unwrap().to_owned())
                .or_default()
                .push(cel);
        }
        object([
            ("entities".to_owned(), index("entities")),
            ("relationships".to_owned(), index("relationships")),
            (
                "incoming".to_owned(),
                object(incoming.into_iter().map(|(id, items)| (id, list(items)))),
            ),
            (
                "outgoing".to_owned(),
                object(outgoing.into_iter().map(|(id, items)| (id, list(items)))),
            ),
        ])
    };
    object([("before".to_owned(), side(before)), ("after".to_owned(), side(after))])
}
