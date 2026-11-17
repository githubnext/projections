//! Columns and the other statements of a `create_table` block.

use super::table::{check, foreign_key, index, remaining};
use super::values::json;
use super::{Column, Constraint, Schema, Table};
use projections_extractor_ruby_support::{Call, Expr, Kind, Stmt, inflect::Inflections};
use serde_json::{Map, Value, json};

/// Options read into a column's own fields rather than its other options.
const READ: [&str; 5] = ["null", "default", "primary_key", "type", "index"];

fn is_false(expr: Option<&Expr>) -> bool {
    expr.is_some_and(|e| e.kind == Kind::Bool(false))
}

fn is_true(expr: Option<&Expr>) -> bool {
    expr.is_some_and(|e| e.kind == Kind::Bool(true))
}

/// A column named `name` of `rails_type`, with the options of `call`.
fn column(name: &str, rails_type: &str, call: &Call, line: usize, precise: bool) -> Column {
    let mut options = remaining(call, &READ);
    if matches!(rails_type, "datetime" | "timestamp") {
        match options.get("precision") {
            // Rails 7.0 made 6 the default precision; `precision: nil` asks for none.
            None if precise => {
                options.insert("precision".into(), json!(6));
            }
            Some(Value::Null) => {
                options.remove("precision");
            }
            _ => {}
        }
    }
    let primary_key = is_true(call.option("primary_key"));
    Column {
        name: name.to_owned(),
        line,
        rails_type: rails_type.to_owned(),
        nullable: !primary_key && !is_false(call.option("null")),
        primary_key,
        default: call.option("default").map(json).filter(|d| !d.is_null()),
        options,
    }
}

/// The primary key `create_table` adds itself, unless `id: false` or a
/// composite `primary_key:`; returns the composite key's column names.
pub(super) fn implicit_primary_key(table: &mut Table, call: &Call) -> Vec<String> {
    let key = call.option("primary_key");
    if let Some(Kind::Array(_)) = key.map(|k| &k.kind) {
        return key.and_then(Expr::names).unwrap_or_default();
    }
    let id = call.option("id");
    if is_false(id) {
        return vec![];
    }
    let name = key.and_then(Expr::name).unwrap_or("id");
    let rails_type = match id {
        Some(id) => match (&id.kind, id.get("type")) {
            (Kind::Hash(_), Some(ty)) => ty.name().unwrap_or("bigint"),
            _ => id.name().unwrap_or("bigint"),
        },
        None => "bigint",
    };
    let mut options = Map::new();
    if let Some(limit) = call.option("limit") {
        options.insert("limit".into(), json(limit));
    }
    table.columns.push(Column {
        name: name.to_owned(),
        line: table.line,
        rails_type: rails_type.to_owned(),
        nullable: false,
        primary_key: true,
        default: call.option("default").map(json).filter(|d| !d.is_null()),
        options,
    });
    vec![]
}

/// `t.references :user`: `user_id` (and `user_type` when polymorphic) and, by default, their index.
fn references(schema: &mut Schema, table: &mut Table, call: &Call, line: usize, inflections: &Inflections) {
    let precise = schema.precise_datetimes();
    for name in call.positional().filter_map(Expr::name) {
        let id_type = call.option("type").and_then(Expr::name).unwrap_or("bigint");
        let mut columns = vec![column(&format!("{name}_id"), id_type, call, line, precise)];
        if is_true(call.option("polymorphic")) {
            columns.insert(0, column(&format!("{name}_type"), "string", call, line, precise));
        }
        for column in &mut columns {
            column
                .options
                .retain(|key, _| !matches!(key.as_str(), "polymorphic" | "foreign_key" | "type"));
        }
        let names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
        table.columns.extend(columns);
        if !is_false(call.option("index")) {
            let unique = call
                .option("index")
                .and_then(|i| i.get("unique"))
                .is_some_and(|u| u.kind == Kind::Bool(true));
            table.constraints.push(Constraint {
                kind: if unique { "unique" } else { "index" },
                name: Some(format!("index_{}_on_{}", table.name, names.join("_and_"))),
                columns: names,
                line,
                data: Map::new(),
            });
        }
        if let Some(key) = call
            .option("foreign_key")
            .filter(|k| !matches!(k.kind, Kind::Bool(false) | Kind::Nil))
        {
            let to = key
                .get("to_table")
                .and_then(Expr::name)
                .map_or_else(|| inflections.pluralize(name), str::to_owned);
            if let Some(mut key) = foreign_key(&table.name, &to, call, line, inflections) {
                key.columns = vec![format!("{name}_id")];
                schema.foreign_keys.push(key);
            }
        }
    }
}

