//! Constraint entities for ids, unique constraints and indexes.

use super::builder::Builder;
use super::{column_id, column_name, has_column, id, table_id};
use crate::model::{Index, IndexKind, Model};
use anyhow::Result;
use projections_extractor_sdk::stable;
use serde_json::{Map, Value, json};

pub(super) fn index(builder: &mut Builder, model: &Model, index: &Index) -> Result<()> {
    let table = table_id(model);
    let kind = match index.kind {
        IndexKind::Id => "primary-key",
        IndexKind::Unique => "unique",
        IndexKind::Normal | IndexKind::Fulltext => "index",
    };
    let fields: Vec<Value> = index
        .fields
        .iter()
        .map(|field| {
            let mut entry = Map::new();
            entry.insert("name".into(), json!(column_name(model, &field.name)));
            if let Some(sort) = field.sort {
                entry.insert("sortOrder".into(), json!(sort));
            }
            if let Some(length) = field.length {
                entry.insert("length".into(), json!(length));
            }
            if let Some(class) = &field.operator_class {
                entry.insert("operatorClass".into(), json!(class));
            }
            Value::Object(entry)
        })
        .collect();
    let columns: Vec<&str> = index.fields.iter().map(|field| column_name(model, &field.name)).collect();
    let identity = id(
        "constraint",
        &[&table, kind, &index.db_name.clone().unwrap_or_else(|| stable(&json!(columns)))],
    );
    let label = index.db_name.clone().unwrap_or_else(|| format!("{kind} ({})", columns.join(", ")));
    let mut data = Map::new();
    data.insert("table".into(), json!(table));
    if let Some(algorithm) = &index.algorithm {
        data.insert("algorithm".into(), json!(algorithm));
    }
    if let Some(clustered) = index.clustered {
        data.insert("clustered".into(), json!(clustered));
    }
    data.insert("type".into(), json!(kind));
    match index.kind {
        IndexKind::Normal => {
            data.insert("indexType".into(), json!("normal"));
        }
        IndexKind::Fulltext => {
            data.insert("indexType".into(), json!("fulltext"));
        }
        _ => {}
    }
    data.insert("fields".into(), Value::Array(fields));
    data.insert("databaseName".into(), json!(index.db_name));
    let constraint = builder.entity("constraint", identity, &label, Value::Object(data), index.span)?;
    builder.relationship("contains", &table, &constraint, "", None, index.span)?;
    for field in &index.fields {
        // Unsupported and ignored fields are database columns outside the extraction.
        if has_column(model, &field.name) {
            builder.relationship("constrains", &constraint, &column_id(model, &field.name), "", None, index.span)?;
        }
    }
    Ok(())
}
