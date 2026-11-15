//! Validation of attributes and reading of their argument values.

use super::context::Context;
use crate::parse::{Arg, Attribute, Expr, Span};
use anyhow::Result;
use std::collections::{BTreeMap, BTreeSet};

/// Rejects attributes outside `allowed` and repeated attributes. `native` also
/// allows `@db.*` native type attributes.
pub(super) fn check_attributes(context: &Context, attributes: &[Attribute], allowed: &[&str], native: bool) -> Result<()> {
    let mut seen = BTreeSet::new();
    for attribute in attributes {
        let name = attribute.name.as_str();
        let native_type = native && name.starts_with("db.");
        if !native_type && !allowed.contains(&name) {
            return context.fail(attribute.span, format!("unknown or misplaced attribute @{name}"));
        }
        let key = if native_type { "db" } else { name };
        let repeatable = matches!(name, "index" | "unique" | "fulltext");
        if !repeatable && !seen.insert(key) {
            return context.fail(attribute.span, format!("attribute @{name} is repeated"));
        }
    }
    Ok(())
}

/// Splits arguments into named values, assigning positional arguments in order
/// to `positional`, and rejects unknown or repeated names.
pub(super) fn arguments<'a>(
    context: &Context,
    attribute: &'a Attribute,
    positional: &[&str],
    named: &[&str],
) -> Result<BTreeMap<String, &'a Expr>> {
    arguments_at(
        context,
        attribute.span,
        &format!("@{}", attribute.name),
        &attribute.args,
        positional,
        named,
    )
}

pub(super) fn arguments_at<'a>(
    context: &Context,
    span: Span,
    label: &str,
    args: &'a [Arg],
    positional: &[&str],
    named: &[&str],
) -> Result<BTreeMap<String, &'a Expr>> {
    let mut result = BTreeMap::new();
    let mut index = 0;
    for arg in args {
        let name = match &arg.name {
            Some(name) => name.clone(),
            None => {
                let Some(name) = positional.get(index) else {
                    return context.fail(span, format!("{label} has too many arguments"));
                };
                index += 1;
                (*name).to_owned()
            }
        };
        if !named.contains(&name.as_str()) && !positional.contains(&name.as_str()) {
            return context.fail(span, format!("{label} has no argument `{name}`"));
        }
        if result.insert(name.clone(), &arg.value).is_some() {
            return context.fail(span, format!("{label} repeats argument `{name}`"));
        }
    }
    Ok(result)
}

pub(super) fn string(context: &Context, span: Span, label: &str, value: &Expr) -> Result<String> {
    match value {
        Expr::String(s) => Ok(s.clone()),
        _ => context.fail(span, format!("{label} must be a string")),
    }
}

pub(super) fn mapped(context: &Context, attributes: &[Attribute]) -> Result<Option<String>> {
    let Some(attribute) = attributes.iter().find(|a| a.name == "map") else {
        return Ok(None);
    };
    let args = arguments(context, attribute, &["name"], &[])?;
    let Some(value) = args.get("name") else {
        return context.fail(attribute.span, "@map requires a name");
    };
    string(context, attribute.span, "@map", value).map(Some)
}

/// The database schema an `@@schema` attribute names.
pub(super) fn namespace(context: &Context, attributes: &[Attribute]) -> Result<Option<String>> {
    attributes
        .iter()
        .find(|a| a.name == "schema")
        .map(|attribute| {
            let args = arguments(context, attribute, &["name"], &[])?;
            match args.get("name") {
                Some(value) => string(context, attribute.span, "@@schema", value),
                None => context.fail(attribute.span, "@@schema requires a name"),
            }
        })
        .transpose()
}

pub(super) fn names(context: &Context, span: Span, label: &str, value: &Expr) -> Result<Vec<String>> {
    match value {
        Expr::Array(items) => items
            .iter()
            .map(|item| match item {
                Expr::Ident(name) => Ok(name.clone()),
                _ => context.fail(span, format!("{label} must list field names")),
            })
            .collect(),
        _ => context.fail(span, format!("{label} must be a list of field names")),
    }
}

pub(super) fn flag(context: &Context, span: Span, label: &str, value: Option<&&Expr>) -> Result<Option<bool>> {
    match value {
        None => Ok(None),
        Some(Expr::Ident(b)) if b == "true" || b == "false" => Ok(Some(b == "true")),
        Some(_) => context.fail(span, format!("{label} must be true or false")),
    }
}
