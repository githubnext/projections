//! Recursive-descent parsing of blocks and their members from tokens.

use super::ast::*;
use super::lex::{Lexed, Token, describe};
use anyhow::{Result, bail};

pub(super) struct Parser<'a> {
    pub(super) tokens: Vec<Lexed>,
    pub(super) position: usize,
    pub(super) file: usize,
    pub(super) path: &'a str,
}

impl Parser<'_> {
    pub(super) fn peek(&self) -> &Token {
        &self.tokens[self.position].token
    }
    pub(super) fn peek_at(&self, offset: usize) -> &Token {
        let index = (self.position + offset).min(self.tokens.len() - 1);
        &self.tokens[index].token
    }
    fn line(&self) -> usize {
        self.tokens[self.position].line
    }
    pub(super) fn span(&self) -> Span {
        Span {
            file: self.file,
            line: self.line(),
        }
    }
    pub(super) fn advance(&mut self) -> Token {
        let token = self.tokens[self.position].token.clone();
        if self.position + 1 < self.tokens.len() {
            self.position += 1;
        }
        token
    }
    pub(super) fn fail<T>(&self, message: impl std::fmt::Display) -> Result<T> {
        bail!("Invalid Prisma schema at {}:{}: {message}", self.path, self.line())
    }
    pub(super) fn unexpected<T>(&self, expected: &str) -> Result<T> {
        self.fail(format!("expected {expected}, found {}", describe(self.peek())))
    }
    pub(super) fn eat(&mut self, punct: char) -> bool {
        if self.peek() == &Token::Punct(punct) {
            self.advance();
            true
        } else {
            false
        }
    }
    pub(super) fn expect(&mut self, punct: char) -> Result<()> {
        if self.eat(punct) {
            Ok(())
        } else {
            self.unexpected(&format!("`{punct}`"))
        }
    }
    pub(super) fn identifier(&mut self, expected: &str) -> Result<String> {
        match self.peek().clone() {
            Token::Ident(name) => {
                self.advance();
                Ok(name)
            }
            _ => self.unexpected(expected),
        }
    }
    fn skip_newlines(&mut self) {
        while self.peek() == &Token::Newline {
            self.advance();
        }
    }
    /// Block members, like Prisma's grammar, each end with a newline.
    fn end_of_line(&mut self) -> Result<()> {
        match self.peek() {
            Token::Newline => {
                self.advance();
                Ok(())
            }
            _ => self.unexpected("end of line"),
        }
    }

    pub(super) fn schema(&mut self) -> Result<Vec<Block>> {
        let mut blocks = Vec::new();
        loop {
            self.skip_newlines();
            if self.peek() == &Token::End {
                return Ok(blocks);
            }
            blocks.push(self.block()?);
        }
    }

    fn block(&mut self) -> Result<Block> {
        let span = self.span();
        let keyword = self.identifier("a datasource, generator, model, view, type or enum block")?;
        let kind = match keyword.as_str() {
            "datasource" => BlockKind::Datasource,
            "generator" => BlockKind::Generator,
            "model" => BlockKind::Model,
            "view" => BlockKind::View,
            "type" => BlockKind::Type,
            "enum" => BlockKind::Enum,
            other => {
                return self.fail(format!(
                    "unknown block `{other}`; expected datasource, generator, model, view, type or enum"
                ));
            }
        };
        let name = self.identifier(&format!("a {keyword} name"))?;
        self.expect('{')?;
        let mut block = Block {
            kind,
            name,
            span,
            fields: vec![],
            values: vec![],
            attributes: vec![],
            properties: vec![],
        };
        if self.eat('}') {
            return Ok(block);
        }
        self.end_of_line()?;
        loop {
            self.skip_newlines();
            match self.peek() {
                Token::Punct('}') => {
                    self.advance();
                    return Ok(block);
                }
                Token::End => return self.fail(format!("unclosed {keyword} {}", block.name)),
                _ => self.member(&mut block)?,
            }
            self.end_of_line()?;
        }
    }

    /// One line of a block: an `@@` attribute, a property, an enum value or a field.
    fn member(&mut self, block: &mut Block) -> Result<()> {
        let kind = block.kind;
        if self.peek() == &Token::BlockAt {
            if matches!(kind, BlockKind::Datasource | BlockKind::Generator) {
                return self.fail(format!("a {} block cannot have attributes", kind.keyword()));
            }
            let attribute_span = self.span();
            self.advance();
            let attribute = self.attribute(attribute_span)?;
            block.attributes.push(attribute);
            return Ok(());
        }
        match kind {
            BlockKind::Datasource | BlockKind::Generator => {
                let span = self.span();
                let key = self.identifier("a property name")?;
                self.expect('=')?;
                let value = self.expression()?;
                block.properties.push((key, value, span));
            }
            BlockKind::Enum => {
                let span = self.span();
                let name = self.identifier("an enum value")?;
                let attributes = self.field_attributes()?;
                block.values.push(EnumValue { name, attributes, span });
            }
            _ => {
                let field = self.field()?;
                block.fields.push(field);
            }
        }
        Ok(())
    }

    fn field(&mut self) -> Result<Field> {
        let span = self.span();
        let name = self.identifier("a field name")?;
        let type_name = self.identifier(&format!("a type for field {name}"))?;
        let ty = if type_name == "Unsupported" {
            self.expect('(')?;
            let Token::String(native) = self.advance() else {
                return self.fail("Unsupported(...) requires a string");
            };
            self.expect(')')?;
            TypeName::Unsupported(native)
        } else {
            TypeName::Named(type_name)
        };
        let arity = if self.eat('?') {
            Arity::Optional
        } else if self.eat('[') {
            self.expect(']')?;
            if self.peek() == &Token::Punct('?') {
                return self.fail(format!("field {name}: optional lists are not supported"));
            }
            Arity::List
        } else {
            Arity::Required
        };
        let attributes = self.field_attributes()?;
        Ok(Field {
            name,
            ty,
            arity,
            attributes,
            span,
        })
    }
}
