//! Argument lists, array elements and hash pairs.

use super::Parser;
use crate::ast::{Arg, Expr, Kind};
use crate::lex::Token;
use anyhow::Result;

impl Parser<'_> {
    /// One argument: `key: value`, `key => value`, a splat or a value.
    fn argument(&mut self) -> Result<Arg> {
        let (start, line) = (self.start(), self.line());
        match self.token().clone() {
            Token::Label(name) => {
                self.advance();
                let key = self.expr(Kind::Symbol(name), start, line);
                self.skip_newlines();
                // Ruby 3.1's shorthand `key:` passes the local of the same name.
                if matches!(self.token(), Token::Op("," | ")" | "}" | "]") | Token::Newline) {
                    let value = Expr {
                        kind: Kind::Other,
                        line,
                        text: key.text.trim_end_matches(':').to_owned(),
                    };
                    return Ok(Arg::Pair(key, value));
                }
                Ok(Arg::Pair(key, self.expression()?))
            }
            Token::Op("*" | "**" | "&") => {
                self.advance();
                if matches!(self.token(), Token::Op("," | ")")) {
                    return Ok(Arg::Splat(self.expr(Kind::Other, start, line)));
                }
                self.expression()?;
                Ok(Arg::Splat(self.expr(Kind::Other, start, line)))
            }
            _ => {
                let value = self.expression()?;
                if self.is_op("=>") {
                    self.advance();
                    self.skip_newlines();
                    return Ok(Arg::Pair(value, self.expression()?));
                }
                Ok(Arg::Positional(value))
            }
        }
    }

    /// Arguments up to `close` (`)` or `]`), or, when `close` is empty, a
    /// command call's arguments to the end of its line.
    pub(super) fn arguments(&mut self, close: &str) -> Result<Vec<Arg>> {
        let mut args = Vec::new();
        loop {
            if !close.is_empty() {
                self.skip_newlines();
                if self.is_op(close) {
                    return Ok(args);
                }
            }
            args.push(self.argument()?);
            if !self.is_op(",") {
                if !close.is_empty() {
                    self.skip_newlines();
                }
                return Ok(args);
            }
            self.advance();
            self.skip_newlines();
        }
    }

    /// Array elements up to `close`; trailing pairs form one hash element.
    pub(super) fn list(&mut self, close: &str) -> Result<Vec<Expr>> {
        let mut items = Vec::new();
        let mut pairs = Vec::new();
        for arg in self.arguments(close)? {
            match arg {
                Arg::Positional(expr) => items.push(expr),
                Arg::Pair(key, value) => pairs.push((key, value)),
                Arg::Splat(expr) => items.push(expr),
            }
        }
        if let Some((first, _)) = pairs.first() {
            let line = first.line;
            items.push(Expr {
                text: String::new(),
                kind: Kind::Hash(pairs),
                line,
            });
        }
        Ok(items)
    }

    /// A hash literal's pairs, up to `}`; `None` when it has a double splat.
    pub(super) fn hash_pairs(&mut self) -> Result<Option<Vec<(Expr, Expr)>>> {
        let mut pairs = Vec::new();
        let mut complete = true;
        for arg in self.arguments("}")? {
            match arg {
                Arg::Pair(key, value) => pairs.push((key, value)),
                Arg::Splat(_) => complete = false,
                Arg::Positional(_) => return self.error("expected a hash key"),
            }
        }
        Ok(complete.then_some(pairs))
    }
}
