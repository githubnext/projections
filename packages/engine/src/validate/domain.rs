use crate::data_rules::check_data;
use crate::model::{Collection, Entity, Extraction, Relationship};
use crate::{Failure, fail, pointer};
use std::collections::{HashMap, HashSet, VecDeque};

/// Checks what the domain schema and declared vocabularies require beyond
/// the protocol: acyclic DAGs and forests, data fields, weighted treemap leaves.
pub(crate) fn validate_domain(extraction: &Extraction, path: &str) -> Result<(), Failure> {
    let schema = extraction.schema;
    let internal: HashSet<&str> = extraction.relationships.iter().map(|edge| edge.shape.from.as_str()).collect();
    if matches!(schema, "dag/v0" | "treemap/v0") {
        check_acyclic(schema, &extraction.entities, &extraction.relationships, path)?;
    }
    for collection in Collection::ALL {
        for (index, item) in extraction.items(collection).iter().enumerate() {
            let item_path = pointer(&pointer(path, collection.name()), &index.to_string());
            check_data(schema, &extraction.vocabularies, item, &item_path)?;
            // A treemap leaf, an entity that contains nothing, must be weighted.
            if schema == "treemap/v0"
                && collection == Collection::Entities
                && !internal.contains(item.id)
                && !item.data.contains_key("value")
            {
                return Err(fail(
                    "invalid-domain-value",
                    &pointer(&pointer(&item_path, "data"), "value"),
                    "Expected a finite nonnegative number",
                ));
            }
        }
    }
    Ok(())
}

/// Checks that a DAG or forest is acyclic and, for a forest, that no entity
/// has two parents (Kahn's algorithm).
fn check_acyclic(schema: &str, nodes: &[Entity], edges: &[Relationship], path: &str) -> Result<(), Failure> {
    let position: HashMap<&str, usize> = nodes.iter().enumerate().map(|(index, node)| (node.id.as_str(), index)).collect();
    let mut incoming = vec![0usize; nodes.len()];
    let mut outgoing: Vec<Vec<usize>> = vec![Vec::new(); nodes.len()];
    for (index, edge) in edges.iter().enumerate() {
        let (from, to) = (position[edge.shape.from.as_str()], position[edge.shape.to.as_str()]);
        incoming[to] += 1;
        if schema != "dag/v0" && incoming[to] > 1 {
            return Err(fail(
                "multiple-parents",
                &pointer(&pointer(path, "relationships"), &index.to_string()),
                "A forest entity cannot have multiple incoming relationships",
            ));
        }
        outgoing[from].push(to);
    }
    let mut queue: VecDeque<usize> = (0..nodes.len()).filter(|node| incoming[*node] == 0).collect();
    let mut visited = 0;
    while let Some(node) = queue.pop_front() {
        visited += 1;
        for &child in &outgoing[node] {
            incoming[child] -= 1;
            if incoming[child] == 0 {
                queue.push_back(child);
            }
        }
    }
    if visited != nodes.len() {
        return Err(fail(
            "cycle",
            &pointer(path, "relationships"),
            "This domain schema requires an acyclic graph",
        ));
    }
    Ok(())
}
