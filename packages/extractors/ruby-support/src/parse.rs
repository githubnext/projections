//! Parses tokens into statements. A statement the parser can't model (a
//! method definition, a `case`, an expression it doesn't recognize) is kept as
//! [`Stmt::Other`] with its text rather than failing, so a reader can say what
//! it didn't evaluate; only unbalanced source is an error.

mod args;
mod call;
mod expr;

use crate::ast::{Expr, Kind, Stmt};
use crate::lex::{Lexed, Token, lex};
use anyhow::{Result, bail};

/// Keywords that open a block closed by `end`, wherever they appear.
const OPENERS: [&str; 7] = ["do", "def", "class", "module", "begin", "case", "for"];
/// Keywords that open a block only at the start of an expression; elsewhere they are modifiers.
const CONDITIONALS: [&str; 4] = ["if", "unless", "while", "until"];
/// Keywords that end the statements of a block.
const TERMINATORS: [&str; 7] = ["end", "else", "elsif", "when", "in", "rescue", "ensure"];

pub(crate) struct Parser<'a> {
    tokens: Vec<Lexed>,
    pos: usize,
    source: &'a str,
    path: &'a str,
    /// Whether a `do` block binds to an enclosing command call, not the expression being parsed.
    command_args: bool,
}

/// The statements of `source`, read from the file `path` (for messages).
pub fn parse(source: &str, path: &str) -> Result<Vec<Stmt>> {
    let mut parser = Parser {
        tokens: lex(source, path)?,
        pos: 0,
        source,
        path,
        command_args: false,
    };
    let statements = parser.statements(false)?;
    if parser.token() != &Token::End {
        return parser.error(&format!("unexpected {}", parser.describe()));
    }
    Ok(statements)
}

