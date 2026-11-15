//! Resolves `@relation` arguments and pairs the relation fields of each relation.

use super::attributes::{arguments_at, names, string};
use super::context::Context;
use super::types::{Kind, Model, ModelField, Relation, Schema};
use crate::parse::{Expr, Span};
use anyhow::Result;
use std::collections::BTreeMap;

const REFERENTIAL_ACTIONS: [&str; 5] = ["Cascade", "Restrict", "NoAction", "SetNull", "SetDefault"];

fn action(context: &Context, span: Span, label: &str, value: Option<&&Expr>) -> Result<Option<String>> {
    match value {
        None => Ok(None),
        Some(Expr::Ident(name)) if REFERENTIAL_ACTIONS.contains(&name.as_str()) => Ok(Some(name.clone())),
        Some(_) => context.fail(span, format!("{label} must be one of {}", REFERENTIAL_ACTIONS.join(", "))),
    }
}

/// The name Prisma gives an unnamed relation: both model names, ordered, joined by `To`.
fn default_relation_name(a: &str, b: &str) -> String {
    if a < b { format!("{a}To{b}") } else { format!("{b}To{a}") }
}

/// A relation field's `@relation` arguments, with the relation's name empty
/// when unnamed.
fn relation_arguments(context: &Context, field: &ModelField) -> Result<Relation> {
    let Some(attribute) = field.relation_args.as_deref() else {
        return Ok(Relation::default());
    };
    let args = arguments_at(
        context,
        field.span,
        "@relation",
        attribute,
        &["name"],
        &["fields", "references", "onDelete", "onUpdate", "map"],
    )?;
    let name = args
        .get("name")
        .map(|value| string(context, field.span, "@relation name", value))
        .transpose()?;
    let fields = args
        .get("fields")
        .map(|value| names(context, field.span, "@relation fields", value))
        .transpose()?
        .unwrap_or_default();
    let references = args
        .get("references")
        .map(|value| names(context, field.span, "@relation references", value))
        .transpose()?
        .unwrap_or_default();
    Ok(Relation {
        name: name.unwrap_or_default(),
        fields,
        references,
        on_delete: action(context, field.span, "onDelete", args.get("onDelete"))?,
        on_update: action(context, field.span, "onUpdate", args.get("onUpdate"))?,
    })
}

fn is_scalar_field(model: &Model, name: &str) -> bool {
    model.field(name).is_some_and(|f| !matches!(f.kind, Kind::Relation(_)))
}

/// Checks that a relation's fields and references name non-relation fields of
/// each side, pairwise.
fn check_relation_fields(context: &Context, model: &Model, field: &ModelField, target: &Model, relation: &Relation) -> Result<()> {
    if relation.fields.len() != relation.references.len() {
        return context.fail(
            field.span,
            format!(
                "relation field {}.{} needs the same number of fields and references",
                model.name, field.name
            ),
        );
    }
    if let Some(name) = relation.fields.iter().find(|name| !is_scalar_field(model, name)) {
        return context.fail(
            field.span,
            format!("relation field {}.{} references unknown field {name}", model.name, field.name),
        );
    }
    if let Some(name) = relation.references.iter().find(|name| !is_scalar_field(target, name)) {
        return context.fail(
            field.span,
            format!(
                "relation field {}.{} references unknown field {}.{name}",
                model.name, field.name, target.name
            ),
        );
    }
    Ok(())
}

/// A relation's identity: its name and both model names, ordered.
type RelationKey = (String, String, String);

/// Resolves one relation field's relation, returning its identity when both
/// sides are in the extraction.
fn resolve_relation(
    context: &Context,
    schema: &Schema,
    model: &Model,
    field: &ModelField,
    target: usize,
) -> Result<(Relation, Option<RelationKey>)> {
    let relation = relation_arguments(context, field)?;
    let target_model = &schema.models[target];
    check_relation_fields(context, model, field, target_model, &relation)?;
    let name = if relation.name.is_empty() {
        default_relation_name(&model.name, &target_model.name)
    } else {
        relation.name.clone()
    };
    let included = !field.ignored && !model.ignored && !target_model.ignored;
    let (a, b) = if model.name <= target_model.name {
        (model.name.clone(), target_model.name.clone())
    } else {
        (target_model.name.clone(), model.name.clone())
    };
    let key = included.then(|| (name.clone(), a, b));
    Ok((Relation { name, ..relation }, key))
}

pub(super) fn resolve_relations(context: &Context, schema: &mut Schema) -> Result<()> {
    // Relation fields of models that exist in the extraction, grouped by relation.
    let mut groups: BTreeMap<RelationKey, Vec<(usize, usize)>> = BTreeMap::new();
    for model_index in 0..schema.models.len() {
        for field_index in 0..schema.models[model_index].fields.len() {
            let model = &schema.models[model_index];
            let field = &model.fields[field_index];
            let Kind::Relation(target) = field.kind else {
                continue;
            };
            let (relation, key) = resolve_relation(context, schema, model, field, target)?;
            if let Some(key) = key {
                groups.entry(key).or_default().push((model_index, field_index));
            }
            schema.models[model_index].fields[field_index].relation = Some(relation);
        }
    }
    for ((name, a, b), members) in groups {
        if members.len() != 2 {
            let (model, field) = members[0];
            let field = &schema.models[model].fields[field];
            return context.fail(
                field.span,
                format!(
                    "relation {name} between {a} and {b} needs exactly two relation fields, one on each side, but has {}; \
                     name the relations to disambiguate them",
                    members.len()
                ),
            );
        }
    }
    Ok(())
}
