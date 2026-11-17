//! The schema a `db/schema.rb` declares, read without running Ruby.

mod columns;
mod table;
mod values;

use anyhow::{Result, bail};
use projections_extractor_ruby_support::{Call, Expr, Kind, Stmt, inflect::Inflections};
use serde_json::{Map, Value, json};

#[derive(Debug, Default)]
pub struct Column {
    pub name: String,
    pub line: usize,
    /// The Rails type: the `t.<type>` method, `t.column`'s type or a virtual column's `type:`.
    pub rails_type: String,
    pub nullable: bool,
    pub primary_key: bool,
    pub default: Option<Value>,
    /// `limit`, `precision`, `scale`, `array` and the column's other options.
    pub options: Map<String, Value>,
}

#[derive(Debug)]
pub struct Constraint {
    /// `primary-key`, `index`, `unique`, `check` or `exclusion`.
    pub kind: &'static str,
    pub name: Option<String>,
    pub columns: Vec<String>,
    pub line: usize,
    pub data: Map<String, Value>,
}

#[derive(Debug, Default)]
pub struct Table {
    pub name: String,
    pub line: usize,
    pub view: bool,
    pub columns: Vec<Column>,
    pub constraints: Vec<Constraint>,
    pub data: Map<String, Value>,
}

#[derive(Debug)]
pub struct ForeignKey {
    pub from: String,
    pub to: String,
    pub columns: Vec<String>,
    pub references: Vec<String>,
    pub line: usize,
    pub data: Map<String, Value>,
}

#[derive(Debug)]
pub struct Named {
    pub name: String,
    pub line: usize,
    pub data: Map<String, Value>,
}

/// One schema file's declarations.
#[derive(Debug, Default)]
pub struct Schema {
    /// `ActiveRecord::Schema[7.1]`'s version, which decides defaults the file leaves out.
    pub format: Option<String>,
    /// The `define(version:)` migration version.
    pub version: Option<String>,
    pub tables: Vec<Table>,
    pub foreign_keys: Vec<ForeignKey>,
    pub enums: Vec<Named>,
    pub extensions: Vec<Named>,
    /// Statements that aren't schema declarations Projections reads: line and text.
    pub skipped: Vec<(usize, String)>,
}

impl Schema {
    /// Whether the format makes `datetime` columns default to precision 6 (Rails 7.0 and later).
    pub(crate) fn precise_datetimes(&self) -> bool {
        self.format
            .as_deref()
            .and_then(|f| f.split('.').next())
            .and_then(|major| major.parse::<u32>().ok())
            .is_some_and(|major| major >= 7)
    }

    pub(crate) fn table_mut(&mut self, name: &str) -> Option<&mut Table> {
        self.tables.iter_mut().find(|t| t.name == name)
    }

    pub(crate) fn skip(&mut self, line: usize, text: &str) {
        self.skipped.push((line, text.lines().next().unwrap_or_default().trim().to_owned()));
    }
}

/// The `ActiveRecord::Schema[7.1].define(version: ...)` call, its format and its block's statements.
fn definition(statements: &[Stmt]) -> Option<(Option<String>, &Call)> {
    statements.iter().find_map(|statement| {
        let Stmt::Expr(expr) = statement else { return None };
        let call = expr.call().filter(|c| c.name == "define" && c.block.is_some())?;
        let receiver = call.receiver.as_deref()?;
        let format = match &receiver.kind {
            Kind::Const(name) if name.ends_with("Schema") => None,
            Kind::Other => {
                let (head, index) = receiver.text.split_once('[')?;
                if !head.trim().ends_with("Schema") {
                    return None;
                }
                Some(index.trim_end_matches(']').trim().to_owned())
            }
            _ => return None,
        };
        Some((format, call))
    })
}

/// Reads the schema in `statements`, from the file `path`.
pub fn read(statements: &[Stmt], path: &str, inflections: &Inflections) -> Result<Schema> {
    let Some((format, define)) = definition(statements) else {
        bail!("{path} has no ActiveRecord::Schema.define block; it isn't a Rails schema file");
    };
    let mut schema = Schema {
        format,
        version: define.option("version").and_then(|v| match &v.kind {
            Kind::Number(n) => Some(n.clone()),
            _ => v.name().map(str::to_owned),
        }),
        ..Schema::default()
    };
    for statement in &define.block.as_ref().expect("define has a block").body {
        match statement {
            Stmt::Expr(expr) => match expr.call() {
                Some(call) if call.receiver.is_none() => statement_call(&mut schema, expr, call, inflections)?,
                _ => schema.skip(expr.line, &expr.text),
            },
            Stmt::If { line, .. } => schema.skip(*line, &conditional(statement)),
            Stmt::Other { line, text } => schema.skip(*line, text),
        }
    }
    Ok(schema)
}

/// A conditional statement as written: `t.string "x" if ENV["X"]`, or its first line.
pub(crate) fn conditional(statement: &Stmt) -> String {
    let Stmt::If {
        condition,
        negated,
        then,
        otherwise,
        ..
    } = statement
    else {
        return String::new();
    };
    let keyword = if *negated { "unless" } else { "if" };
    match (then.as_slice(), otherwise.is_empty()) {
        ([Stmt::Expr(expr)], true) => format!("{} {keyword} {condition}", expr.text),
        _ => format!("{keyword} {condition}"),
    }
}

fn first_name(call: &Call) -> Option<String> {
    call.positional().next().and_then(Expr::name).map(str::to_owned)
}

fn statement_call(schema: &mut Schema, expr: &Expr, call: &Call, inflections: &Inflections) -> Result<()> {
    let line = expr.line;
    match call.name.as_str() {
        "create_table" => table::create_table(schema, call, line, inflections)?,
        "enable_extension" => match first_name(call) {
            Some(name) => schema.extensions.push(Named {
                name,
                line,
                data: Map::new(),
            }),
            None => schema.skip(line, &expr.text),
        },
        "create_enum" => {
            let values = call.positional().nth(1).and_then(Expr::names);
            match (first_name(call), values) {
                (Some(name), Some(values)) => schema.enums.push(Named {
                    name,
                    line,
                    data: Map::from_iter([("values".to_owned(), json!(values))]),
                }),
                _ => schema.skip(line, &expr.text),
            }
        }
        "create_view" => match first_name(call) {
            Some(name) => {
                let mut data = Map::new();
                if let Some(sql) = call.option("sql_definition").and_then(Expr::string) {
                    data.insert("definition".into(), json!(sql.trim()));
                }
                if call.option("materialized").is_some_and(|m| m.kind == Kind::Bool(true)) {
                    data.insert("materialized".into(), json!(true));
                }
                schema.tables.push(Table {
                    name,
                    line,
                    view: true,
                    data,
                    ..Table::default()
                });
            }
            None => schema.skip(line, &expr.text),
        },
        "add_index" => table::add_index(schema, expr, call),
        "add_check_constraint" => table::add_check_constraint(schema, expr, call),
        "add_foreign_key" => table::add_foreign_key(schema, expr, call, inflections),
        _ => schema.skip(line, &expr.text),
    }
    Ok(())
}
