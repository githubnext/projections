//! Correspondence and status: the matching core every comparator built on the
//! built-in one shares.
//!
//! Identity passes decide which items correspond. The default comparator has
//! two: exact IDs ([`Exact`]), then explicit identity claims ([`Claims`],
//! `previousIds`, including definition correspondence the runner applied),
//! honored in either direction so a reversed pair recognizes the same
//! connection. Rules comparators add their own passes after these.
//!
//! The core decides everything the Engine's comparison validation fixes: a
//! pass only sees the items earlier passes left unmatched; entity passes all
//! run before relationship passes; claim groups become one-to-one, split or
//! merge changes (anything else is ambiguous); a one-to-one pair's status
//! comes from canonical content, relationship endpoints compared through
//! one-to-one entity correspondence and modulo variation the extractions
//! declare within tolerance; what is left is added or removed; and change IDs
//! are unique. Exact pairs that differ only within tolerance are listed as
//! unchanged changes with `varied`, so variation stays visible.

use projections_engine::verified::components::components;
use projections_engine::verified::correspondence::group;
use projections_engine::verified::keys::unique_pairs;
use projections_engine::verified::unchanged;
use projections_engine::volatility::{Declarations, Varied};
use projections_engine::{Collection, Correspondence, Extraction, Failure, ItemRef, Status, fail, utf16_cmp};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

pub use projections_engine::Side;

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
    /// Whether a one-to-one pair's content differs outside its volatile
    /// values (never serialized; rules' `generated.only` reads it).
    pub residual: bool,
}

impl Change {
    /// The change as a comparison lists it.
    pub fn to_change(&self) -> projections_engine::Change {
        projections_engine::Change {
            id: self.id.clone(),
            collection: self.collection,
            before: self.before.clone(),
            after: self.after.clone(),
            status: self.status,
            correspondence: self.correspondence,
            varied: self.varied.clone(),
            summary: None,
            context: None,
        }
    }

    /// Whether the change is only expected variation: listed, in no step.
    pub fn is_variation(&self) -> bool {
        self.correspondence == Correspondence::Exact && self.status == Status::Unchanged && !self.varied.is_empty()
    }
}

/// Per identity pass, its one-to-one pairs, before ID to after ID.
pub type Pairs = BTreeMap<String, BTreeMap<String, String>>;

/// What one item says about its correspondence in one pass.
pub enum Answer {
    /// A key: items whose key is unique on both sides correspond. `None` skips the item.
    Key(Option<String>),
    /// The other side's IDs this item claims to be; each connected group of
    /// claims is one change.
    Claims(Vec<String>),
}

/// One identity pass.
pub trait Pass {
    fn name(&self) -> &str;
    /// Whether the pass runs over `collection`.
    fn applies(&self, collection: Collection) -> bool;
    /// Whether the pass runs at all, given earlier passes' pairs.
    fn enabled(&self, _pairs: &Pairs) -> Result<bool, Failure> {
        Ok(true)
    }
    /// The pass's answer for one unmatched item.
    fn answer(&self, side: Side, item: ItemRef, pairs: &Pairs) -> Result<Answer, Failure>;
}

/// Items with the same ID correspond.
pub struct Exact;

impl Pass for Exact {
    fn name(&self) -> &str {
        "exact"
    }
    fn applies(&self, _collection: Collection) -> bool {
        true
    }
    fn answer(&self, _: Side, item: ItemRef, _: &Pairs) -> Result<Answer, Failure> {
        Ok(Answer::Key(Some(item.id.to_owned())))
    }
}

/// Explicit identity claims, `previousIds`, honored in either direction.
pub struct Claims;

impl Pass for Claims {
    fn name(&self) -> &str {
        "claims"
    }
    fn applies(&self, _collection: Collection) -> bool {
        true
    }
    fn answer(&self, _: Side, item: ItemRef, _: &Pairs) -> Result<Answer, Failure> {
        Ok(Answer::Claims(item.previous_ids.unwrap_or_default().to_vec()))
    }
}

/// The default comparator's identity passes.
pub const DEFAULT_PASSES: [&dyn Pass; 2] = [&Exact, &Claims];

pub struct Matched {
    pub changes: Vec<Change>,
    /// Comparison identity of each entity ID, per side. Unchanged entities keep
    /// their own ID; changed entities map to their change ID.
    pub before_identity: HashMap<String, String>,
    pub after_identity: HashMap<String, String>,
    pub pairs: Pairs,
}

