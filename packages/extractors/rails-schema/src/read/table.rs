//! `create_table` and the statements that add indexes, checks and foreign keys to a table.

use super::columns::{block_statement, implicit_primary_key};
use super::values::json;
use super::{Constraint, ForeignKey, Schema, Table, first_name};
use anyhow::Result;
use projections_extractor_ruby_support::{Call, Expr, Kind, inflect::Inflections};
use serde_json::{Map, Value, json};

/// Table options kept as table data, by their keys in data.
const TABLE_OPTIONS: [(&str, &str); 6] = [
    ("comment", "comment"),
    ("options", "options"),
    ("charset", "charset"),
    ("collation", "collation"),
    ("temporary", "temporary"),
    ("unlogged", "unlogged"),
];

pub(super) fn create_table(schema: &mut Schema, call: &Call, line: usize, inflections: &Inflections) -> Result<()> {
    let Some(name) = first_name(call) else {
        schema.skip(line, "create_table with a computed name");
        return Ok(());
    };
    let mut table = Table {
        name,
        line,
        ..Table::default()
    };
    for (option, key) in TABLE_OPTIONS {
        if let Some(value) = call.option(option) {
            table.data.insert(key.into(), json(value));
        }
    }
    let composite = implicit_primary_key(&mut table, call);
    if let Some(block) = &call.block {
        let param = block.params.first().map(String::as_str).unwrap_or("t");
        for statement in &block.body {
            block_statement(schema, &mut table, statement, param, inflections);
        }
    }
    for column in table.columns.iter_mut().filter(|c| composite.contains(&c.name)) {
        column.primary_key = true;
        column.nullable = false;
    }
    let keys: Vec<String> = table.columns.iter().filter(|c| c.primary_key).map(|c| c.name.clone()).collect();
    if !keys.is_empty() {
        table.constraints.insert(
            0,
            Constraint {
                kind: "primary-key",
                name: None,
                columns: keys,
                line,
                data: Map::new(),
            },
        );
    }
    schema.tables.push(table);
    Ok(())
}

/// Rails' default index name: `index_<table>_on_<a>_and_<b>`.
fn index_name(table: &str, columns: &[String]) -> String {
    format!("index_{table}_on_{}", columns.join("_and_"))
}

/// An index from `t.index` (the table is known) or `add_index` (it is the first argument).
pub(super) fn index(table: &str, call: &Call, target: Option<&Expr>, line: usize) -> Option<Constraint> {
    let target = target?;
    let (columns, expression) = match &target.kind {
        Kind::Array(_) => (target.names()?, None),
        Kind::Symbol(column) => (vec![column.clone()], None),
        Kind::Str {
            value,
            interpolated: false,
        } => (vec![], Some(value.clone())),
        _ => return None,
    };
    let unique = call.option("unique").is_some_and(|u| u.kind == Kind::Bool(true));
    let name = call
        .option("name")
        .and_then(Expr::name)
        .map(str::to_owned)
        .unwrap_or_else(|| index_name(table, &columns));
    let mut data = Map::new();
    if let Some(expression) = expression {
        data.insert("expression".into(), json!(expression));
    }
    for (option, key) in [
        ("where", "where"),
        ("using", "using"),
        ("order", "order"),
        ("length", "length"),
        ("opclass", "opclass"),
        ("include", "include"),
        ("type", "indexType"),
        ("nulls_not_distinct", "nullsNotDistinct"),
        ("comment", "comment"),
    ] {
        if let Some(value) = call.option(option) {
            data.insert(key.into(), json(value));
        }
    }
    Some(Constraint {
        kind: if unique { "unique" } else { "index" },
        name: Some(name),
        columns,
        line,
        data,
    })
}

/// `t.check_constraint` and `add_check_constraint`: an expression and its name.
pub(super) fn check(call: &Call, expression: Option<&Expr>, line: usize) -> Option<Constraint> {
    let expression = expression?.string()?;
    let mut data = Map::from_iter([("expression".to_owned(), json!(expression))]);
    if let Some(validate) = call.option("validate") {
        data.insert("validate".into(), json(validate));
    }
    Some(Constraint {
        kind: "check",
        name: call.option("name").and_then(Expr::name).map(str::to_owned),
        columns: vec![],
        line,
        data,
    })
}

pub(super) fn add_index(schema: &mut Schema, expr: &Expr, call: &Call) {
    let mut args = call.positional();
    let (Some(table), target) = (args.next().and_then(Expr::name), args.next()) else {
        return schema.skip(expr.line, &expr.text);
    };
    match (index(table, call, target, expr.line), schema.table_mut(table)) {
        (Some(index), Some(table)) => table.constraints.push(index),
        _ => schema.skip(expr.line, &expr.text),
    }
}

pub(super) fn add_check_constraint(schema: &mut Schema, expr: &Expr, call: &Call) {
    let mut args = call.positional();
    let (Some(table), expression) = (args.next().and_then(Expr::name), args.next()) else {
        return schema.skip(expr.line, &expr.text);
    };
    match (check(call, expression, expr.line), schema.table_mut(table)) {
        (Some(check), Some(table)) => table.constraints.push(check),
        _ => schema.skip(expr.line, &expr.text),
    }
}

/// A foreign key from `from` to `to`. Rails' defaults: the column is the
/// singular target table name with `_id`, and the referenced column is `id`.
pub(super) fn foreign_key(from: &str, to: &str, call: &Call, line: usize, inflections: &Inflections) -> Option<ForeignKey> {
    let columns = match call.option("column") {
        Some(column) => column.names()?,
        None => {
            let table = to.rsplit('.').next().unwrap_or(to);
            vec![format!("{}_id", inflections.singularize(table))]
        }
    };
    let references = match call.option("primary_key") {
        Some(key) => key.names()?,
        None => vec!["id".to_owned()],
    };
    let mut data = Map::new();
    for (option, key) in [
        ("name", "name"),
        ("on_delete", "onDelete"),
        ("on_update", "onUpdate"),
        ("validate", "validate"),
        ("deferrable", "deferrable"),
    ] {
        if let Some(value) = call.option(option) {
            data.insert(key.into(), json(value));
        }
    }
    Some(ForeignKey {
        from: from.to_owned(),
        to: to.to_owned(),
        columns,
        references,
        line,
        data,
    })
}

pub(super) fn add_foreign_key(schema: &mut Schema, expr: &Expr, call: &Call, inflections: &Inflections) {
    let names: Vec<&str> = call.positional().filter_map(Expr::name).collect();
    match names.as_slice() {
        [from, to] => match foreign_key(from, to, call, expr.line, inflections) {
            Some(key) => schema.foreign_keys.push(key),
            None => schema.skip(expr.line, &expr.text),
        },
        _ => schema.skip(expr.line, &expr.text),
    }
}

/// The options of a call that aren't read specially, as JSON.
pub(super) fn remaining(call: &Call, read: &[&str]) -> Map<String, Value> {
    call.pairs()
        .filter_map(|(key, value)| key.name().map(|k| (k, value)))
        .filter(|(key, _)| !read.contains(key))
        .map(|(key, value)| (key.to_owned(), json(value)))
        .collect()
}
