//! A change's context: the other items a person needs to read it. The core's
//! context is structural: a changed relationship's endpoints, and the items
//! containing a changed or context entity, with the containment
//! relationships that place them, in the change's own revisions
//! ([`Containment`]). Comparator rules may add to it, never remove from it.

use crate::model::{Change, Collection, Context, Extraction, Relationship, Side};
use crate::utf16_cmp;
use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};

/// At most this many context IDs per change and revision.
pub const MAX_CONTEXT: usize = 1_000;
/// At most this many context IDs across a comparison's changes and revisions.
pub const MAX_CONTEXT_TOTAL: usize = 250_000;

/// Relationship kinds that place their `to` item inside their `from` item, in
/// every domain schema.
const SHARED_CONTAINMENT: &[&str] = &["contains"];

/// Further containment kinds of a domain schema: a database table holds its
/// columns, primary key and indexes.
const CONTAINMENT: &[(&str, &[&str])] = &[("database/v0", &["constraint", "index"])];

/// Containment a vocabulary decides by the kinds of the entities at a
/// relationship's ends, whatever the relationship's own kind: in dependency
/// injection a service holds its registrations, and a registration what it
/// produces.
const ENDPOINT_CONTAINMENT: &[(&str, &[(&str, &str)])] = &[(
    "dependency-injection/v0",
    &[("service", "registration"), ("registration", "implementation")],
)];

/// Which relationships of an extraction mean containment (`from` contains
/// `to`): `contains`, the kinds its schema defines, and the entity kinds at
/// the ends its vocabularies define.
pub struct Containment<'a> {
    kinds: BTreeSet<&'static str>,
    ends: Vec<(&'static str, &'static str)>,
    entity_kinds: HashMap<&'a str, &'a str>,
}

impl<'a> Containment<'a> {
    pub fn of(extraction: &'a Extraction) -> Self {
        let names: Vec<&str> = std::iter::once(extraction.schema())
            .chain(extraction.vocabularies().iter().copied())
            .collect();
        let defined = |name: &&str| names.contains(name);
        let kinds = SHARED_CONTAINMENT
            .iter()
            .copied()
            .chain(
                CONTAINMENT
                    .iter()
                    .filter(|(name, _)| defined(name))
                    .flat_map(|(_, kinds)| kinds.iter().copied()),
            )
            .collect();
        let ends: Vec<(&str, &str)> = ENDPOINT_CONTAINMENT
            .iter()
            .filter(|(name, _)| defined(name))
            .flat_map(|(_, ends)| ends.iter().copied())
            .collect();
        let entity_kinds = if ends.is_empty() {
            HashMap::new()
        } else {
            extraction
                .entities()
                .iter()
                .map(|entity| (entity.id.as_str(), entity.kind.as_str()))
                .collect()
        };
        Containment { kinds, ends, entity_kinds }
    }

    /// Whether a relationship places its `to` entity inside its `from` entity.
    pub fn contains(&self, relationship: &Relationship) -> bool {
        if self.kinds.contains(relationship.kind.as_str()) {
            return true;
        }
        let kind = |id: &str| self.entity_kinds.get(id).copied().unwrap_or_default();
        let (from, to) = (kind(&relationship.shape.from), kind(&relationship.shape.to));
        self.ends
            .iter()
            .any(|(container, contained)| *container == from && *contained == to)
    }
}

/// One extraction's structure, indexed for context: each relationship's
/// endpoints, and each contained entity's containers with the relationships
/// that place it there.
struct Structure<'a> {
    ends: HashMap<&'a str, [&'a str; 2]>,
    parents: HashMap<&'a str, Vec<(&'a str, &'a str)>>,
}

impl<'a> Structure<'a> {
    fn of(extraction: &'a Extraction) -> Self {
        let containment = Containment::of(extraction);
        let mut ends = HashMap::new();
        let mut parents: HashMap<&str, Vec<(&str, &str)>> = HashMap::new();
        for relationship in extraction.relationships() {
            let (from, to) = (relationship.shape.from.as_str(), relationship.shape.to.as_str());
            ends.insert(relationship.id.as_str(), [from, to]);
            if containment.contains(relationship) {
                parents.entry(to).or_default().push((from, relationship.id.as_str()));
            }
        }
        Structure { ends, parents }
    }

