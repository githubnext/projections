//! The `database/v0` extraction of read schemas.

use crate::read::{Column, Constraint, ForeignKey, Schema, Table};
use anyhow::{Result, bail};
use projections_extractor_sdk::{percent, stable};
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

fn id(kind: &str, parts: &[&str]) -> String {
    format!("{kind}:{}", parts.iter().map(|p| percent(p)).collect::<Vec<_>>().join("/"))
}

/// One schema file and the database it describes: `""` for the primary
/// database (`db/schema.rb`), otherwise its name (`db/queue_schema.rb` is `queue`).
pub struct Source<'a> {
    pub path: &'a str,
    pub database: &'a str,
    pub schema: &'a Schema,
}

struct Builder {
    entities: Vec<Value>,
    relationships: Vec<Value>,
    ids: BTreeSet<String>,
}

impl Builder {
    fn claim(&mut self, identity: &str, path: &str, line: usize) -> Result<()> {
        if !self.ids.insert(identity.to_owned()) {
            bail!("{path}:{line} declares {identity} more than once");
        }
        Ok(())
    }

    fn entity(&mut self, kind: &str, identity: String, label: &str, data: Value, path: &str, line: usize) -> Result<String> {
        self.claim(&identity, path, line)?;
        self.entities.push(json!({
            "id":identity,"kind":kind,"label":label,"data":data,"confidence":"authoritative",
            "evidence":[{"kind":"rails-schema","source":path,"location":{"line":line}}],
        }));
        Ok(identity)
    }

    fn relationship(&mut self, kind: &str, from: &str, to: &str, discriminator: &str, path: &str, line: usize) -> Result<()> {
        let identity = id(kind, &[from, to, discriminator]);
        self.claim(&identity, path, line)?;
        self.relationships.push(json!({
            "id":identity,"kind":kind,"from":from,"to":to,"confidence":"authoritative",
            "evidence":[{"kind":"rails-schema","source":path,"location":{"line":line}}],
        }));
        Ok(())
    }
}

fn table_id(database: &str, name: &str, view: bool) -> String {
    id(if view { "view" } else { "table" }, &[database, name])
}

fn enum_id(database: &str, name: &str) -> String {
    if database.is_empty() {
        id("enum", &[name])
    } else {
        id("enum", &[database, name])
    }
}

fn argument(value: &Value) -> String {
    value.as_str().map_or_else(|| value.to_string(), str::to_owned)
}

/// The type a column shows: its Rails type with its size (`string(100)`,
/// `decimal(10,2)`, `datetime(6)`), a PostgreSQL enum's name, and `[]` for an array.
pub fn shown_type(column: &Column) -> String {
    let options = &column.options;
    let base = options.get("enum_type").and_then(Value::as_str).unwrap_or(&column.rails_type);
    let args: Vec<String> = match (options.get("limit"), options.get("precision"), options.get("scale")) {
        (Some(limit), ..) if !limit.is_null() => vec![argument(limit)],
        (_, Some(precision), scale) if !precision.is_null() => std::iter::once(precision)
            .chain(scale.filter(|s| !s.is_null()))
            .map(argument)
            .collect(),
        _ => vec![],
    };
    let mut shown = if args.is_empty() {
        base.to_owned()
    } else {
        format!("{base}({})", args.join(","))
    };
    if options.get("array") == Some(&json!(true)) {
        shown.push_str("[]");
    }
    shown
}

fn column(builder: &mut Builder, source: &Source, table_id: &str, column: &Column) -> Result<()> {
    let mut data = Map::new();
    data.insert("table".into(), json!(table_id));
    data.insert("type".into(), json!(shown_type(column)));
    data.insert("railsType".into(), json!(column.rails_type));
    data.insert("nullable".into(), json!(column.nullable));
    data.insert("primaryKey".into(), json!(column.primary_key));
    data.insert("hasDefault".into(), json!(column.default.is_some()));
    data.insert("default".into(), column.default.clone().unwrap_or(Value::Null));
    for (key, value) in &column.options {
        data.insert(key.clone(), value.clone());
    }
    let identity = id("column", &[table_id, &column.name]);
    let col = builder.entity("column", identity, &column.name, Value::Object(data), source.path, column.line)?;
    builder.relationship("contains", table_id, &col, "", source.path, column.line)?;
    if let Some(name) = column.options.get("enum_type").and_then(Value::as_str) {
        let target = enum_id(source.database, name);
        if builder.ids.contains(&target) {
            builder.relationship("enum-type", &col, &target, "", source.path, column.line)?;
        }
    }
    Ok(())
}

