use super::{arity, side, strings};
use crate::value::{list, object, string};
use cel::Value as Cel;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Relationship sources and targets by entity and kind, per side, for
/// `graph.parents` and `graph.children`.
#[derive(Default)]
pub struct Graph {
    parents: [HashMap<(String, String), Vec<Cel>>; 2],
    children: [HashMap<(String, String), Vec<Cel>>; 2],
    /// Items by collection and ID, converted when a rule asks for one.
    items: [HashMap<(bool, String), serde_json::Value>; 2],
}

impl Graph {
    /// The index a comparison's rules need: relationship sources and targets
    /// for `graph.parents` and `graph.children`, and entities and
    /// relationships by ID for `graph.entity` and `graph.relationship`.
    pub fn new(before: &serde_json::Value, after: &serde_json::Value, related: bool, entities: bool, relationships: bool) -> Self {
        let mut graph = Graph::default();
        for (side, extraction) in [before, after].into_iter().enumerate() {
            for (relationship, collection, wanted) in [(false, "entities", entities), (true, "relationships", relationships)] {
                if !wanted {
                    continue;
                }
                for item in extraction[collection].as_array().into_iter().flatten() {
                    let id = item["id"].as_str().unwrap_or_default().to_owned();
                    graph.items[side].insert((relationship, id), item.clone());
                }
            }
            if !related {
                continue;
            }
            for relationship in extraction["relationships"].as_array().into_iter().flatten() {
                let text = |key: &str| relationship[key].as_str().unwrap_or_default().to_owned();
                let kind = text("kind");
                graph.parents[side]
                    .entry((text("to"), kind.clone()))
                    .or_default()
                    .push(string(&text("from")));
                graph.children[side]
                    .entry((text("from"), kind))
                    .or_default()
                    .push(string(&text("to")));
            }
        }
        graph
    }

    /// `graph.entity` and `graph.relationship`.
    pub fn item(&self, relationship: bool, args: &[Cel]) -> Result<Cel, String> {
        arity(args, 2)?;
        let side = side(&args[0])?;
        let Cel::String(id) = &args[1] else {
            return Err("id must be a string".into());
        };
        Ok(self.items[side]
            .get(&(relationship, id.as_ref().clone()))
            .map_or(Cel::Null, crate::value::item_to_cel))
    }

    pub fn related(&self, children: bool, args: &[Cel]) -> Result<Cel, String> {
        arity(args, 3)?;
        let text = |value: &Cel, what: &str| match value {
            Cel::String(text) => Ok(text.as_str().to_owned()),
            _ => Err(format!("{what} must be a string")),
        };
        let side = side(&args[0])?;
        let key = (text(&args[1], "id")?, text(&args[2], "kind")?);
        let index = if children { &self.children[side] } else { &self.parents[side] };
        Ok(list(index.get(&key).cloned().unwrap_or_default()))
    }
}

pub(super) type Edge = (Arc<String>, Arc<String>);

pub(super) fn edges(value: &Cel) -> Result<Vec<Edge>, String> {
    let Cel::List(items) = value else {
        return Err("edges must be a list of [from, to] pairs".into());
    };
    items
        .iter()
        .map(|item| {
            let pair = strings(item, "an edge")?;
            match pair.as_slice() {
                [from, to] => Ok((from.clone(), to.clone())),
                _ => Err("edges must be a list of [from, to] pairs".into()),
            }
        })
        .collect()
}

/// Longest-path depth from the roots (nodes without incoming edges), by
/// Kahn's algorithm. Self-loops, duplicate edges and edges to unknown nodes
/// are ignored; nodes on a cycle keep the depth they reached, or 0.
pub(super) fn depths(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 2)?;
    let nodes = strings(&args[0], "nodes")?;
    let edges = edges(&args[1])?;
    let mut incoming: HashMap<&str, usize> = nodes.iter().map(|id| (id.as_str(), 0)).collect();
    let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut seen = HashSet::new();
    for (from, to) in &edges {
        if from == to
            || !incoming.contains_key(from.as_str())
            || !incoming.contains_key(to.as_str())
            || !seen.insert((from.as_str(), to.as_str()))
        {
            continue;
        }
        outgoing.entry(from).or_default().push(to);
        *incoming.get_mut(to.as_str()).unwrap() += 1;
    }
    let mut depth: HashMap<&str, i64> = HashMap::new();
    let mut queue: Vec<&str> = Vec::new();
    let mut queued = HashSet::new();
    for id in &nodes {
        if incoming[id.as_str()] == 0 && queued.insert(id.as_str()) {
            queue.push(id);
            depth.insert(id, 0);
        }
    }
    let mut index = 0;
    while index < queue.len() {
        let id = queue[index];
        index += 1;
        let at = depth[id];
        for child in outgoing.get(id).cloned().unwrap_or_default() {
            let next = depth.get(child).copied().unwrap_or(0).max(at + 1);
            depth.insert(child, next);
            let count = incoming.get_mut(child).unwrap();
            *count -= 1;
            if *count == 0 {
                queue.push(child);
            }
        }
    }
    Ok(object(nodes.iter().map(|id| {
        (id.as_ref().clone(), Cel::Int(depth.get(id.as_str()).copied().unwrap_or(0)))
    })))
}

/// Connected components of the undirected graph on `nodes`, considering only
/// edges whose endpoints are both nodes. Components are ordered by their first
/// node in `nodes`, and list their members in `nodes` order.
pub(super) fn components(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 2)?;
    let nodes = strings(&args[0], "nodes")?;
    let edges = edges(&args[1])?;
    let index: HashMap<&str, usize> = nodes.iter().enumerate().map(|(position, id)| (id.as_str(), position)).collect();
    let mut parent: Vec<usize> = (0..nodes.len()).collect();
    pub(super) fn find(parent: &mut [usize], mut node: usize) -> usize {
        while parent[node] != node {
            parent[node] = parent[parent[node]];
            node = parent[node];
        }
        node
    }
    for (from, to) in &edges {
        let (Some(&from), Some(&to)) = (index.get(from.as_str()), index.get(to.as_str())) else {
            continue;
        };
        let (left, right) = (find(&mut parent, from), find(&mut parent, to));
        if left != right {
            parent[left.max(right)] = left.min(right);
        }
    }
    let mut order: Vec<usize> = Vec::new();
    let mut groups: HashMap<usize, Vec<Cel>> = HashMap::new();
    for (position, id) in nodes.iter().enumerate() {
        let root = find(&mut parent, position);
        let group = groups.entry(root).or_insert_with(|| {
            order.push(root);
            Vec::new()
        });
        group.push(Cel::String(id.clone()));
    }
    Ok(list(order.into_iter().map(|root| list(groups.remove(&root).unwrap()))))
}