    /// The context of items `own`, of one collection: at most `limit` IDs,
    /// nearest first (a relationship's endpoints, then each entity's
    /// containers, level by level), in UTF-16 order and without `own`.
    fn context<'o>(&'o self, relationships: bool, own: &'o [String], limit: usize) -> Vec<String> {
        let mut found = Found {
            own: own.iter().map(String::as_str).collect(),
            seen: HashSet::new(),
            ids: Vec::new(),
            limit,
        };
        let mut queue: VecDeque<&str> = VecDeque::new();
        for id in own {
            if !relationships {
                queue.push_back(id);
                continue;
            }
            for end in self.ends.get(id.as_str()).into_iter().flatten() {
                found.add(end);
                queue.push_back(end);
            }
        }
        // Each entity and, transitively, what contains it, until the limit.
        let mut visited: HashSet<&str> = HashSet::new();
        while let Some(id) = queue.pop_front() {
            if found.full() {
                break;
            }
            if !visited.insert(id) {
                continue;
            }
            for (parent, relationship) in self.parents.get(id).into_iter().flatten() {
                found.add(relationship);
                found.add(parent);
                queue.push_back(parent);
            }
        }
        let mut context: Vec<String> = found.ids.into_iter().map(str::to_owned).collect();
        context.sort_by(|a, b| utf16_cmp(a, b));
        context
    }
}

/// The IDs a change's context has found so far, in the order found.
struct Found<'o> {
    own: HashSet<&'o str>,
    seen: HashSet<&'o str>,
    ids: Vec<&'o str>,
    limit: usize,
}

impl<'o> Found<'o> {
    /// Adds an ID that isn't the change's own, unless it is already found
    /// or the limit is reached.
    fn add(&mut self, id: &'o str) {
        if !self.full() && !self.own.contains(id) && self.seen.insert(id) {
            self.ids.push(id);
        }
    }

    fn full(&self) -> bool {
        self.ids.len() >= self.limit
    }
}

/// The core's context of a comparison's changes, over its two extractions,
/// within the context limits: each change in order takes at most
/// [`MAX_CONTEXT`] IDs per revision, nearest first, from what remains of the
/// comparison's [`MAX_CONTEXT_TOTAL`], so a comparison of any extractions has
/// a valid core context, and building it is bounded.
pub struct Core<'a> {
    before: Structure<'a>,
    after: Structure<'a>,
    remaining: usize,
}

impl<'a> Core<'a> {
    pub fn new(before: &'a Extraction, after: &'a Extraction) -> Self {
        Core {
            before: Structure::of(before),
            after: Structure::of(after),
            remaining: MAX_CONTEXT_TOTAL,
        }
    }

    /// The next change's structural context, taken from the comparison's
    /// budget; none for a change a person doesn't review
    /// (`Change::is_scope_change`) or with nothing around it. Call it for
    /// every change, in the comparison's order.
    pub fn context(&mut self, change: &Change) -> Option<Context> {
        change
            .is_scope_change()
            .then(|| self.of(change.collection, change.side(Side::Before), change.side(Side::After)))
            .flatten()
    }

    /// The structural context of the next reviewed change, items of one
    /// collection `before` and `after`, taken from the comparison's budget;
    /// none when nothing is around them. Call it for every reviewed change,
    /// in the comparison's order.
    pub fn of(&mut self, collection: Collection, before: &[String], after: &[String]) -> Option<Context> {
        let relationships = collection == Collection::Relationships;
        let before = self.before.context(relationships, before, MAX_CONTEXT.min(self.remaining));
        self.remaining -= before.len();
        let after = self.after.context(relationships, after, MAX_CONTEXT.min(self.remaining));
        self.remaining -= after.len();
        let context = Context {
            before,
            after,
            rules: Vec::new(),
        };
        (!context.is_empty()).then_some(context)
    }

    /// Sets every change's context to the core's, in order.
    pub fn apply(&mut self, changes: &mut [Change]) {
        for change in changes {
            change.context = self.context(change);
        }
    }
}

/// Adds IDs to one revision of a context, keeping it sorted and unique.
pub fn extend(ids: &mut Vec<String>, more: impl IntoIterator<Item = String>) {
    ids.extend(more);
    ids.sort_by(|a, b| utf16_cmp(a, b));
    ids.dedup();
}
