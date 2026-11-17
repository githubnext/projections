//! Expressions: literals, constants, calls with their arguments and blocks,
//! lambdas and method chains. Operators make an expression [`Kind::Other`].

use super::Parser;
use crate::ast::{Expr, Kind};
use crate::lex::Token;
use anyhow::Result;

const BINARY: [&str; 34] = [
    "||", "&&", "==", "!=", "===", "=~", "!~", "<", ">", "<=", ">=", "<=>", "+", "-", "*", "/", "%", "**", "<<", ">>", "|", "&", "^", "..",
    "...", "=", "+=", "-=", "*=", "/=", "||=", "&&=", "**=", "?",
];

impl Parser<'_> {
    /// An expression, including operators and a ternary.
    pub(super) fn expression(&mut self) -> Result<Expr> {
        let (start, line) = (self.start(), self.line());
        let lhs = self.unary()?;
        let binary = match self.token() {
            Token::Op(op) => BINARY.contains(op),
            Token::Ident(name) => name == "and" || name == "or",
            _ => false,
        };
        if !binary {
            return Ok(lhs);
        }
        let ternary = self.is_op("?");
        self.advance();
        self.skip_newlines();
        self.expression()?;
        if ternary {
            self.expect_op(":")?;
            self.skip_newlines();
            self.expression()?;
        }
        Ok(self.expr(Kind::Other, start, line))
    }

    fn unary(&mut self) -> Result<Expr> {
        let (start, line) = (self.start(), self.line());
        match self.token() {
            Token::Op("-") if matches!(self.ahead(1), Token::Number(_)) && !self.tokens[self.pos + 1].space_before => {
                self.advance();
                let Token::Number(number) = self.advance() else { unreachable!() };
                Ok(self.expr(Kind::Number(format!("-{number}")), start, line))
            }
            Token::Op("!" | "-" | "~") => {
                self.advance();
                self.unary()?;
                Ok(self.expr(Kind::Other, start, line))
            }
            Token::Ident(name) if name == "not" || name == "defined?" => {
                self.advance();
                self.expression()?;
                Ok(self.expr(Kind::Other, start, line))
            }
            _ => {
                let primary = self.primary()?;
                self.postfix(primary, start)
            }
        }
    }

    fn primary(&mut self) -> Result<Expr> {
        let (start, line) = (self.start(), self.line());
        let kind = match self.token().clone() {
            Token::Str { value, interpolated } => {
                self.advance();
                Kind::Str { value, interpolated }
            }
            Token::Symbol(name) => {
                self.advance();
                Kind::Symbol(name)
            }
            Token::Number(number) => {
                self.advance();
                Kind::Number(number)
            }
            Token::Regex(source) => {
                self.advance();
                Kind::Regex(source)
            }
            Token::Words { items, symbols } => {
                self.advance();
                let items = items
                    .into_iter()
                    .map(|item| Expr {
                        text: item.clone(),
                        kind: if symbols {
                            Kind::Symbol(item)
                        } else {
                            Kind::Str {
                                value: item,
                                interpolated: false,
                            }
                        },
                        line,
                    })
                    .collect();
                Kind::Array(items)
            }
            Token::Op("(") => {
                self.advance();
                let inner = self.nested(|parser| {
                    parser.skip_newlines();
                    let inner = parser.expression()?;
                    parser.skip_newlines();
                    Ok(inner)
                })?;
                self.expect_op(")")?;
                return Ok(Expr {
                    text: self.text(start),
                    ..inner
                });
            }
            Token::Op("[") => {
                self.advance();
                let items = self.nested(|parser| parser.list("]"))?;
                self.expect_op("]")?;
                Kind::Array(items)
            }
            Token::Op("{") => {
                self.advance();
                let pairs = self.nested(|parser| parser.hash_pairs())?;
                self.expect_op("}")?;
                pairs.map_or(Kind::Other, Kind::Hash)
            }
            Token::Op("->") => {
                self.advance();
                if self.is_op("(") {
                    self.skip_one()?;
                } else {
                    while matches!(self.token(), Token::Ident(name) if name != "do") || self.is_op(",") {
                        self.advance();
                    }
                }
                let Some(block) = self.block()? else {
                    return self.error("expected a lambda body");
                };
                Kind::Lambda(block)
            }
            Token::Op("::") => {
                self.advance();
                return self.primary();
            }
            Token::Const(name) => {
                self.advance();
                if self.is_op("(") && !self.current().space_before {
                    return self.call_rest(None, name, start, line);
                }
                Kind::Const(name)
            }
            Token::Ident(name) => {
                self.advance();
                match name.as_str() {
                    "nil" => Kind::Nil,
                    "true" => Kind::Bool(true),
                    "false" => Kind::Bool(false),
                    "lambda" | "proc" if self.is_op("{") || self.is_ident("do") => match self.block()? {
                        Some(block) => Kind::Lambda(block),
                        None => unreachable!(),
                    },
                    _ if super::TERMINATORS.contains(&name.as_str()) || super::OPENERS.contains(&name.as_str()) => {
                        return self.error(&format!("unexpected `{name}`"));
                    }
                    _ => return self.call_rest(None, name, start, line),
                }
            }
            _ => return self.error(&format!("unexpected {}", self.describe())),
        };
        Ok(self.expr(kind, start, line))
    }

    /// Runs `parse` inside brackets, where newlines are insignificant and `do` binds inside.
    pub(super) fn nested<T>(&mut self, parse: impl FnOnce(&mut Self) -> Result<T>) -> Result<T> {
        let outer = std::mem::replace(&mut self.command_args, false);
        let result = parse(self);
        self.command_args = outer;
        result
    }

    /// Method calls, constant paths and indexing after `expr`.
    fn postfix(&mut self, mut expr: Expr, start: usize) -> Result<Expr> {
        loop {
            let line = expr.line;
            // A chain may continue on the next line with a leading `.`.
            if self.token() == &Token::Newline && matches!(self.ahead(1), Token::Op("." | "&.")) {
                self.advance();
            }
            match self.token() {
                Token::Op("." | "&.") => {
                    self.advance();
                    self.skip_newlines();
                    let name = match self.advance() {
                        Token::Ident(name) | Token::Const(name) => name,
                        Token::Label(name) => return self.error(&format!("unexpected `{name}:`")),
                        Token::Op("(") => {
                            self.pos -= 1;
                            "call".to_owned()
                        }
                        _ => return self.error("expected a method name"),
                    };
                    expr = self.call_rest(Some(expr), name, start, line)?;
                }
                Token::Op("::") => {
                    self.advance();
                    match (self.advance(), &expr.kind) {
                        (Token::Const(name), Kind::Const(path)) if !self.is_op("(") => {
                            let path = format!("{path}::{name}");
                            expr = self.expr(Kind::Const(path), start, line);
                        }
                        (Token::Const(name) | Token::Ident(name), _) => expr = self.call_rest(Some(expr), name, start, line)?,
                        _ => return self.error("expected a name after `::`"),
                    }
                }
                Token::Op("[") if !self.current().space_before => {
                    self.advance();
                    self.nested(|parser| parser.list("]"))?;
                    self.expect_op("]")?;
                    expr = self.expr(Kind::Other, start, line);
                }
                _ => return Ok(expr),
            }
        }
    }
}