fn constraint(builder: &mut Builder, source: &Source, table: &Table, table_id: &str, item: &Constraint) -> Result<()> {
    let discriminator = item
        .name
        .clone()
        .or_else(|| item.data.get("expression").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| stable(&json!(item.columns)));
    let identity = id("constraint", &[table_id, item.kind, &discriminator]);
    let label = item
        .name
        .clone()
        .unwrap_or_else(|| match item.data.get("expression").and_then(Value::as_str) {
            Some(expression) if item.columns.is_empty() => format!("{} ({expression})", item.kind),
            _ => format!("{} ({})", item.kind, item.columns.join(", ")),
        });
    let mut data = Map::new();
    data.insert("table".into(), json!(table_id));
    data.insert("type".into(), json!(item.kind));
    data.insert("columns".into(), json!(item.columns));
    data.insert("databaseName".into(), json!(item.name));
    for (key, value) in &item.data {
        data.insert(key.clone(), value.clone());
    }
    let constraint = builder.entity("constraint", identity, &label, Value::Object(data), source.path, item.line)?;
    builder.relationship("contains", table_id, &constraint, "", source.path, item.line)?;
    for name in &item.columns {
        if table.columns.iter().any(|c| &c.name == name) {
            builder.relationship(
                "constrains",
                &constraint,
                &id("column", &[table_id, name]),
                "",
                source.path,
                item.line,
            )?;
        }
    }
    Ok(())
}

fn foreign_key(builder: &mut Builder, source: &Source, key: &ForeignKey) -> Result<()> {
    let tables = &source.schema.tables;
    let (Some(from), target) = (tables.iter().find(|t| t.name == key.from), tables.iter().find(|t| t.name == key.to)) else {
        bail!(
            "{}:{} adds a foreign key to {}, which the schema doesn't create",
            source.path,
            key.line,
            key.from
        );
    };
    let (from_id, to_id) = (
        table_id(source.database, &from.name, from.view),
        table_id(source.database, &key.to, false),
    );
    let identity = id("constraint", &[&from_id, "foreign-key", &stable(&json!(key.columns)), &to_id]);
    let mut data = Map::new();
    data.insert("table".into(), json!(from_id));
    data.insert("type".into(), json!("foreign-key"));
    data.insert("columns".into(), json!(key.columns));
    data.insert("target".into(), json!(to_id));
    data.insert("references".into(), json!(key.references));
    for (k, value) in &key.data {
        data.insert(k.clone(), value.clone());
    }
    let label = format!("foreign-key ({})", key.columns.join(", "));
    let constraint = builder.entity("constraint", identity, &label, Value::Object(data), source.path, key.line)?;
    builder.relationship("contains", &from_id, &constraint, "", source.path, key.line)?;
    // A key to a table in another database or schema file links to nothing here.
    if let Some(target) = target {
        builder.relationship("references", &constraint, &to_id, "", source.path, key.line)?;
        for (column, reference) in key.columns.iter().zip(&key.references) {
            let has = |table: &Table, name: &str| table.columns.iter().any(|c| c.name == name);
            if !has(from, column) {
                continue;
            }
            let column_id = id("column", &[&from_id, column]);
            builder.relationship("constrains", &constraint, &column_id, "", source.path, key.line)?;
            if has(target, reference) {
                let reference_id = id("column", &[&to_id, reference]);
                builder.relationship("foreign-key", &column_id, &reference_id, &constraint, source.path, key.line)?;
            }
        }
    }
    Ok(())
}

/// The entities and relationships of every source.
pub fn extraction(sources: &[Source]) -> Result<(Vec<Value>, Vec<Value>)> {
    let mut builder = Builder {
        entities: vec![],
        relationships: vec![],
        ids: BTreeSet::new(),
    };
    for source in sources {
        let (schema, database) = (source.schema, source.database);
        let namespace = if database.is_empty() { Value::Null } else { json!(database) };
        for item in &schema.enums {
            let mut data = item.data.clone();
            data.insert("database".into(), namespace.clone());
            builder.entity(
                "enum",
                enum_id(database, &item.name),
                &item.name,
                Value::Object(data),
                source.path,
                item.line,
            )?;
        }
        for table in &schema.tables {
            let table_id = table_id(database, &table.name, table.view);
            let mut data = table.data.clone();
            data.insert("database".into(), namespace.clone());
            let kind = if table.view { "view" } else { "table" };
            builder.entity(kind, table_id.clone(), &table.name, Value::Object(data), source.path, table.line)?;
            for item in &table.columns {
                column(&mut builder, source, &table_id, item)?;
            }
            for item in &table.constraints {
                constraint(&mut builder, source, table, &table_id, item)?;
            }
        }
        for key in &schema.foreign_keys {
            foreign_key(&mut builder, source, key)?;
        }
    }
    Ok((builder.entities, builder.relationships))
}