fn sorted(mut ids: Vec<String>) -> Vec<String> {
    ids.sort_by(|a, b| utf16_cmp(a, b));
    ids
}

struct Items<'a> {
    items: BTreeMap<&'a str, ItemRef<'a>>,
    unmatched: BTreeSet<&'a str>,
}

impl<'a> Items<'a> {
    fn new(extraction: &'a Extraction, collection: Collection) -> Self {
        let items: BTreeMap<&str, ItemRef> = extraction.items(collection).into_iter().map(|item| (item.id, item)).collect();
        Items {
            unmatched: items.keys().copied().collect(),
            items,
        }
    }
}

/// Before and after IDs of one claim group.
type Group = (Vec<String>, Vec<String>);

/// Connected groups of claims: [`components`] over the claimed items, before
/// IDs and after IDs numbered apart, so a group is exactly the items a chain
/// of claims joins.
fn groups(claims: &[(String, String)]) -> Vec<Group> {
    let mut members: Vec<(bool, &str)> = claims
        .iter()
        .flat_map(|(before, after)| [(false, before.as_str()), (true, after.as_str())])
        .collect();
    members.sort();
    members.dedup();
    let index = |member: (bool, &str)| members.binary_search(&member).expect("every claimed item is a member");
    let links: Vec<(usize, usize)> = claims
        .iter()
        .map(|(before, after)| (index((false, before)), index((true, after))))
        .collect();
    let labels = components(members.len(), &links);
    let mut grouped: BTreeMap<usize, Group> = BTreeMap::new();
    for (member, label) in members.iter().zip(labels) {
        let entry = grouped.entry(label).or_default();
        if member.0 {
            entry.1.push(member.1.to_owned());
        } else {
            entry.0.push(member.1.to_owned());
        }
    }
    grouped.into_values().collect()
}

/// The groups one pass matches among the unmatched items. Keys are numbered
/// in order of first appearance, and [`unique_pairs`] pairs the items whose
/// key is unique on both sides.
fn run_pass(pass: &dyn Pass, old: &Items, new: &Items, pairs: &Pairs) -> Result<Vec<Group>, Failure> {
    let mut numbers: HashMap<String, usize> = HashMap::new();
    let mut keyed: [(Vec<usize>, Vec<&str>); 2] = Default::default();
    let mut claims: Vec<(String, String)> = Vec::new();
    for (side, items, other) in [(Side::Before, old, new), (Side::After, new, old)] {
        for id in &items.unmatched {
            match pass.answer(side, items.items[id], pairs)? {
                Answer::Key(None) => {}
                Answer::Key(Some(key)) => {
                    let next = numbers.len();
                    let (keys, ids) = &mut keyed[side as usize];
                    keys.push(*numbers.entry(key).or_insert(next));
                    ids.push(id);
                }
                Answer::Claims(targets) => {
                    for target in targets {
                        if other.unmatched.contains(target.as_str()) {
                            claims.push(match side {
                                Side::Before => ((*id).to_owned(), target),
                                Side::After => (target, (*id).to_owned()),
                            });
                        }
                    }
                }
            }
        }
    }
    let [(before_keys, before_ids), (after_keys, after_ids)] = &keyed;
    let mut matched: Vec<Group> = unique_pairs(before_keys, after_keys, numbers.len())
        .into_iter()
        .map(|(i, j)| (vec![before_ids[i].to_owned()], vec![after_ids[j].to_owned()]))
        .collect();
    matched.extend(groups(&claims));
    Ok(matched)
}

