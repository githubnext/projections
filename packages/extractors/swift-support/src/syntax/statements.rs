//! A manifest's top-level statements: its constant bindings (`let package =
//! Package(…)`, `let deps: [Target.Dependency] = […]`) and every place code
//! changes a value afterwards (`package.targets.append(…)`, `deps += […]`).

use super::Expr;
use super::expr::Parser;
use super::expr::skip::{closes, new_statement, opens};
use crate::lexer::{Kind, Token};
use std::collections::BTreeMap;

mod changes;
use changes::mutations;

/// A top-level `let` or `var` with a value.
#[derive(Clone, Debug, PartialEq)]
pub struct Binding {
    pub value: Expr,
    /// Declared inside a top-level `#if`, so whether it exists depends on the build.
    pub conditional: bool,
    pub line: usize,
}

/// A change to a value: `path` is what changes (`["package", "targets"]`,
/// `["deps"]`, `["target", "dependencies"]` in a loop).
#[derive(Clone, Debug, PartialEq)]
pub struct Mutation {
    pub path: Vec<String>,
    /// What an unconditional top-level `+=` or `append` adds; `None` for any
    /// other change, or one inside a condition, loop or function.
    pub appended: Option<Expr>,
    pub line: usize,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Program {
    pub bindings: BTreeMap<String, Binding>,
    pub mutations: Vec<Mutation>,
}

/// The program `tokens` hold.
pub fn program(tokens: &[Token]) -> Program {
    let mut parser = Parser { tokens, at: 0 };
    let mut program = Program::default();
    let mut conditional = 0usize;
    while let Some(token) = parser.peek().cloned() {
        match (&token.kind, token.text.as_str()) {
            (Kind::Directive, "#if") => {
                conditional += 1;
                skip_line(&mut parser);
            }
            (Kind::Directive, "#elseif" | "#else") => skip_line(&mut parser),
            (Kind::Directive, "#endif") => {
                conditional = conditional.saturating_sub(1);
                parser.at += 1;
            }
            (Kind::Ident, "let" | "var") if binding(&mut parser, &mut program, conditional > 0) => {}
            _ => {
                let start = parser.at;
                skip_statement(&mut parser);
                mutations(&tokens[start..parser.at], conditional > 0, &mut program.mutations);
            }
        }
    }
    program
}

/// Skips a directive and the condition on its line.
fn skip_line(parser: &mut Parser) {
    let line = parser.line();
    parser.at += 1;
    while parser.peek().is_some_and(|token| token.line == line) {
        parser.at += 1;
    }
}

/// `let name[: Type] = value`; false, without moving, when it isn't one.
fn binding(parser: &mut Parser, program: &mut Program, conditional: bool) -> bool {
    let start = parser.at;
    let line = parser.line();
    let Some(name) = parser.tokens.get(start + 1).filter(|token| token.kind == Kind::Ident) else {
        return false;
    };
    let name = name.text.clone();
    parser.at += 2;
    if parser.peek().is_some_and(|token| token.punct(":")) {
        while let Some(token) = parser.peek().filter(|token| !token.punct("=")) {
            if parser.at > start + 2 && new_statement(&parser.tokens[parser.at - 1], token) {
                break;
            }
            if opens(token) { parser.skip_balanced() } else { parser.at += 1 }
        }
    }
    if !parser.peek().is_some_and(|token| token.punct("=")) {
        parser.at = start;
        return false;
    }
    parser.at += 1;
    let value_start = parser.at;
    let value = match parser.expression() {
        Ok(value) => value,
        Err(error) => {
            parser.at = value_start;
            parser.skip_expression();
            Expr::Opaque {
                line,
                what: format!("an expression this reader can't parse ({error})"),
            }
        }
    };
    program.bindings.insert(name, Binding { value, conditional, line });
    true
}

/// To the end of a statement: a new line at the outermost level that doesn't
/// continue it, or a top-level directive.
fn skip_statement(parser: &mut Parser) {
    let start = parser.at;
    let mut depth = 0usize;
    while let Some(token) = parser.peek() {
        if parser.at > start && depth == 0 && (token.kind == Kind::Directive || new_statement(&parser.tokens[parser.at - 1], token)) {
            return;
        }
        if opens(token) {
            depth += 1;
        } else if closes(token) {
            depth = depth.saturating_sub(1);
        }
        parser.at += 1;
    }
}
