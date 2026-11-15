//! Default presentation order, ported from the prototype sequencer.
//!
//! Changes connected to each other through the change itself form one group;
//! independent peers at the same depth change together; removals go leaves
//! first and additions roots first, as exact mirror images; and the number of
//! waves is bounded by merging adjacent layers, never by splitting a group.
//! Everything else that changes (modified, renamed, split or merged items and
//! relationships between surviving entities) restructures in between.

use crate::matching::{Change, Matched};
use crate::options::{Options, OrderBy};
use projections_engine::verified::components as verified;
use projections_engine::verified::waves;
use projections_engine::{Collection, Datum, Extraction, ItemRef, Status, Step, StepKind, utf16_cmp};
use std::collections::{BTreeSet, HashMap, HashSet};

type Edge = (String, String);

/// Longest-path depth from the roots. Cycles keep the depth they reached.
/// Every edge's endpoints are nodes.
fn layer_depths(nodes: &[String], edges: &[Edge]) -> HashMap<String, usize> {
    let mut incoming: HashMap<&str, usize> = nodes.iter().map(|id| (id.as_str(), 0)).collect();
    let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut seen = HashSet::new();
    for (from, to) in edges {
        if from == to || !seen.insert((from.as_str(), to.as_str())) {
            continue;
        }
        outgoing.entry(from).or_default().push(to);
        *incoming.get_mut(to.as_str()).unwrap() += 1;
    }
    let mut depth = HashMap::new();
    let mut queue: Vec<&str> = Vec::new();
    let mut queued = HashSet::new();
    for id in nodes {
        if incoming[id.as_str()] == 0 && queued.insert(id.as_str()) {
            queue.push(id);
            depth.insert(id.clone(), 0);
        }
    }
    let mut index = 0;
    while index < queue.len() {
        let id = queue[index];
        index += 1;
        let at = depth[id];
        for child in outgoing.get(id).cloned().unwrap_or_default() {
            let next = depth.get(child).copied().unwrap_or(0).max(at + 1);
            depth.insert(child.to_owned(), next);
            let count = incoming.get_mut(child).unwrap();
            *count -= 1;
            if *count == 0 {
                queue.push(child);
            }
        }
    }
    for id in nodes {
        depth.entry(id.clone()).or_insert(0);
    }
    depth
}

/// Groups changed entities connected through relationships whose endpoints
/// both change; an edge to a surviving entity says nothing about grouping.
/// [`components`] decides the groups; they are listed in order of their first
/// member in `ids`.
fn components(ids: &[String], edges: &[Edge]) -> Vec<Vec<String>> {
    let index: HashMap<&str, usize> = ids.iter().enumerate().map(|(position, id)| (id.as_str(), position)).collect();
    let links: Vec<(usize, usize)> = edges
        .iter()
        .filter_map(|(from, to)| Some((*index.get(from.as_str())?, *index.get(to.as_str())?)))
        .collect();
    let labels = verified::components(ids.len(), &links);
    let mut order = Vec::new();
    let mut grouped: HashMap<usize, Vec<String>> = HashMap::new();
    for (id, label) in ids.iter().zip(labels) {
        if !grouped.contains_key(&label) {
            order.push(label);
        }
        grouped.entry(label).or_default().push(id.clone());
    }
    order.into_iter().map(|label| grouped.remove(&label).unwrap()).collect()
}

/// Shallow to deep, then by ID: independent of comparison direction.
fn canonical_order(ids: &[String], depth: &HashMap<String, usize>) -> Vec<String> {
    let mut ordered = ids.to_vec();
    ordered.sort_by(|a, b| {
        depth
            .get(a)
            .unwrap_or(&0)
            .cmp(depth.get(b).unwrap_or(&0))
            .then_with(|| utf16_cmp(a, b))
    });
    ordered
}

/// Coherent groups stay whole, ranked by their shallowest member; groups at
/// the same depth are peers and share a layer.
fn canonical_layers(ids: &[String], depth: &HashMap<String, usize>, edges: &[Edge]) -> Vec<Vec<String>> {
    let ordered = canonical_order(ids, depth);
    let rank: HashMap<&str, usize> = ordered.iter().enumerate().map(|(index, id)| (id.as_str(), index)).collect();
    let mut groups: Vec<Vec<String>> = components(&ordered, edges)
        .into_iter()
        .map(|mut group| {
            group.sort_by_key(|id| rank[id.as_str()]);
            group
        })
        .collect();
    groups.sort_by_key(|group| rank[group[0].as_str()]);
    let mut layers: Vec<Vec<String>> = Vec::new();
    let mut current = None;
    for group in groups {
        let at = depth.get(&group[0]).copied().unwrap_or(0);
        if current != Some(at) {
            layers.push(Vec::new());
            current = Some(at);
        }
        layers.last_mut().unwrap().extend(group);
    }
    layers
}

