//! Foreign-key constraints and implicit many-to-many relationships.

use super::builder::Builder;
use super::{column_id, column_name, has_column, id, table_id};
use crate::model::{Kind, Model, ModelField, Relation, Schema};
use crate::parse::Arity;
use anyhow::Result;
use projections_extractor_sdk::stable;
use serde_json::json;

/// The foreign-key constraint of a relation field with `fields` and `references`.
fn foreign_key(builder: &mut Builder, model: &Model, target: &Model, field: &ModelField, relation: &Relation) -> Result<()> {
    let columns: Vec<&str> = relation.fields.iter().map(|n| column_name(model, n)).collect();
    let references: Vec<&str> = relation.references.iter().map(|n| column_name(target, n)).collect();
    let (table, target_table) = (table_id(model), table_id(target));
    let identity = id("constraint", &[&table, "foreign-key", &stable(&json!(columns)), &target_table]);
    let constraint = builder.entity(
        "constraint",
        identity,
        &format!("foreign-key ({})", columns.join(", ")),
        json!({
            "table":table,"type":"foreign-key","columns":columns,"target":target_table,
            "references":references,"onDelete":relation.on_delete,"onUpdate":relation.on_update,
        }),
        field.span,
    )?;
    builder.relationship("contains", &table, &constraint, "", None, field.span)?;
    builder.relationship("references", &constraint, &target_table, "", None, field.span)?;
    for (name, reference) in relation.fields.iter().zip(&relation.references) {
        if !has_column(model, name) {
            continue;
        }
        builder.relationship("constrains", &constraint, &column_id(model, name), "", None, field.span)?;
        if has_column(target, reference) {
            builder.relationship(
                "foreign-key",
                &column_id(model, name),
                &column_id(target, reference),
                &constraint,
                None,
                field.span,
            )?;
        }
    }
    Ok(())
}

/// Whether a list relation field is one side of an implicit many-to-many
/// relation: both sides are lists without fields.
fn is_implicit_many_to_many(model_index: usize, target: &Model, field: &ModelField, relation: &Relation) -> bool {
    let opposite = target.fields.iter().find(|other| {
        !other.ignored
            && other.kind == Kind::Relation(model_index)
            && other.relation.as_ref().is_some_and(|r| r.name == relation.name)
            && !std::ptr::eq(*other, field)
    });
    opposite.is_some_and(|other| other.arity == Arity::List && other.relation.as_ref().is_some_and(|r| r.fields.is_empty()))
}

/// The implicit many-to-many relationship, once for both of its sides.
fn many_to_many(builder: &mut Builder, model: &Model, target: &Model, field: &ModelField, relation: &Relation) -> Result<()> {
    let mut ends = [table_id(model), table_id(target)];
    ends.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    let identity = id("many-to-many", &[&ends[0], &ends[1], &relation.name]);
    if builder.ids.contains(&identity) {
        return Ok(());
    }
    builder.relationship(
        "many-to-many",
        &ends[0],
        &ends[1],
        &relation.name,
        Some(json!({"implicit":true})),
        field.span,
    )
}

/// The relationships of a model's relation fields whose models are both in the extraction.
pub(super) fn relations(builder: &mut Builder, schema: &Schema, model_index: usize) -> Result<()> {
    let model = &schema.models[model_index];
    for field in &model.fields {
        let (Kind::Relation(target_index), Some(relation)) = (&field.kind, &field.relation) else {
            continue;
        };
        let target = &schema.models[*target_index];
        if field.ignored || target.ignored {
            continue;
        }
        if !relation.fields.is_empty() {
            foreign_key(builder, model, target, field, relation)?;
        } else if field.arity == Arity::List && is_implicit_many_to_many(model_index, target, field, relation) {
            many_to_many(builder, model, target, field, relation)?;
        }
    }
    Ok(())
}
