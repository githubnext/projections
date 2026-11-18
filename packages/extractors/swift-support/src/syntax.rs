//! Literal Swift expressions as a manifest writes them: calls with labeled
//! arguments, member paths, arrays, strings, numbers, ranges and array
//! concatenation. Anything else (closures, dictionaries, other operators,
//! `#if` inside an array) is [`Expr::Opaque`], kept with its line so a reader
//! that needs its value can say what it couldn't follow.

mod expr;
mod statements;

pub use statements::{Binding, Mutation, Program, program};

/// A parsed expression.
#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    Str(String),
    Number(String),
    /// A member path: `.v13` (implicit, no base), `Version.init`, `deps`.
    /// `at` is the index of its first token in the file, which orders it
    /// against the statements that change the values it names.
    Path {
        implicit: bool,
        names: Vec<String>,
        line: usize,
        at: usize,
    },
    Call {
        callee: Box<Expr>,
        args: Vec<Arg>,
        line: usize,
    },
    Array(Vec<Expr>),
    /// `lower..<upper`, or `lower...upper` when `closed`.
    Range {
        lower: Box<Expr>,
        upper: Box<Expr>,
        closed: bool,
    },
    /// `a + b + …`, as arrays are concatenated.
    Concat(Vec<Expr>),
    /// What a literal reading can't evaluate, and why.
    Opaque {
        line: usize,
        what: String,
    },
}

/// A call argument, with its label when it has one.
#[derive(Clone, Debug, PartialEq)]
pub struct Arg {
    pub label: Option<String>,
    pub value: Expr,
}

impl Expr {
    /// The line an expression starts on, when it records one.
    pub fn line(&self) -> Option<usize> {
        match self {
            Self::Path { line, .. } | Self::Call { line, .. } | Self::Opaque { line, .. } => Some(*line),
            Self::Range { lower, .. } => lower.line(),
            Self::Array(items) | Self::Concat(items) => items.iter().find_map(Self::line),
            Self::Str(_) | Self::Number(_) => None,
        }
    }

    /// An implicit member call's name and arguments: `.target(name: …)`.
    pub fn member_call(&self) -> Option<(&str, &[Arg])> {
        match self {
            Self::Call { callee, args, .. } => match callee.as_ref() {
                Self::Path { implicit: true, names, .. } if names.len() == 1 => Some((names[0].as_str(), args)),
                _ => None,
            },
            _ => None,
        }
    }

    /// Where a path starts in the file's tokens.
    pub fn position(&self) -> Option<usize> {
        match self {
            Self::Path { at, .. } => Some(*at),
            _ => None,
        }
    }

    /// A plain identifier: a reference to a binding.
    pub fn identifier(&self) -> Option<&str> {
        match self {
            Self::Path {
                implicit: false, names, ..
            } if names.len() == 1 => Some(&names[0]),
            _ => None,
        }
    }
}

/// The argument labeled `label`.
pub fn argument<'a>(args: &'a [Arg], label: &str) -> Option<&'a Expr> {
    args.iter().find(|arg| arg.label.as_deref() == Some(label)).map(|arg| &arg.value)
}

#[cfg(test)]
mod tests;
