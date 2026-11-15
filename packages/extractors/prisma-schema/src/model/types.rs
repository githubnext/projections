//! The resolved data model: models, fields, enums, relations and indexes.

use crate::parse::{Arg, Arity, Block, Span};
use serde_json::Value;

#[derive(Debug)]
pub struct Schema {
    pub provider: Option<String>,
    pub enums: Vec<Enum>,
    pub models: Vec<Model>,
}

#[derive(Debug)]
pub struct Enum {
    pub name: String,
    pub db_name: Option<String>,
    /// The database schema (`@@schema`), with multiSchema.
    pub namespace: Option<String>,
    /// Value names and their database names.
    pub values: Vec<(String, Option<String>)>,
    pub span: Span,
}

impl Enum {
    pub fn database_name(&self) -> &str {
        self.db_name.as_deref().unwrap_or(&self.name)
    }
}

#[derive(Debug)]
pub struct Model {
    pub name: String,
    /// Whether this is a `view` block rather than a `model`.
    pub view: bool,
    pub db_name: Option<String>,
    pub namespace: Option<String>,
    pub ignored: bool,
    pub fields: Vec<ModelField>,
    pub indexes: Vec<Index>,
    pub span: Span,
}

impl Model {
    pub fn database_name(&self) -> &str {
        self.db_name.as_deref().unwrap_or(&self.name)
    }
    pub fn field(&self, name: &str) -> Option<&ModelField> {
        self.fields.iter().find(|field| field.name == name)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Kind {
    Scalar(String),
    /// Index into [`Schema::enums`].
    Enum(usize),
    /// Index into [`Schema::models`].
    Relation(usize),
    Composite,
    Unsupported,
}

#[derive(Debug)]
pub struct ModelField {
    pub name: String,
    pub db_name: Option<String>,
    pub kind: Kind,
    pub arity: Arity,
    pub ignored: bool,
    pub default: Option<Value>,
    pub native_type: Option<(String, Vec<String>)>,
    pub updated_at: bool,
    pub relation: Option<Relation>,
    /// The `@relation` arguments of a relation field, resolved with all models.
    pub(super) relation_args: Option<Vec<Arg>>,
    pub span: Span,
}

impl ModelField {
    pub fn database_name(&self) -> &str {
        self.db_name.as_deref().unwrap_or(&self.name)
    }
    /// Whether the field is a database column in the extraction.
    pub fn is_column(&self) -> bool {
        !self.ignored && matches!(self.kind, Kind::Scalar(_) | Kind::Enum(_))
    }
}

#[derive(Debug, Default)]
pub struct Relation {
    pub name: String,
    pub fields: Vec<String>,
    pub references: Vec<String>,
    pub on_delete: Option<String>,
    pub on_update: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexKind {
    Id,
    Unique,
    Normal,
    Fulltext,
}

#[derive(Debug)]
pub struct Index {
    pub kind: IndexKind,
    pub db_name: Option<String>,
    pub fields: Vec<IndexField>,
    pub algorithm: Option<String>,
    pub clustered: Option<bool>,
    pub span: Span,
}

#[derive(Debug)]
pub struct IndexField {
    /// The Prisma field name.
    pub name: String,
    pub sort: Option<&'static str>,
    pub length: Option<u64>,
    pub operator_class: Option<String>,
}

/// One schema file's blocks, with its repository-relative path.
pub struct File<'a> {
    pub path: &'a str,
    pub blocks: Vec<Block>,
}
