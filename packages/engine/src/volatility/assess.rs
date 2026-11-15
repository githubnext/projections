use super::declaration::Declaration;
use super::generated::judge_generated;
use super::paths::{Concrete, expand, render};
use super::tolerance::{Effective, Rule, judge, merge};
use crate::model::{Confidence, Extraction, Fields, ItemRef, lookup};
use crate::{pointer, utf16_cmp};
use projections_engine_verified::content::{self, Skip};
use std::collections::{BTreeMap, HashMap};

/// One volatile path whose value differs between a matched pair.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Varied {
    /// The concrete JSON pointer into the item, under `/data/`.
    pub path: String,
    /// Whether the difference is expected variation.
    pub within: bool,
    /// Why a tolerance could not be applied: set only when a spread bound
    /// was unavailable and no other bound held, or a generated value is on
    /// one side only.
    pub reason: Option<String>,
    /// Whether the value is generated, judged by its basis.
    pub generated: bool,
    /// A generated value's basis parts that differ, sorted; empty when the
    /// bases are equal.
    pub because: Vec<String>,
}

/// How one matched pair differs: its volatile differences, and the content
/// paths (a top-level field, or `/data/<key>`) that differ outside them.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Assessment {
    pub varied: Vec<Varied>,
    pub residual: Vec<String>,
}

impl Assessment {
    /// Content equal modulo expected variation: nothing differs outside the
    /// volatile paths, and every volatile difference is within.
    pub fn unchanged(&self) -> bool {
        projections_engine_verified::unchanged::unchanged(self.residual.is_empty(), self.varied.iter().all(|varied| varied.within))
    }
}

/// Both extractions' declarations, applied together to matched pairs.
#[derive(Debug, Clone, Default)]
pub struct Declarations {
    before: Vec<Declaration>,
    after: Vec<Declaration>,
}

impl Declarations {
    /// The declarations of two extractions.
    pub fn of(before: &Extraction, after: &Extraction) -> Declarations {
        Declarations {
            before: before.volatile().to_vec(),
            after: after.volatile().to_vec(),
        }
    }

    /// Every concrete volatile path whose value differs between a matched
    /// pair, including one present on one side only, sorted by path in UTF-16
    /// order, each judged against the tighter of the declared tolerances, or
    /// by its basis when it's generated.
    pub fn differences(&self, before: ItemRef, after: ItemRef) -> Vec<Varied> {
        self.judged(before, after).0
    }

    /// The differences, and the paths content comparison skips: those that
    /// differ, and the basis paths generated values own (a basis is judged
    /// only through its value, never as data of its own).
    fn judged(&self, before: ItemRef, after: ItemRef) -> (Vec<Varied>, Skip) {
        let paths = self.rules(&before, &after);
        let mut skip = Skip::new();
        let mut owned: Vec<String> = Vec::new();
        for (_, rule) in paths.values() {
            if let Rule::Generated(bases) = rule {
                for basis in bases {
                    skip.insert(&basis.keys);
                    owned.push(basis.pointer.clone());
                }
            }
        }
        owned.sort();
        owned.dedup();
        let mut varied: Vec<Varied> = Vec::new();
        for (path, rule) in paths.into_values() {
            if owned.binary_search(&path.pointer).is_ok() {
                continue;
            }
            let keys = path.keys.clone();
            if let Some(found) = judge_path(path, rule, [before.data, after.data]) {
                skip.insert(&keys);
                varied.push(found);
            }
        }
        varied.sort_by(|a, b| utf16_cmp(&a.path, &b.path));
        (varied, skip)
    }

    /// Every concrete path the applicable declarations match in either item,
    /// with the tighter of their rules there.
    fn rules(&self, before: &ItemRef, after: &ItemRef) -> BTreeMap<String, (Concrete, Rule)> {
        let mut paths: BTreeMap<String, (Concrete, Rule)> = BTreeMap::new();
        let applicable = self
            .before
            .iter()
            .filter(|declaration| declaration.applies(before))
            .chain(self.after.iter().filter(|declaration| declaration.applies(after)));
        for declaration in applicable {
            for (path, bound) in expand(&declaration.path.segments, [Some(before.data), Some(after.data)]) {
                let rule = rule_at(declaration, &bound);
                let merged = match paths.remove(&path.pointer) {
                    None => rule,
                    Some((_, earlier)) => merge(earlier, rule),
                };
                paths.insert(path.pointer.clone(), (path, merged));
            }
        }
        paths
    }

