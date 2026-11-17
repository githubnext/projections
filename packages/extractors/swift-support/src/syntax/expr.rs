//! The expression parser.

use super::{Arg, Expr};
use crate::lexer::{Kind, Token};
use anyhow::{Result, bail};

pub(super) struct Parser<'a> {
    pub tokens: &'a [Token],
    pub at: usize,
}

/// Tokens that end an expression inside brackets or an argument list.
const DELIMITERS: [&str; 5] = [",", ")", "]", "}", ";"];

impl Parser<'_> {
    pub fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.at)
    }

    fn peek_punct(&self, text: &str) -> bool {
        self.peek().is_some_and(|token| token.punct(text))
    }

    /// The current token's line, or the last one's at the end.
    pub fn line(&self) -> usize {
        self.peek().or(self.tokens.last()).map_or(0, |token| token.line)
    }

    /// Whether the current token continues the previous one's line.
    fn same_line(&self) -> bool {
        self.at > 0 && self.peek().is_some_and(|token| token.line == self.tokens[self.at - 1].line)
    }

    pub fn expression(&mut self) -> Result<Expr> {
        let mut parts = vec![self.postfix()?];
        while let Some(token) = self.peek().filter(|token| token.kind == Kind::Punct) {
            match token.text.as_str() {
                "+" => {
                    self.at += 1;
                    parts.push(self.postfix()?);
                }
                range @ ("..<" | "...") if parts.len() == 1 => {
                    let closed = range == "...";
                    self.at += 1;
                    let upper = self.postfix()?;
                    let lower = parts.pop().unwrap();
                    return Ok(Expr::Range {
                        lower: Box::new(lower),
                        upper: Box::new(upper),
                        closed,
                    });
                }
                text if is_operator(text) => {
                    let line = token.line;
                    let what = format!("the `{text}` operator");
                    self.skip_expression();
                    return Ok(Expr::Opaque { line, what });
                }
                _ => break,
            }
        }
        Ok(if parts.len() == 1 {
            parts.pop().unwrap()
        } else {
            Expr::Concat(parts)
        })
    }

    fn postfix(&mut self) -> Result<Expr> {
        let mut expr = self.primary()?;
        loop {
            let line = self.line();
            if self.peek_punct(".") {
                self.at += 1;
                let Some(name) = self.peek().filter(|token| matches!(token.kind, Kind::Ident | Kind::Number)) else {
                    bail!("Expected a member name on line {line}");
                };
                let name = name.text.clone();
                self.at += 1;
                expr = match expr {
                    Expr::Path { implicit, mut names, line } => {
                        names.push(name);
                        Expr::Path { implicit, names, line }
                    }
                    _ => Expr::Opaque {
                        line,
                        what: format!("a member (`.{name}`) of a computed value"),
                    },
                };
            } else if self.peek_punct("(") && self.same_line() {
                let args = self.arguments()?;
                expr = Expr::Call {
                    callee: Box::new(expr),
                    args,
                    line,
                };
            } else if self.peek_punct("{") && self.same_line() {
                self.skip_balanced();
                expr = Expr::Opaque {
                    line,
                    what: "a trailing closure".into(),
                };
            } else {
                return Ok(expr);
            }
        }
    }

    fn primary(&mut self) -> Result<Expr> {
        let Some(token) = self.peek().cloned() else {
            bail!("Expected an expression at the end of the file");
        };
        let line = token.line;
        let opaque = |what: &str| Expr::Opaque { line, what: what.into() };
        let expr = match (&token.kind, token.text.as_str()) {
            (Kind::Punct, ".") => {
                self.at += 1;
                let Some(name) = self.peek().filter(|token| token.kind == Kind::Ident) else {
                    bail!("Expected a member name on line {line}");
                };
                Expr::Path {
                    implicit: true,
                    names: vec![name.text.clone()],
                    line,
                }
            }
            (Kind::Ident, name) => Expr::Path {
                implicit: false,
                names: vec![name.into()],
                line,
            },
            (Kind::Str { interpolated: false }, value) => Expr::Str(value.into()),
            (Kind::Str { interpolated: true }, _) => opaque("string interpolation"),
            (Kind::Number, value) => Expr::Number(value.into()),
            (Kind::Punct, "[") => return self.array(),
            (Kind::Punct, "(") => return self.parenthesized(),
            (Kind::Punct, "{") => {
                self.skip_balanced();
                return Ok(opaque("a closure"));
            }
            (Kind::Directive, "#if") => {
                self.skip_conditional();
                return Ok(opaque("`#if`"));
            }
            (Kind::Directive, name) => opaque(&format!("`{name}`")),
            (Kind::Punct, text) if is_operator(text) => {
                self.skip_expression();
                return Ok(opaque(&format!("the `{text}` operator")));
            }
            (_, text) => bail!("Unexpected `{text}` on line {line}"),
        };
        self.at += 1;
        Ok(expr)
    }

    fn parenthesized(&mut self) -> Result<Expr> {
        let (start, line) = (self.at, self.line());
        self.at += 1;
        let inner = self.expression()?;
        if self.peek_punct(")") {
            self.at += 1;
            return Ok(inner);
        }
        self.at = start;
        self.skip_balanced();
        Ok(Expr::Opaque {
            line,
            what: "a tuple".into(),
        })
    }

    fn array(&mut self) -> Result<Expr> {
        let (start, line) = (self.at, self.line());
        self.at += 1;
        let mut items = Vec::new();
        loop {
            match self.peek() {
                None => bail!("Unterminated array starting on line {line}"),
                Some(token) if token.punct("]") => break,
                Some(token) if token.is(&Kind::Directive, "#if") => {
                    let line = token.line;
                    self.skip_conditional();
                    items.push(Expr::Opaque {
                        line,
                        what: "`#if`".into(),
                    });
                }
                Some(_) => items.push(self.expression()?),
            }
            if self.peek_punct(":") {
                self.at = start;
                self.skip_balanced();
                return Ok(Expr::Opaque {
                    line,
                    what: "a dictionary".into(),
                });
            }
            if self.peek_punct(",") {
                self.at += 1;
            } else if !self.peek_punct("]") && !self.peek().is_some_and(|token| token.is(&Kind::Directive, "#if")) {
                bail!("Expected `,` or `]` on line {}", self.line());
            }
        }
        self.at += 1;
        Ok(Expr::Array(items))
    }

    pub(super) fn arguments(&mut self) -> Result<Vec<Arg>> {
        let line = self.line();
        self.at += 1;
        let mut args = Vec::new();
        while !self.peek_punct(")") {
            if self.peek().is_none() {
                bail!("Unterminated argument list starting on line {line}");
            }
            let labeled = self.tokens.get(self.at + 1).is_some_and(|token| token.punct(":"))
                && self.peek().is_some_and(|token| token.kind == Kind::Ident);
            let label = labeled.then(|| self.tokens[self.at].text.clone());
            if labeled {
                self.at += 2;
            }
            args.push(Arg {
                label,
                value: self.expression()?,
            });
            if self.peek_punct(",") {
                self.at += 1;
            } else if !self.peek_punct(")") {
                bail!("Expected `,` or `)` on line {}", self.line());
            }
        }
        self.at += 1;
        Ok(args)
    }
}

/// An operator other than the ones literal expressions use.
fn is_operator(text: &str) -> bool {
    !DELIMITERS.contains(&text) && !matches!(text, "(" | "[" | "{" | "." | ":" | "@" | "$" | "\\" | "#")
}

pub(super) mod skip;
