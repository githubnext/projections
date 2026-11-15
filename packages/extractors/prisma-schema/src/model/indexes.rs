//! Resolves ids, unique constraints and indexes from field and block attributes.

use super::attributes::{arguments, arguments_at, flag, string};
use super::context::Context;
use super::types::{Index, IndexField, IndexKind, Kind, Model};
use crate::parse::{Arg, Attribute, Block, Expr, Field, Span};
use anyhow::Result;
use std::collections::BTreeMap;

fn sort(context: &Context, span: Span, value: Option<&&Expr>) -> Result<Option<&'static str>> {
    match value {
        None => Ok(None),
        Some(Expr::Ident(s)) if s == "Asc" => Ok(Some("asc")),
        Some(Expr::Ident(s)) if s == "Desc" => Ok(Some("desc")),
        Some(_) => context.fail(span, "sort must be Asc or Desc"),
    }
}

fn length(context: &Context, span: Span, value: Option<&&Expr>) -> Result<Option<u64>> {
    match value {
        None => Ok(None),
        Some(Expr::Number(n)) if n.parse::<u64>().is_ok() => Ok(Some(n.parse().unwrap())),
        Some(_) => context.fail(span, "length must be a nonnegative integer"),
    }
}

fn indexed_field(context: &Context, model: &Model, span: Span, name: &str) -> Result<()> {
    if name.contains('.') {
        return context.fail(
            span,
            format!("index path {name} into a composite type is not supported; supply inputs.snapshot"),
        );
    }
    match model.field(name) {
        Some(field) if !matches!(field.kind, Kind::Relation(_) | Kind::Composite) => Ok(()),
        Some(_) => context.fail(span, format!("index field {}.{name} is not a scalar field", model.name)),
        None => context.fail(span, format!("index references unknown field {}.{name}", model.name)),
    }
}

/// An index field's `ops` operator class: a name or `raw("...")`.
fn operator_class(context: &Context, span: Span, value: Option<&&Expr>) -> Result<Option<String>> {
    match value {
        None => Ok(None),
        Some(Expr::Ident(class)) => Ok(Some(class.clone())),
        Some(Expr::Call(raw, raw_args)) if raw == "raw" => match raw_args.as_slice() {
            [
                Arg {
                    name: None,
                    value: Expr::String(class),
                },
            ] => Ok(Some(class.clone())),
            _ => context.fail(span, "raw() requires one string"),
        },
        Some(_) => context.fail(span, "ops must be an operator class"),
    }
}

/// One item of an index's field list: a field name, optionally called with arguments.
fn index_field(context: &Context, span: Span, item: &Expr, operator_classes: bool) -> Result<IndexField> {
    match item {
        Expr::Ident(name) => Ok(IndexField {
            name: name.clone(),
            sort: None,
            length: None,
            operator_class: None,
        }),
        Expr::Call(name, args) => {
            let named: &[&str] = if operator_classes {
                &["sort", "length", "ops"]
            } else {
                &["sort", "length"]
            };
            let args = arguments_at(context, span, name, args, &[], named)?;
            let operator_class = operator_class(context, span, args.get("ops"))?;
            Ok(IndexField {
                name: name.clone(),
                sort: sort(context, span, args.get("sort"))?,
                length: length(context, span, args.get("length"))?,
                operator_class,
            })
        }
        _ => context.fail(span, "index fields must be field names"),
    }
}

fn index_fields(context: &Context, model: &Model, span: Span, value: &Expr, operator_classes: bool) -> Result<Vec<IndexField>> {
    let Expr::Array(items) = value else {
        return context.fail(span, "index fields must be a list");
    };
    if items.is_empty() {
        return context.fail(span, "index fields must not be empty");
    }
    let mut fields = Vec::new();
    for item in items {
        let field = index_field(context, span, item, operator_classes)?;
        indexed_field(context, model, span, &field.name)?;
        fields.push(field);
    }
    Ok(fields)
}

/// A field's `@id` or `@unique` attribute as a single-field index.
fn field_index(context: &Context, field: &Field, attribute: &Attribute, kind: IndexKind) -> Result<Index> {
    let args = arguments(context, attribute, &[], &["map", "length", "sort", "clustered"])?;
    Ok(Index {
        kind,
        db_name: args.get("map").map(|v| string(context, attribute.span, "map", v)).transpose()?,
        fields: vec![IndexField {
            name: field.name.clone(),
            sort: sort(context, attribute.span, args.get("sort"))?,
            length: length(context, attribute.span, args.get("length"))?,
            operator_class: None,
        }],
        algorithm: None,
        clustered: flag(context, attribute.span, "clustered", args.get("clustered"))?,
        span: attribute.span,
    })
}

/// The database name of a block index. `name` is the client name of ids and
/// unique constraints, but a legacy alias for `map` on indexes.
fn block_index_name(context: &Context, attribute: &Attribute, kind: IndexKind, args: &BTreeMap<String, &Expr>) -> Result<Option<String>> {
    let map = args.get("map").map(|v| string(context, attribute.span, "map", v)).transpose()?;
    if !matches!(kind, IndexKind::Normal | IndexKind::Fulltext) {
        return Ok(map);
    }
    let name = args.get("name").map(|v| string(context, attribute.span, "name", v)).transpose()?;
    if name.is_some() && map.is_some() {
        return context.fail(attribute.span, format!("@@{} accepts name or map, not both", attribute.name));
    }
    Ok(map.or(name))
}

/// A block's `@@id`, `@@unique`, `@@index` or `@@fulltext` attribute as an index.
fn block_index(context: &Context, model: &Model, attribute: &Attribute, kind: IndexKind, named: &[&str]) -> Result<Index> {
    let args = arguments(context, attribute, &["fields"], named)?;
    let Some(fields) = args.get("fields") else {
        return context.fail(attribute.span, format!("@@{} requires fields", attribute.name));
    };
    let db_name = block_index_name(context, attribute, kind, &args)?;
    let algorithm = match args.get("type") {
        None => None,
        Some(Expr::Ident(algorithm)) => Some(algorithm.clone()),
        Some(_) => return context.fail(attribute.span, "index type must be an identifier"),
    };
    Ok(Index {
        kind,
        db_name,
        fields: index_fields(context, model, attribute.span, fields, kind == IndexKind::Normal)?,
        algorithm,
        clustered: flag(context, attribute.span, "clustered", args.get("clustered"))?,
        span: attribute.span,
    })
}

pub(super) fn indexes(context: &Context, model: &Model, block: &Block) -> Result<Vec<Index>> {
    let mut result = Vec::new();
    for field in &block.fields {
        for attribute in &field.attributes {
            let kind = match attribute.name.as_str() {
                "id" => IndexKind::Id,
                "unique" => IndexKind::Unique,
                _ => continue,
            };
            result.push(field_index(context, field, attribute, kind)?);
        }
    }
    for attribute in &block.attributes {
        let (kind, named): (IndexKind, &[&str]) = match attribute.name.as_str() {
            "id" => (IndexKind::Id, &["name", "map", "clustered"]),
            "unique" => (IndexKind::Unique, &["name", "map", "clustered"]),
            "index" => (IndexKind::Normal, &["name", "map", "type", "clustered"]),
            "fulltext" => (IndexKind::Fulltext, &["name", "map"]),
            _ => continue,
        };
        result.push(block_index(context, model, attribute, kind, named)?);
    }
    Ok(result)
}
