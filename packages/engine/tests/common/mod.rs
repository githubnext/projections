//! Reading JSON test items into the typed model the volatility core takes.

use projections_engine::volatility::{Assessment, Declarations, Varied};
use projections_engine::{Collection, Extraction};
use serde_json::{Value, json};

/// The declarations of two normalized extractions.
pub fn declarations_of(before: &Value, after: &Value) -> Declarations {
    Declarations::of(
        &Extraction::from_json(before, "").unwrap(),
        &Extraction::from_json(after, "").unwrap(),
    )
}

/// One item of `collection`, held by an extraction of its own (a
/// relationship gets an endpoint entity).
fn holding(collection: &str, item: &Value) -> Extraction {
    let (entities, relationships) = if collection == "entities" {
        (json!([item]), json!([]))
    } else {
        let mut item = item.clone();
        item["from"] = json!("endpoint");
        item["to"] = json!("endpoint");
        (json!([{"id": "endpoint", "kind": "endpoint", "label": ""}]), json!([item]))
    };
    let extraction = json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": relationships});
    Extraction::from_json(&extraction, "").unwrap()
}

fn collection(name: &str) -> Collection {
    if name == "entities" {
        Collection::Entities
    } else {
        Collection::Relationships
    }
}

/// The volatile differences between two items of `name`'s collection.
pub fn varied_between(declarations: &Declarations, name: &str, before: &Value, after: &Value) -> Vec<Varied> {
    let (before, after) = (holding(name, before), holding(name, after));
    let (before, after) = (before.items(collection(name)), after.items(collection(name)));
    declarations.differences(*before.last().unwrap(), *after.last().unwrap())
}

/// How two entities differ.
pub fn assessed(declarations: &Declarations, before: &Value, after: &Value) -> Assessment {
    let (before, after) = (holding("entities", before), holding("entities", after));
    declarations.assess(before.entities()[0].view(), after.entities()[0].view(), None)
}
