//! Builds the `database/v0` extraction from a resolved Prisma data model.

mod builder;
mod indexes;
mod native;
mod relations;
mod tables;

pub use native::database_type;

use crate::model::{Model, Schema};
use anyhow::Result;
use builder::Builder;
use projections_extractor_sdk::percent;
use serde_json::Value;

fn id(kind: &str, parts: &[&str]) -> String {
    format!("{kind}:{}", parts.iter().map(|p| percent(p)).collect::<Vec<_>>().join("/"))
}

/// `view` for a `view` block, otherwise `table`.
fn relation_kind(model: &Model) -> &'static str {
    if model.view { "view" } else { "table" }
}

/// The ID of a model's table or a view: its kind, database schema and name.
fn table_id(model: &Model) -> String {
    id(
        relation_kind(model),
        &[model.namespace.as_deref().unwrap_or(""), model.database_name()],
    )
}

fn column_name<'a>(model: &'a Model, name: &str) -> &'a str {
    model.field(name).map(|field| field.database_name()).expect("resolved fields exist")
}

fn column_id(model: &Model, name: &str) -> String {
    id("column", &[&table_id(model), column_name(model, name)])
}

fn has_column(model: &Model, name: &str) -> bool {
    model.field(name).is_some_and(|field| field.is_column())
}

pub fn extraction(schema: &Schema, paths: &[String]) -> Result<(Vec<Value>, Vec<Value>)> {
    let mut builder = Builder::new(paths);
    tables::enums(&mut builder, schema)?;
    let models: Vec<&Model> = schema.models.iter().filter(|m| !m.ignored).collect();
    for model in &models {
        tables::table(&mut builder, schema, model)?;
    }
    for model in &models {
        for item in &model.indexes {
            indexes::index(&mut builder, model, item)?;
        }
    }
    for (model_index, model) in schema.models.iter().enumerate() {
        if !model.ignored {
            relations::relations(&mut builder, schema, model_index)?;
        }
    }
    Ok((builder.entities, builder.relationships))
}

#[cfg(test)]
mod tests;