/// Runs the identity passes over both collections, entities first.
pub fn match_extractions(before: &Extraction, after: &Extraction, passes: &[&dyn Pass]) -> Result<Matched, Failure> {
    let declarations = Declarations::of(before, after);
    let mut pairs = Pairs::new();
    let mut aliases: HashMap<String, String> = HashMap::new();
    let mut changes = Vec::new();
    for collection in Collection::ALL {
        let mut old = Items::new(before, collection);
        let mut new = Items::new(after, collection);
        let mut found = Vec::new();
        for pass in passes.iter().filter(|pass| pass.applies(collection)) {
            if !pass.enabled(&pairs)? {
                continue;
            }
            let mut one_to_one = Vec::new();
            for (befores, afters) in run_pass(*pass, &old, &new, &pairs)? {
                let pair = Pair {
                    befores: sorted(befores),
                    afters: sorted(afters),
                    collection,
                    origin: pass.name(),
                };
                if let ([before_id], [after_id]) = (pair.befores.as_slice(), pair.afters.as_slice()) {
                    one_to_one.push((before_id.clone(), after_id.clone()));
                }
                for id in &pair.befores {
                    old.unmatched.remove(id.as_str());
                }
                for id in &pair.afters {
                    new.unmatched.remove(id.as_str());
                }
                let endpoints = (collection == Collection::Relationships).then_some(&aliases);
                found.extend(pair.change(&declarations, &old, &new, endpoints)?);
            }
            for (before_id, after_id) in one_to_one {
                if collection == Collection::Entities {
                    aliases.insert(before_id.clone(), after_id.clone());
                }
                pairs.entry(pass.name().to_owned()).or_default().insert(before_id, after_id);
            }
        }
        found.extend(new.unmatched.iter().map(|id| unpaired(collection, id, Status::Added)));
        found.extend(old.unmatched.iter().map(|id| unpaired(collection, id, Status::Removed)));
        found.sort_by(|a, b| utf16_cmp(&a.id, &b.id));
        changes.extend(found);
    }
    unique_ids(&mut changes);
    let identity = |extraction: &Extraction, side: fn(&Change) -> &[String]| {
        let mut identity: HashMap<String, String> = extraction
            .entities()
            .iter()
            .map(|entity| (entity.id.clone(), entity.id.clone()))
            .collect();
        for change in changes.iter().filter(|change| change.collection == Collection::Entities) {
            for id in side(change) {
                identity.insert(id.clone(), change.id.clone());
            }
        }
        identity
    };
    Ok(Matched {
        before_identity: identity(before, |change| &change.before),
        after_identity: identity(after, |change| &change.after),
        changes,
        pairs,
    })
}

/// One group a pass matched: its sorted before and after IDs.
struct Pair<'p> {
    befores: Vec<String>,
    afters: Vec<String>,
    collection: Collection,
    origin: &'p str,
}

impl Pair<'_> {
    /// The group's change: a one-to-one pair's status comes from its
    /// assessment, a split or merge is modified. None for an exact pair
    /// with no difference at all.
    fn change(
        self,
        declarations: &Declarations,
        old: &Items,
        new: &Items,
        endpoints: Option<&HashMap<String, String>>,
    ) -> Result<Option<Change>, Failure> {
        let (mut varied, mut residual) = (Vec::new(), false);
        let same_id = matches!((self.befores.as_slice(), self.afters.as_slice()), ([before], [after]) if before == after);
        let Some(correspondence) = group(self.befores.len(), self.afters.len(), same_id) else {
            return Err(fail(
                "ambiguous-correspondence",
                &format!("/after/{}", self.collection.name()),
                "Identity correspondence must be one-to-one, an unambiguous split or an unambiguous merge",
            ));
        };
        let status = if correspondence.one_to_one() {
            let assessment = declarations.assess(old.items[self.befores[0].as_str()], new.items[self.afters[0].as_str()], endpoints);
            let status = unchanged::status(assessment.unchanged());
            residual = !assessment.residual.is_empty();
            varied = assessment.varied;
            if !unchanged::listed(correspondence, status, varied.is_empty()) {
                return Ok(None);
            }
            status
        } else {
            Status::Modified
        };
        Ok(Some(Change {
            id: self.afters[0].clone(),
            collection: self.collection,
            before: self.befores,
            after: self.afters,
            status,
            correspondence,
            origin: Some(self.origin.to_owned()),
            varied,
            residual,
        }))
    }
}

/// An item no pass matched: added or removed.
fn unpaired(collection: Collection, id: &str, status: Status) -> Change {
    let ids = vec![id.to_owned()];
    let (before, after) = if status == Status::Added {
        (Vec::new(), ids)
    } else {
        (ids, Vec::new())
    };
    Change {
        id: id.to_owned(),
        collection,
        before,
        after,
        status,
        correspondence: Correspondence::None,
        origin: None,
        varied: Vec::new(),
        residual: false,
    }
}

/// A removed entity can share its ID with an added relationship; change IDs
/// stay unique with a deterministic suffix.
fn unique_ids(changes: &mut [Change]) {
    let mut taken = HashSet::new();
    for change in changes {
        let mut candidate = change.id.clone();
        let mut suffix = 1;
        while !taken.insert(candidate.clone()) {
            candidate = format!("{}~{suffix}", change.id);
            suffix += 1;
        }
        change.id = candidate;
    }
}