/// Bounds the number of waves by merging whole adjacent layers, as many to
/// each wave as [`waves::wave_sizes`] says.
fn partition(layers: Vec<Vec<String>>) -> Vec<Vec<String>> {
    let sizes = waves::wave_sizes(layers.len());
    let mut layers = layers.into_iter();
    sizes
        .into_iter()
        .map(|size| layers.by_ref().take(size).flatten().collect())
        .collect()
}

/// One extraction's entity graph with every entity read as its comparison
/// identity, which maps every entity.
fn identity_graph(extraction: &Extraction, identity: &HashMap<String, String>) -> (Vec<String>, Vec<Edge>) {
    let nodes = extraction.entities().iter().map(|entity| identity[&entity.id].clone()).collect();
    let edges = extraction
        .relationships()
        .iter()
        .map(|relationship| (identity[&relationship.shape.from].clone(), identity[&relationship.shape.to].clone()))
        .collect();
    (nodes, edges)
}

/// Items and incoming relationship counts of one extraction, by ID.
struct Side<'a> {
    items: HashMap<&'a str, ItemRef<'a>>,
    dependents: HashMap<&'a str, usize>,
}

impl<'a> Side<'a> {
    fn new(extraction: &'a Extraction) -> Self {
        let items = Collection::ALL
            .into_iter()
            .flat_map(|collection| extraction.items(collection))
            .map(|item| (item.id, item))
            .collect();
        let mut dependents = HashMap::new();
        for relationship in extraction.relationships() {
            *dependents.entry(relationship.shape.to.as_str()).or_insert(0) += 1;
        }
        Self { items, dependents }
    }

    /// The comparison identities of some relationships' endpoints.
    fn endpoints<'b>(&'b self, ids: &'b [String], identity: &'b HashMap<String, String>) -> impl Iterator<Item = &'b str> + 'b {
        ids.iter()
            .flat_map(move |id| self.items[id.as_str()].endpoints.into_iter().flatten())
            .map(move |id| identity[id].as_str())
    }
}

struct Phase {
    kind: StepKind,
    steps: Vec<Vec<String>>,
}

fn value(before: &Side, after: &Side, change: &Change, by: &OrderBy) -> Option<f64> {
    let (side, ids) = if change.after.is_empty() {
        (before, &change.before)
    } else {
        (after, &change.after)
    };
    ids.iter()
        .filter_map(|id| match by {
            OrderBy::Dependents if change.collection == Collection::Entities => {
                Some(side.dependents.get(id.as_str()).copied().unwrap_or(0) as f64)
            }
            OrderBy::Dependents => None,
            OrderBy::Data(key) => side.items[id.as_str()].data.get(key).and_then(Datum::as_f64),
        })
        .reduce(f64::max)
}

pub fn steps(before: &Extraction, after: &Extraction, matched: &Matched, options: &Options) -> Vec<Step> {
    let before_side = Side::new(before);
    let after_side = Side::new(after);
    // Changes that are only expected variation belong to no step.
    let changes: Vec<&Change> = matched.changes.iter().filter(|change| !change.is_variation()).collect();
    let entity_changes: Vec<&Change> = changes
        .iter()
        .copied()
        .filter(|change| change.collection == Collection::Entities)
        .collect();
    let ids = |status: Status| -> Vec<String> {
        entity_changes
            .iter()
            .filter(|change| change.status == status)
            .map(|change| change.id.clone())
            .collect()
    };
    let removed = ids(Status::Removed);
    let added = ids(Status::Added);
    let (before_nodes, before_edges) = identity_graph(before, &matched.before_identity);
    let (after_nodes, after_edges) = identity_graph(after, &matched.after_identity);
    // Both roots first; removals play last first (waves::phases).
    let removals = partition(canonical_layers(
        &removed,
        &layer_depths(&before_nodes, &before_edges),
        &before_edges,
    ));
    let additions = partition(canonical_layers(&added, &layer_depths(&after_nodes, &after_edges), &after_edges));
    let mut restructure: Vec<String> = entity_changes
        .iter()
        .filter(|change| !matches!(change.status, Status::Added | Status::Removed))
        .map(|change| change.id.clone())
        .collect();
    let placed = place_relationships(&changes, [&before_side, &after_side], matched, [&removals, &additions]);
    let (removal_relationships, addition_relationships, mut restructured_relationships) = placed;
    restructure.sort_by(|a, b| utf16_cmp(a, b));
    restructured_relationships.sort_by(|a, b| utf16_cmp(a, b));
    restructure.extend(restructured_relationships);
    let join = |entities: Vec<Vec<String>>, relationships: Vec<BTreeSet<Ordered>>| {
        entities
            .into_iter()
            .zip(relationships)
            .map(|(mut step, relationships)| {
                step.extend(relationships.into_iter().map(|id| id.0));
                step
            })
            .collect::<Vec<_>>()
    };
    let steps = waves::phases(
        join(removals, removal_relationships),
        (!restructure.is_empty()).then_some(restructure),
        join(additions, addition_relationships),
    );
    let mut phases: Vec<Phase> = Vec::new();
    for (phase, step) in steps {
        let kind = match phase {
            waves::Phase::Remove => StepKind::Remove,
            waves::Phase::Restructure => StepKind::Restructure,
            waves::Phase::Add => StepKind::Add,
        };
        match phases.last_mut() {
            Some(last) if last.kind == kind => last.steps.push(step),
            _ => phases.push(Phase { kind, steps: vec![step] }),
        }
    }
    if let Some((by, descending)) = &options.order {
        reorder(&mut phases, &changes, [&before_side, &after_side], by, *descending);
    }
    phases
        .into_iter()
        .flat_map(|phase| {
            phase.steps.into_iter().map(move |changes| Step {
                changes,
                kind: Some(phase.kind),
                summary: None,
            })
        })
        .collect()
}

