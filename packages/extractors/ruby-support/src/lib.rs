//! Reads the declarative Ruby that Rails and other Ruby tools keep their
//! configuration in (`db/schema.rb`, `config/routes.rb`) without running Ruby.
//!
//! [`parse`] turns source into statements: calls with their arguments and
//! blocks, literals, constants, lambdas and conditionals. What it doesn't
//! model, it keeps as text ([`Kind::Other`], [`Stmt::Other`]), so a reader
//! can report what it didn't evaluate instead of guessing.

mod ast;
pub mod inflect;
mod lex;
mod parse;

pub use ast::{Arg, Block, Call, Expr, Kind, Stmt};
pub use parse::parse;
