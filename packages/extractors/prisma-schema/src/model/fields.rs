//! Resolves model and view blocks and their fields.

use super::attributes::{arguments, check_attributes, mapped, namespace};
use super::context::{Context, Declared, SCALARS};
use super::defaults::default_value;
use super::types::{Enum, Kind, Model, ModelField};
use crate::parse::{Block, BlockKind, Expr, Field, TypeName};
use anyhow::Result;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn field_kind(context: &Context, declared: &BTreeMap<&str, Declared>, field: &Field) -> Result<Kind> {
    Ok(match &field.ty {
        TypeName::Unsupported(_) => Kind::Unsupported,
        TypeName::Named(name) if SCALARS.contains(&name.as_str()) => Kind::Scalar(name.clone()),
        TypeName::Named(name) => match declared.get(name.as_str()) {
            Some(Declared::Model(index)) => Kind::Relation(*index),
            Some(Declared::Enum(index)) => Kind::Enum(*index),
            Some(Declared::Composite) => Kind::Composite,
            None => {
                return context.fail(field.span, format!("field {} has unknown type {name}", field.name));
            }
        },
    })
}

/// The field's `@default`, if it describes one.
fn default(context: &Context, field: &Field, kind: &Kind, enums: &[Enum]) -> Result<Option<Value>> {
    field
        .attributes
        .iter()
        .find(|a| a.name == "default")
        .map(|attribute| {
            let args = arguments(context, attribute, &["value"], &["map"])?;
            let Some(value) = args.get("value") else {
                return context.fail(attribute.span, "@default requires a value");
            };
            default_value(context, attribute.span, kind, field.arity, enums, value)
        })
        .transpose()
        .map(Option::flatten)
}

/// The field's `@db.*` native type name and arguments.
fn native_type(context: &Context, field: &Field) -> Result<Option<(String, Vec<String>)>> {
    field
        .attributes
        .iter()
        .find(|a| a.name.starts_with("db."))
        .map(|attribute| {
            let args = attribute
                .args
                .iter()
                .map(|arg| match (&arg.name, &arg.value) {
                    (None, Expr::Number(n) | Expr::Ident(n) | Expr::String(n)) => Ok(n.clone()),
                    _ => context.fail(attribute.span, format!("@{} has an invalid argument", attribute.name)),
                })
                .collect::<Result<Vec<_>>>()?;
            Ok::<_, anyhow::Error>((attribute.name["db.".len()..].to_owned(), args))
        })
        .transpose()
}

fn resolve_field(context: &Context, declared: &BTreeMap<&str, Declared>, enums: &[Enum], field: &Field) -> Result<ModelField> {
    let kind = field_kind(context, declared, field)?;
    let allowed: &[&str] = match kind {
        Kind::Relation(_) => &["relation", "ignore"],
        Kind::Composite => &["map", "ignore"],
        _ => &["id", "unique", "default", "map", "updatedAt", "ignore", "shardKey"],
    };
    check_attributes(
        context,
        &field.attributes,
        allowed,
        !matches!(kind, Kind::Relation(_) | Kind::Composite),
    )?;
    for attribute in &field.attributes {
        if matches!(attribute.name.as_str(), "updatedAt" | "ignore" | "shardKey") && !attribute.args.is_empty() {
            return context.fail(attribute.span, format!("@{} takes no arguments", attribute.name));
        }
    }
    let default = default(context, field, &kind, enums)?;
    let native_type = native_type(context, field)?;
    Ok(ModelField {
        name: field.name.clone(),
        db_name: mapped(context, &field.attributes)?,
        arity: field.arity,
        ignored: field.attributes.iter().any(|a| a.name == "ignore"),
        default,
        native_type,
        updated_at: field.attributes.iter().any(|a| a.name == "updatedAt"),
        relation: None,
        relation_args: field.attributes.iter().find(|a| a.name == "relation").map(|a| a.args.clone()),
        span: field.span,
        kind,
    })
}

pub(super) fn resolve_model(context: &Context, declared: &BTreeMap<&str, Declared>, enums: &[Enum], block: &Block) -> Result<Model> {
    check_attributes(
        context,
        &block.attributes,
        &["id", "unique", "index", "fulltext", "map", "schema", "ignore", "shardKey"],
        false,
    )?;
    if let Some(attribute) = block.attributes.iter().find(|a| a.name == "ignore" && !a.args.is_empty()) {
        return context.fail(attribute.span, "@@ignore takes no arguments");
    }
    let namespace = namespace(context, &block.attributes)?;
    let mut fields = Vec::new();
    let mut names = BTreeSet::new();
    for field in &block.fields {
        if !names.insert(field.name.as_str()) {
            return context.fail(
                field.span,
                format!("{} {} repeats field {}", block.kind.keyword(), block.name, field.name),
            );
        }
        fields.push(resolve_field(context, declared, enums, field)?);
    }
    Ok(Model {
        name: block.name.clone(),
        view: block.kind == BlockKind::View,
        db_name: mapped(context, &block.attributes)?,
        namespace,
        ignored: block.attributes.iter().any(|a| a.name == "ignore"),
        fields,
        indexes: vec![],
        span: block.span,
    })
}