impl Parser<'_> {
    fn current(&self) -> &Lexed {
        &self.tokens[self.pos.min(self.tokens.len() - 1)]
    }

    fn token(&self) -> &Token {
        &self.current().token
    }

    fn ahead(&self, offset: usize) -> &Token {
        &self.tokens[(self.pos + offset).min(self.tokens.len() - 1)].token
    }

    fn line(&self) -> usize {
        self.current().line
    }

    fn start(&self) -> usize {
        self.current().start
    }

    fn advance(&mut self) -> Token {
        let token = self.token().clone();
        if self.pos < self.tokens.len() - 1 {
            self.pos += 1;
        }
        token
    }

    /// The source from byte `start` to the end of the last token consumed.
    fn text(&self, start: usize) -> String {
        let end = self.tokens[..self.pos].last().map_or(start, |t| t.end).max(start);
        self.source[start..end].to_owned()
    }

    fn expr(&self, kind: Kind, start: usize, line: usize) -> Expr {
        Expr {
            kind,
            line,
            text: self.text(start),
        }
    }

    fn error<T>(&self, message: &str) -> Result<T> {
        bail!("{}:{}: {message}", self.path, self.line())
    }

    fn describe(&self) -> String {
        match self.token() {
            Token::Newline => "end of line".into(),
            Token::End => "end of file".into(),
            _ => format!("`{}`", &self.source[self.current().start..self.current().end]),
        }
    }

    fn is_ident(&self, name: &str) -> bool {
        matches!(self.token(), Token::Ident(n) if n == name)
    }

    fn is_op(&self, op: &str) -> bool {
        matches!(self.token(), Token::Op(o) if *o == op)
    }

    fn expect_op(&mut self, op: &str) -> Result<()> {
        if !self.is_op(op) {
            return self.error(&format!("expected `{op}`, found {}", self.describe()));
        }
        self.advance();
        Ok(())
    }

    fn expect_ident(&mut self, name: &str) -> Result<()> {
        if !self.is_ident(name) {
            return self.error(&format!("expected `{name}`, found {}", self.describe()));
        }
        self.advance();
        Ok(())
    }

    fn skip_newlines(&mut self) {
        while self.token() == &Token::Newline {
            self.advance();
        }
    }

    fn at_terminator(&self, braced: bool) -> bool {
        match self.token() {
            Token::End => true,
            Token::Ident(name) => TERMINATORS.contains(&name.as_str()),
            Token::Op("}") => braced,
            Token::Op(")") => true,
            _ => false,
        }
    }

    /// Statements up to a terminator (`end`, `else`, ... or, in a brace block, `}`).
    fn statements(&mut self, braced: bool) -> Result<Vec<Stmt>> {
        let mut statements = Vec::new();
        loop {
            self.skip_newlines();
            if self.at_terminator(braced) {
                return Ok(statements);
            }
            statements.push(self.statement(braced)?);
        }
    }

    fn statement(&mut self, braced: bool) -> Result<Stmt> {
        let (begin, start, line) = (self.pos, self.start(), self.line());
        if let Token::Ident(name) = self.token() {
            if name == "if" || name == "unless" {
                return self.conditional();
            }
            if OPENERS.contains(&name.as_str()) || CONDITIONALS.contains(&name.as_str()) {
                return self.other(start, line, braced);
            }
        }
        let parsed = self.expression().and_then(|expr| self.modifier(expr));
        match parsed {
            Ok(statement) if matches!(self.token(), Token::Newline) || self.at_terminator(braced) => Ok(statement),
            _ => {
                self.pos = begin;
                self.other(start, line, braced)
            }
        }
    }

    /// A modifier `if` or `unless` after `expr`, if one follows.
    fn modifier(&mut self, expr: Expr) -> Result<Stmt> {
        let negated = match self.token() {
            Token::Ident(name) if name == "if" => false,
            Token::Ident(name) if name == "unless" => true,
            _ => return Ok(Stmt::Expr(expr)),
        };
        let line = self.line();
        self.advance();
        let start = self.start();
        self.skip_to_line_end();
        Ok(Stmt::If {
            condition: self.text(start),
            negated,
            line,
            then: vec![Stmt::Expr(expr)],
            otherwise: vec![],
        })
    }

    /// `if`/`unless` (or, for `elsif`, the rest of the chain) through its `end`.
    fn conditional(&mut self) -> Result<Stmt> {
        let line = self.line();
        let negated = self.is_ident("unless");
        self.advance();
        let start = self.start();
        while !matches!(self.token(), Token::Newline | Token::End) && !self.is_ident("then") {
            self.skip_one()?;
        }
        let condition = self.text(start);
        if self.is_ident("then") {
            self.advance();
        }
        let then = self.statements(false)?;
        let otherwise = if self.is_ident("elsif") {
            return Ok(Stmt::If {
                condition,
                negated,
                line,
                then,
                otherwise: vec![self.conditional()?],
            });
        } else if self.is_ident("else") {
            self.advance();
            self.statements(false)?
        } else {
            vec![]
        };
        self.expect_ident("end")?;
        Ok(Stmt::If {
            condition,
            negated,
            line,
            then,
            otherwise,
        })
    }

    fn skip_to_line_end(&mut self) {
        while !matches!(self.token(), Token::Newline | Token::End) {
            if self.skip_one().is_err() {
                break;
            }
        }
    }

    /// Whether a conditional keyword here opens a block rather than modifying a statement.
    fn opens_conditional(&self) -> bool {
        let previous = self.pos.checked_sub(1).map(|i| &self.tokens[i].token);
        match previous {
            None | Some(Token::Newline | Token::Label(_)) => true,
            Some(Token::Op(op)) => !matches!(*op, ")" | "]" | "}"),
            Some(Token::Ident(name)) => matches!(name.as_str(), "then" | "do" | "else" | "begin" | "return"),
            _ => false,
        }
    }

    /// Skips one token, or a whole bracketed or `do`/`end` group.
    fn skip_one(&mut self) -> Result<()> {
        let line = self.line();
        let opens = match self.token() {
            Token::Op("(" | "[" | "{") => true,
            Token::Ident(name) if OPENERS.contains(&name.as_str()) => true,
            Token::Ident(name) if CONDITIONALS.contains(&name.as_str()) => self.opens_conditional(),
            _ => false,
        };
        let close = match self.advance() {
            Token::Op("(") => Some(")"),
            Token::Op("[") => Some("]"),
            Token::Op("{") => Some("}"),
            _ if opens => Some("end"),
            Token::End => bail!("{}:{line}: unexpected end of file", self.path),
            _ => None,
        };
        if let Some(close) = close {
            loop {
                match self.token() {
                    Token::End => bail!("{}:{line}: this block is never closed", self.path),
                    Token::Op(op) if *op == close => break,
                    Token::Ident(name) if name == close => break,
                    _ => self.skip_one()?,
                }
            }
            self.advance();
        }
        Ok(())
    }

    /// The statement at `start` as text, through the end of its line and any blocks it opens.
    fn other(&mut self, start: usize, line: usize, braced: bool) -> Result<Stmt> {
        while !matches!(self.token(), Token::Newline) && !self.at_terminator(braced) {
            self.skip_one()?;
        }
        if self.pos > 0 && self.tokens[self.pos - 1].end <= start {
            // Nothing consumed: a stray closing token.
            return self.error(&format!("unexpected {}", self.describe()));
        }
        Ok(Stmt::Other {
            line,
            text: self.text(start),
        })
    }
}

#[cfg(test)]
mod tests;
