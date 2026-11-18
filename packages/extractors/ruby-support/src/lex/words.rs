//! Names, labels, constants, symbols and numbers.

use super::{Lexer, Token, ident_byte};
use anyhow::Result;

impl Lexer<'_> {
    pub(crate) fn word(&mut self) -> Token {
        let start = self.pos;
        while ident_byte(self.peek(0)) {
            self.pos += 1;
        }
        if matches!(self.peek(0), b'?' | b'!') && self.peek(1) != b'=' {
            self.pos += 1;
        }
        let name = String::from_utf8_lossy(&self.src[start..self.pos]).into_owned();
        if self.peek(0) == b':' && self.peek(1) != b':' && !matches!(self.tokens.last().map(|t| &t.token), Some(Token::Op("?"))) {
            self.pos += 1;
            return Token::Label(name);
        }
        if self.src[start].is_ascii_uppercase() {
            Token::Const(name)
        } else {
            Token::Ident(name)
        }
    }

    pub(crate) fn number(&mut self) -> Token {
        let start = self.pos;
        let digits = |lexer: &mut Self| {
            while lexer.peek(0).is_ascii_alphanumeric() || lexer.peek(0) == b'_' {
                lexer.pos += 1;
            }
        };
        digits(self);
        if self.peek(0) == b'.' && self.peek(1).is_ascii_digit() {
            self.pos += 1;
            digits(self);
            if matches!(self.peek(0), b'+' | b'-') && matches!(self.src[self.pos - 1], b'e' | b'E') {
                self.pos += 1;
                digits(self);
            }
        }
        Token::Number(String::from_utf8_lossy(&self.src[start..self.pos]).replace('_', ""))
    }

    pub(crate) fn symbol(&mut self) -> Result<Option<Token>> {
        match self.peek(1) {
            b'"' | b'\'' => {
                self.pos += 1;
                let Token::Str { value, .. } = self.quoted()? else { unreachable!() };
                Ok(Some(Token::Symbol(value)))
            }
            b if ident_byte(b) && !b.is_ascii_digit() => {
                self.pos += 1;
                let start = self.pos;
                while ident_byte(self.peek(0)) {
                    self.pos += 1;
                }
                if matches!(self.peek(0), b'?' | b'!' | b'=') && !matches!(self.peek(1), b'=' | b'>' | b'~') {
                    self.pos += 1;
                }
                Ok(Some(Token::Symbol(
                    String::from_utf8_lossy(&self.src[start..self.pos]).into_owned(),
                )))
            }
            _ => Ok(None),
        }
    }
}
