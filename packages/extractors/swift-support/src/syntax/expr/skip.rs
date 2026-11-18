//! Skipping what the parser doesn't evaluate.

use super::{DELIMITERS, Parser, is_operator};
use crate::lexer::{Kind, Token};

pub(crate) fn opens(token: &Token) -> bool {
    token.kind == Kind::Punct && matches!(token.text.as_str(), "(" | "[" | "{")
}

pub(crate) fn closes(token: &Token) -> bool {
    token.kind == Kind::Punct && matches!(token.text.as_str(), ")" | "]" | "}")
}

/// Whether `next` starts a new statement after `previous` at the outermost
/// level: it's on a later line, and neither ends nor begins with an operator
/// or member access that would continue the expression.
pub(crate) fn new_statement(previous: &Token, next: &Token) -> bool {
    let continues = |token: &Token| token.kind == Kind::Punct && (token.text == "." || is_operator(&token.text));
    next.line > previous.line && !continues(previous) && !continues(next)
}

impl Parser<'_> {
    /// From an opening bracket to just past its matching closing one.
    pub fn skip_balanced(&mut self) {
        let mut depth = 0usize;
        while let Some(token) = self.peek() {
            if opens(token) {
                depth += 1;
            } else if closes(token) {
                depth = depth.saturating_sub(1);
            }
            self.at += 1;
            if depth == 0 {
                return;
            }
        }
    }

    /// From `#if` to just past its matching `#endif`.
    pub fn skip_conditional(&mut self) {
        let mut depth = 0usize;
        while let Some(token) = self.peek() {
            if token.is(&Kind::Directive, "#if") {
                depth += 1;
            } else if token.is(&Kind::Directive, "#endif") {
                depth = depth.saturating_sub(1);
            }
            self.at += 1;
            if depth == 0 {
                return;
            }
        }
    }

    /// To the end of the current expression: a delimiter at its own level, or
    /// the start of the next statement.
    pub fn skip_expression(&mut self) {
        while let Some(token) = self.peek() {
            if token.kind == Kind::Punct && DELIMITERS.contains(&token.text.as_str()) {
                return;
            }
            if self.at > 0 && new_statement(&self.tokens[self.at - 1], token) {
                return;
            }
            if opens(token) {
                self.skip_balanced();
            } else if token.is(&Kind::Directive, "#if") {
                self.skip_conditional();
            } else {
                self.at += 1;
            }
        }
    }
}
