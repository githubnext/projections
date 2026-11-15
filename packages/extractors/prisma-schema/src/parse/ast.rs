//! The syntax tree of a Prisma schema file: top-level blocks and their members.

/// A location in one schema file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub file: usize,
    pub line: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    String(String),
    /// A numeric literal, kept as written.
    Number(String),
    /// A constant or (dotted) identifier, including `true` and `false`.
    Ident(String),
    Array(Vec<Expr>),
    Call(String, Vec<Arg>),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Arg {
    pub name: Option<String>,
    pub value: Expr,
}

#[derive(Clone, Debug)]
pub struct Attribute {
    /// The name without `@`/`@@`, such as `id`, `relation` or `db.VarChar`.
    pub name: String,
    pub args: Vec<Arg>,
    pub span: Span,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Arity {
    Required,
    Optional,
    List,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TypeName {
    Named(String),
    Unsupported(String),
}

#[derive(Clone, Debug)]
pub struct Field {
    pub name: String,
    pub ty: TypeName,
    pub arity: Arity,
    pub attributes: Vec<Attribute>,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub struct EnumValue {
    pub name: String,
    pub attributes: Vec<Attribute>,
    pub span: Span,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockKind {
    Datasource,
    Generator,
    Model,
    View,
    Type,
    Enum,
}

impl BlockKind {
    pub fn keyword(self) -> &'static str {
        match self {
            Self::Datasource => "datasource",
            Self::Generator => "generator",
            Self::Model => "model",
            Self::View => "view",
            Self::Type => "type",
            Self::Enum => "enum",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Block {
    pub kind: BlockKind,
    pub name: String,
    pub span: Span,
    /// Fields of a model, view or composite type.
    pub fields: Vec<Field>,
    /// Values of an enum.
    pub values: Vec<EnumValue>,
    /// `@@` attributes of a model, view, composite type or enum.
    pub attributes: Vec<Attribute>,
    /// `key = value` properties of a datasource or generator.
    pub properties: Vec<(String, Expr, Span)>,
}