/// One statement of a `create_table` block whose table parameter is `param`.
pub(super) fn block_statement(schema: &mut Schema, table: &mut Table, statement: &Stmt, param: &str, inflections: &Inflections) {
    let expr = match statement {
        Stmt::Expr(expr) => expr,
        Stmt::If { line, .. } => return schema.skip(*line, &super::conditional(statement)),
        Stmt::Other { line, text } => return schema.skip(*line, text),
    };
    let Some(call) = expr.call().filter(|c| c.receiver.as_ref().is_some_and(|r| r.text == param)) else {
        return schema.skip(expr.line, &expr.text);
    };
    let (line, precise) = (expr.line, schema.precise_datetimes());
    let first = call.positional().next();
    let constraint = match call.name.as_str() {
        "index" => Some(index(&table.name, call, first, line)),
        "check_constraint" => Some(check(call, first, line)),
        "unique_constraint" | "exclusion_constraint" => Some(table_constraint(call, first, line)),
        _ => None,
    };
    if let Some(constraint) = constraint {
        return match constraint {
            Some(constraint) => table.constraints.push(constraint),
            None => schema.skip(line, &expr.text),
        };
    }
    match call.name.as_str() {
        "foreign_key" => match first
            .and_then(Expr::name)
            .and_then(|to| foreign_key(&table.name, to, call, line, inflections))
        {
            Some(key) => schema.foreign_keys.push(key),
            None => schema.skip(line, &expr.text),
        },
        "references" | "belongs_to" => references(schema, table, call, line, inflections),
        "timestamps" => {
            for name in ["created_at", "updated_at"] {
                let mut column = column(name, "datetime", call, line, precise);
                column.nullable = call.option("null").is_some_and(|n| n.kind == Kind::Bool(true));
                table.columns.push(column);
            }
        }
        "column" => match (first.and_then(Expr::name), call.positional().nth(1).and_then(Expr::name)) {
            (Some(name), Some(ty)) => table.columns.push(column(name, ty, call, line, precise)),
            _ => schema.skip(line, &expr.text),
        },
        ty => {
            let names: Vec<&str> = call.positional().filter_map(Expr::name).collect();
            if names.is_empty() || names.len() != call.positional().count() {
                return schema.skip(line, &expr.text);
            }
            let ty = if ty == "virtual" {
                call.option("type").and_then(Expr::name).unwrap_or("virtual")
            } else {
                ty
            };
            for name in names {
                let mut column = column(name, ty, call, line, precise);
                if call.name == "virtual" {
                    column.options.insert("virtual".into(), json!(true));
                }
                table.columns.push(column);
            }
        }
    }
}

/// `t.unique_constraint ["a", "b"]` or `t.exclusion_constraint "expression"`.
fn table_constraint(call: &Call, first: Option<&Expr>, line: usize) -> Option<Constraint> {
    let first = first?;
    let unique = call.name == "unique_constraint";
    let mut data = remaining(call, &["name"]);
    let columns = if unique {
        first.names()?
    } else {
        data.insert("expression".into(), json!(first.string()?));
        vec![]
    };
    Some(Constraint {
        kind: if unique { "unique" } else { "exclusion" },
        name: call.option("name").and_then(Expr::name).map(str::to_owned),
        columns,
        line,
        data,
    })
}