    /// A matched pair's volatile differences and what differs outside them.
    /// A before-side relationship's endpoints are compared through
    /// `endpoints`, as [`same_content`] does.
    pub fn assess(&self, before: ItemRef, after: ItemRef, endpoints: Option<&HashMap<String, String>>) -> Assessment {
        let (varied, skip) = self.judged(before, after);
        let residual = residual_paths(&Content::of(&before, endpoints), &Content::of(&after, None), &skip);
        Assessment { varied, residual }
    }
}

/// How a declaration judges one of its concrete paths, its `*` segments
/// bound to `bound`.
fn rule_at(declaration: &Declaration, bound: &[String]) -> Rule {
    match &declaration.basis {
        Some(basis) => Rule::Generated(vec![render(&basis.segments, bound)]),
        None => Rule::Plain(declaration.tolerance.as_ref().map(|tolerance| {
            Effective {
                absolute: tolerance.absolute.map(|bound| bound.value()),
                relative: tolerance.relative.map(|bound| bound.value()),
                spreads: tolerance
                    .spread
                    .iter()
                    .map(|spread| {
                        let factor = tolerance.factor.map_or(1.0, |factor| factor.value());
                        (render(&spread.segments, bound), factor)
                    })
                    .collect(),
            }
        })),
    }
}

/// Judges one concrete volatile path of a matched pair by its rule; none
/// when its values are the same (and, when generated, so are the bases).
fn judge_path(path: Concrete, rule: Rule, data: [&Fields; 2]) -> Option<Varied> {
    let values = data.map(|data| lookup(data, &path.keys));
    match rule {
        Rule::Generated(bases) => {
            let bases = bases.iter().map(|basis| data.map(|data| lookup(data, &basis.keys))).collect();
            judge_generated(path.pointer, values, bases)
        }
        Rule::Plain(_) if matches!(values, [Some(a), Some(b)] if a == b) => None,
        Rule::Plain(tolerance) => {
            let (within, reason) = judge(tolerance.as_ref(), values, data);
            Some(Varied {
                path: path.pointer,
                within,
                reason,
                ..Varied::default()
            })
        }
    }
}

/// An item's semantic content without its ID: what canonical content
/// equality compares. A before-side relationship's endpoints are read
/// through one-to-one entity correspondence.
#[derive(PartialEq)]
struct Content<'a> {
    kind: &'a str,
    label: Option<&'a str>,
    from: Option<&'a str>,
    to: Option<&'a str>,
    confidence: Option<Confidence>,
    data: &'a Fields,
}

impl<'a> Content<'a> {
    fn of(item: &ItemRef<'a>, endpoints: Option<&'a HashMap<String, String>>) -> Content<'a> {
        let alias = |id: &'a str| endpoints.and_then(|endpoints| endpoints.get(id)).map_or(id, String::as_str);
        Content {
            kind: item.kind,
            label: item.label,
            from: item.endpoints.map(|[from, _]| alias(from)),
            to: item.endpoints.map(|[_, to]| alias(to)),
            confidence: item.confidence,
            data: item.data,
        }
    }
}

/// Whether two items' semantic content, without their IDs, is canonically
/// equal; a before-side relationship's endpoints are first rewritten through
/// `endpoints`, so a renamed endpoint alone is not a content change.
pub fn same_content(before: &ItemRef, after: &ItemRef, endpoints: Option<&HashMap<String, String>>) -> bool {
    Content::of(before, endpoints) == Content::of(after, None)
}

/// The content paths (a top-level field, or `/data/<key>`) whose values
/// differ outside the `skip` paths, sorted by UTF-16 code units: the data
/// keys [`content::residual_keys`] proves differ, and the top-level fields
/// that aren't equal.
fn residual_paths(old: &Content, new: &Content, skip: &Skip) -> Vec<String> {
    let mut residual: Vec<String> = [
        ("kind", old.kind != new.kind),
        ("label", old.label != new.label),
        ("from", old.from != new.from),
        ("to", old.to != new.to),
        ("confidence", old.confidence != new.confidence),
    ]
    .into_iter()
    .filter(|(_, differs)| *differs)
    .map(|(key, _)| pointer("", key))
    .collect();
    residual.extend(
        content::residual_keys(old.data, new.data, skip)
            .into_iter()
            .map(|key| pointer("/data", key)),
    );
    residual.sort_by(|a, b| utf16_cmp(a, b));
    residual
}
