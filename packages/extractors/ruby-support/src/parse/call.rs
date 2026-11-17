//! Calls: command and parenthesized arguments, and the blocks they take.

use super::Parser;
use crate::ast::{Block, Call, Expr, Kind};
use crate::lex::Token;
use anyhow::Result;

impl Parser<'_> {
    /// Whether the current token begins a command call's first argument.
    fn command_argument(&self) -> bool {
        let lexed = self.current();
        if !lexed.space_before {
            return false;
        }
        match &lexed.token {
            Token::Str { .. }
            | Token::Symbol(_)
            | Token::Number(_)
            | Token::Regex(_)
            | Token::Words { .. }
            | Token::Const(_)
            | Token::Label(_) => true,
            Token::Ident(name) => !matches!(
                name.as_str(),
                "do" | "if" | "unless" | "while" | "until" | "and" | "or" | "then" | "end" | "rescue"
            ),
            Token::Op("[" | "->" | "::" | "!") => true,
            Token::Op("-" | "*" | "**" | "&" | ":") => !self.tokens[self.pos + 1].space_before,
            _ => false,
        }
    }

    /// The arguments and block of a call to `name` (on `receiver`), after its name.
    pub(super) fn call_rest(&mut self, receiver: Option<Expr>, name: String, start: usize, line: usize) -> Result<Expr> {
        let mut args = Vec::new();
        let mut command = false;
        if self.is_op("(") && !self.current().space_before {
            self.advance();
            args = self.nested(|parser| parser.arguments(")"))?;
            self.expect_op(")")?;
        } else if self.command_argument() {
            command = true;
            let outer = std::mem::replace(&mut self.command_args, true);
            let parsed = self.arguments("");
            self.command_args = outer;
            args = parsed?;
        }
        // `do` binds to the outermost command call; `{` to the nearest call without command arguments.
        let block = if self.is_ident("do") {
            if self.command_args { None } else { self.block()? }
        } else if !command && self.is_op("{") {
            self.block()?
        } else {
            None
        };
        let call = Call {
            receiver: receiver.map(Box::new),
            name,
            args,
            block,
        };
        Ok(self.expr(Kind::Call(call), start, line))
    }

    /// A `{ |params| ... }` or `do |params| ... end` block, if one starts here.
    pub(super) fn block(&mut self) -> Result<Option<Block>> {
        let braced = match self.token() {
            Token::Op("{") => true,
            Token::Ident(name) if name == "do" => false,
            _ => return Ok(None),
        };
        self.advance();
        let block = self.nested(|parser| {
            let mut params = Vec::new();
            if parser.is_op("|") {
                parser.advance();
                while !parser.is_op("|") {
                    match parser.advance() {
                        Token::Ident(name) => params.push(name),
                        Token::End | Token::Newline => return parser.error("unterminated block parameters"),
                        _ => {}
                    }
                }
                parser.advance();
            }
            let body = parser.statements(braced)?;
            Ok(Block { params, body })
        })?;
        if braced {
            self.expect_op("}")?
        } else {
            self.expect_ident("end")?
        }
        Ok(Some(block))
    }
}
