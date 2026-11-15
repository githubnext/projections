//! Default values, as Prisma's DMMF describes them.

use super::context::Context;
use super::datetime::rfc3339;
use super::types::{Enum, Kind};
use crate::parse::{Arity, Expr, Span};
use anyhow::Result;
use serde_json::{Number, Value, json};

const DEFAULT_FUNCTIONS: [&str; 9] = [
    "autoincrement",
    "now",
    "uuid",
    "cuid",
    "ulid",
    "nanoid",
    "dbgenerated",
    "auto",
    "sequence",
];

fn safe_integer(value: i64) -> bool {
    value.unsigned_abs() < (1u64 << 53)
}

/// A numeric literal as a JSON number: integers stay integers, as in Prisma's DMMF.
fn number(context: &Context, span: Span, literal: &str) -> Result<Value> {
    if let Ok(integer) = literal.parse::<i64>()
        && safe_integer(integer)
    {
        return Ok(json!(integer));
    }
    let float: f64 = match literal.parse() {
        Ok(value) => value,
        Err(_) => return context.fail(span, format!("invalid number {literal}")),
    };
    if float.fract() == 0.0 && float.abs() < 9_007_199_254_740_992.0 {
        return Ok(json!(float as i64));
    }
    match Number::from_f64(float) {
        Some(number) => Ok(Value::Number(number)),
        None => context.fail(span, format!("invalid number {literal}")),
    }
}

fn scalar_default(context: &Context, span: Span, kind: &Kind, enums: &[Enum], value: &Expr) -> Result<Value> {
    let mismatch = |expected: &str| -> Result<Value> { context.fail(span, format!("@default requires {expected}")) };
    match kind {
        Kind::Enum(index) => {
            let enumeration = &enums[*index];
            match value {
                Expr::Ident(name) if enumeration.values.iter().any(|(v, _)| v == name) => Ok(json!(name)),
                _ => mismatch(&format!("a value of enum {}", enumeration.name)),
            }
        }
        Kind::Scalar(scalar) => match (scalar.as_str(), value) {
            ("String" | "Json" | "Bytes", Expr::String(s)) => Ok(json!(s)),
            ("DateTime", Expr::String(s)) => match rfc3339(s) {
                Some(normalized) => Ok(json!(normalized)),
                None => mismatch("an RFC 3339 date-time"),
            },
            ("Boolean", Expr::Ident(b)) if b == "true" || b == "false" => Ok(json!(b == "true")),
            ("Int", Expr::Number(n)) if n.parse::<i64>().is_ok() => number(context, span, n),
            ("BigInt", Expr::Number(n)) if n.parse::<i128>().is_ok() => Ok(json!(n.parse::<i128>().unwrap().to_string())),
            ("Float", Expr::Number(n)) => number(context, span, n),
            ("Decimal", Expr::Number(n) | Expr::String(n)) => number(context, span, n),
            _ => mismatch(&format!("a {scalar} value")),
        },
        _ => mismatch("a scalar field"),
    }
}

/// The default as Prisma's DMMF describes it: a literal, or `{name, args}` for a
/// function. Fields without a column have no described default.
pub(super) fn default_value(
    context: &Context,
    span: Span,
    kind: &Kind,
    arity: Arity,
    enums: &[Enum],
    value: &Expr,
) -> Result<Option<Value>> {
    if matches!(kind, Kind::Unsupported) {
        return Ok(None);
    }
    if let Expr::Call(name, args) = value {
        if !DEFAULT_FUNCTIONS.contains(&name.as_str()) {
            return context.fail(span, format!("unknown @default function {name}()"));
        }
        let mut values = Vec::new();
        for arg in args.iter().filter(|arg| arg.name.is_none()) {
            values.push(match &arg.value {
                Expr::Number(n) => number(context, span, n)?,
                Expr::String(s) => json!(s),
                _ => return context.fail(span, format!("invalid argument to {name}()")),
            });
        }
        if values.is_empty() {
            match name.as_str() {
                "uuid" => values.push(json!(4)),
                "cuid" => values.push(json!(1)),
                _ => {}
            }
        }
        return Ok(Some(json!({"name": name, "args": values})));
    }
    match (arity, value) {
        (Arity::List, Expr::Array(items)) => items
            .iter()
            .map(|item| scalar_default(context, span, kind, enums, item))
            .collect::<Result<Vec<_>>>()
            .map(|items| Some(Value::Array(items))),
        (Arity::List, _) => context.fail(span, "@default of a list field requires a list"),
        (_, value) => scalar_default(context, span, kind, enums, value).map(Some),
    }
}
