//! Enum, table, view and column entities.

use super::builder::Builder;
use super::native::database_type;
use super::{column_id, id, relation_kind, table_id};
use crate::model::{Kind, Model, ModelField, Schema};
use crate::parse::Arity;
use anyhow::Result;
use serde_json::{Value, json};

/// An enum's ID. Enums in a database schema (multiSchema's `@@schema`) are
/// identified within it.
pub(super) fn enum_id(schema: &Schema, index: usize) -> String {
    let enumeration = &schema.enums[index];
    match &enumeration.namespace {
        Some(namespace) => id("enum", &[namespace, enumeration.database_name()]),
        None => id("enum", &[enumeration.database_name()]),
    }
}

pub(super) fn enums(builder: &mut Builder, schema: &Schema) -> Result<()> {
    for (index, enumeration) in schema.enums.iter().enumerate() {
        let values: Vec<&str> = enumeration.values.iter().map(|(name, db)| db.as_deref().unwrap_or(name)).collect();
        let mut data = json!({"values":values});
        if let Some(namespace) = &enumeration.namespace {
            data["namespace"] = json!(namespace);
        }
        builder.entity("enum", enum_id(schema, index), enumeration.database_name(), data, enumeration.span)?;
    }
    Ok(())
}

/// A column's default, with enum values by their database names.
fn column_default(schema: &Schema, field: &ModelField, enumeration: Option<usize>) -> Value {
    let default = field.default.clone().unwrap_or(Value::Null);
    let Some(index) = enumeration else {
        return default;
    };
    let values = &schema.enums[index].values;
    let map = |value: &Value| match value.as_str() {
        Some(name) => json!(
            values
                .iter()
                .find(|(v, _)| v == name)
                .and_then(|(_, db)| db.as_deref())
                .unwrap_or(name)
        ),
        None => value.clone(),
    };
    match &default {
        Value::Array(items) => Value::Array(items.iter().map(map).collect()),
        other => map(other),
    }
}

fn column(builder: &mut Builder, schema: &Schema, model: &Model, table: &str, field: &ModelField) -> Result<()> {
    let enumeration = match field.kind {
        Kind::Enum(index) => Some(index),
        _ => None,
    };
    let default = column_default(schema, field, enumeration);
    let ty = match (&field.kind, enumeration) {
        (_, Some(index)) => enum_id(schema, index),
        (Kind::Scalar(scalar), _) => scalar.clone(),
        _ => unreachable!("columns are scalar or enum fields"),
    };
    let native = field
        .native_type
        .as_ref()
        .map(|(name, args)| json!([name, args]))
        .unwrap_or(Value::Null);
    let database_type = field
        .native_type
        .as_ref()
        .map(|(name, args)| json!(database_type(name, args)))
        .unwrap_or(Value::Null);
    let column = builder.entity(
        "column",
        column_id(model, &field.name),
        field.database_name(),
        json!({
            "table":table,"type":ty,"nativeType":native,"databaseType":database_type,
            "nullable":field.arity == Arity::Optional,"list":field.arity == Arity::List,
            "hasDefault":field.default.is_some(),"default":default,"updatedAt":field.updated_at,
        }),
        field.span,
    )?;
    builder.relationship("contains", table, &column, "", None, field.span)?;
    if let Some(index) = enumeration {
        builder.relationship("enum-type", &column, &enum_id(schema, index), "", None, field.span)?;
    }
    Ok(())
}

/// A model's table or view and its columns.
pub(super) fn table(builder: &mut Builder, schema: &Schema, model: &Model) -> Result<()> {
    let table = table_id(model);
    builder.entity(
        relation_kind(model),
        table.clone(),
        model.database_name(),
        json!({"namespace":model.namespace,"provider":schema.provider}),
        model.span,
    )?;
    for field in model.fields.iter().filter(|f| f.is_column()) {
        column(builder, schema, model, &table, field)?;
    }
    Ok(())
}
