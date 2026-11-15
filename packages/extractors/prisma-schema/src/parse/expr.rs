//! Parsing of attributes, argument lists and value expressions.

use super::ast::{Arg, Attribute, Expr, Span};
use super::lex::Token;
use super::parser::Parser;
use anyhow::Result;

impl Parser<'_> {
    pub(super) fn field_attributes(&mut self) -> Result<Vec<Attribute>> {
        let mut attributes = Vec::new();
        while self.peek() == &Token::Punct('@') {
            let span = self.span();
            self.advance();
            attributes.push(self.attribute(span)?);
        }
        Ok(attributes)
    }

    pub(super) fn attribute(&mut self, span: Span) -> Result<Attribute> {
        let mut name = self.identifier("an attribute name")?;
        while self.eat('.') {
            name.push('.');
            name.push_str(&self.identifier("an attribute name")?);
        }
        let args = if self.peek() == &Token::Punct('(') {
            self.arguments()?
        } else {
            vec![]
        };
        Ok(Attribute { name, args, span })
    }

    fn arguments(&mut self) -> Result<Vec<Arg>> {
        self.expect('(')?;
        let mut args = Vec::new();
        while !self.eat(')') {
            let name = match (self.peek().clone(), self.peek_at(1)) {
                (Token::Ident(name), Token::Punct(':')) => {
                    self.advance();
                    self.advance();
                    Some(name)
                }
                _ => None,
            };
            let value = self.expression()?;
            args.push(Arg { name, value });
            if !self.eat(',') {
                self.expect(')')?;
                break;
            }
        }
        Ok(args)
    }

    pub(super) fn expression(&mut self) -> Result<Expr> {
        match self.peek().clone() {
            Token::String(value) => {
                self.advance();
                Ok(Expr::String(value))
            }
            Token::Number(value) => {
                self.advance();
                Ok(Expr::Number(value))
            }
            Token::Punct('[') => {
                self.advance();
                let mut items = Vec::new();
                while !self.eat(']') {
                    items.push(self.expression()?);
                    if !self.eat(',') {
                        self.expect(']')?;
                        break;
                    }
                }
                Ok(Expr::Array(items))
            }
            Token::Ident(mut name) => {
                self.advance();
                while self.peek() == &Token::Punct('.') && matches!(self.peek_at(1), Token::Ident(_)) {
                    self.advance();
                    name.push('.');
                    name.push_str(&self.identifier("an identifier")?);
                }
                if self.peek() == &Token::Punct('(') {
                    Ok(Expr::Call(name, self.arguments()?))
                } else {
                    Ok(Expr::Ident(name))
                }
            }
            _ => self.unexpected("a value"),
        }
    }
}
