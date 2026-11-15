//! A parser for the Prisma Schema Language (PSL).
//!
//! It produces a syntax tree of top-level blocks. It accepts the grammar Prisma's
//! own parser accepts for `datasource`, `generator`, `model`, `view`, `type` and
//! `enum` blocks, and rejects anything else with a file and line, never skipping
//! input it doesn't understand.

mod ast;
mod expr;
mod lex;
mod parser;

pub use ast::*;

use anyhow::Result;
use parser::Parser;

/// Parses one schema file. `file` indexes the file in the multi-file schema.
pub fn parse(source: &str, path: &str, file: usize) -> Result<Vec<Block>> {
    let tokens = lex::lex(source, path)?;
    Parser {
        tokens,
        position: 0,
        file,
        path,
    }
    .schema()
}

#[cfg(test)]
mod tests;