/// Which wave each changed relationship belongs to ([`waves::place`]): it
/// arrives with the last wave its arriving endpoints arrive in, or else
/// leaves with the last wave its departing endpoints leave in (the first to
/// play), or else restructures. Waves are roots first. Returns the
/// relationships of each removal and addition wave, and those that
/// restructure.
fn place_relationships(
    changes: &[&Change],
    [before_side, after_side]: [&Side; 2],
    matched: &Matched,
    [removals, additions]: [&[Vec<String>]; 2],
) -> (Vec<BTreeSet<Ordered>>, Vec<BTreeSet<Ordered>>, Vec<String>) {
    let wave_of = |waves: &[Vec<String>]| -> HashMap<String, usize> {
        waves
            .iter()
            .enumerate()
            .flat_map(|(index, wave)| wave.iter().map(move |id| (id.clone(), index)))
            .collect()
    };
    let (removal_wave, addition_wave) = (wave_of(removals), wave_of(additions));
    let mut removal_relationships = vec![BTreeSet::new(); removals.len()];
    let mut addition_relationships = vec![BTreeSet::new(); additions.len()];
    let mut restructured_relationships = Vec::new();
    for change in changes.iter().filter(|change| change.collection == Collection::Relationships) {
        let arriving: Vec<usize> = after_side
            .endpoints(&change.after, &matched.after_identity)
            .filter_map(|id| addition_wave.get(id).copied())
            .collect();
        let departing: Vec<usize> = before_side
            .endpoints(&change.before, &matched.before_identity)
            .filter_map(|id| removal_wave.get(id).copied())
            .collect();
        let key = Ordered(change.id.clone());
        match waves::place(&arriving, &departing) {
            waves::Placement::Add(wave) => {
                addition_relationships[wave].insert(key);
            }
            waves::Placement::Remove(wave) => {
                removal_relationships[wave].insert(key);
            }
            waves::Placement::Restructure => restructured_relationships.push(change.id.clone()),
        }
    }
    (removal_relationships, addition_relationships, restructured_relationships)
}

/// Orders each phase's steps by the `order` option: by each step's highest
/// value, stably, unscored steps last.
fn reorder(phases: &mut [Phase], changes: &[&Change], [before_side, after_side]: [&Side; 2], by: &OrderBy, descending: bool) {
    let changes: HashMap<&str, &Change> = changes.iter().map(|change| (change.id.as_str(), *change)).collect();
    for phase in phases {
        let mut scored: Vec<(Option<f64>, Vec<String>)> = phase
            .steps
            .drain(..)
            .map(|step| {
                let score = step
                    .iter()
                    .filter_map(|id| value(before_side, after_side, changes[id.as_str()], by))
                    .reduce(f64::max);
                (score, step)
            })
            .collect();
        // Stable: equal scores keep the default order; unscored steps go last.
        scored.sort_by(|(a, _), (b, _)| match (a, b) {
            (Some(a), Some(b)) if descending => b.total_cmp(a),
            (Some(a), Some(b)) => a.total_cmp(b),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        });
        phase.steps = scored.into_iter().map(|(_, step)| step).collect();
    }
}

/// IDs ordered by UTF-16 code units.
#[derive(Clone, PartialEq, Eq)]
struct Ordered(String);

impl PartialOrd for Ordered {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Ordered {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        utf16_cmp(&self.0, &other.0)
    }
}

#[cfg(test)]
mod tests;
