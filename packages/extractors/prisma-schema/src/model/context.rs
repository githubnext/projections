//! Resolution context: schema file paths for errors, and declared type names.

use crate::parse::Span;
use anyhow::{Result, bail};

pub(super) const SCALARS: [&str; 9] = [
    "String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime", "Json", "Bytes",
];

pub(super) struct Context<'a> {
    pub(super) paths: Vec<&'a str>,
}

impl Context<'_> {
    pub(super) fn fail<T>(&self, span: Span, message: impl std::fmt::Display) -> Result<T> {
        bail!("Invalid Prisma schema at {}:{}: {message}", self.paths[span.file], span.line)
    }
}

/// What a type name declared in the schema refers to.
pub(super) enum Declared {
    Model(usize),
    Enum(usize),
    Composite,
}
