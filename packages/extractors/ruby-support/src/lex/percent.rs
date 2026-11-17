//! `%` literals (`%w[]`, `%i[]`, `%q()`, `%Q()`, `%()`, `%r{}`) and `/regex/` literals.

use super::{Lexer, Token};
use anyhow::Result;

fn closing(open: u8) -> Option<u8> {
    Some(match open {
        b'(' => b')',
        b'[' => b']',
        b'{' => b'}',
        b'<' => b'>',
        b'|' | b'!' | b'/' | b'^' => open,
        _ => return None,
    })
}

impl Lexer<'_> {
    /// A regular expression whose source runs to `close`, followed by its flags.
    pub(crate) fn regex(&mut self, open: u8, close: u8) -> Result<Token> {
        self.pos += 1;
        let start = self.pos;
        let mut depth = 0;
        loop {
            match self.peek(0) {
                0 if self.pos >= self.src.len() => return self.error("unterminated regular expression"),
                b'\\' => self.pos += 1,
                b'\n' => self.line += 1,
                b if b == close && depth == 0 => break,
                b if b == close => depth -= 1,
                b if b == open && open != close => depth += 1,
                _ => {}
            }
            self.pos += 1;
        }
        let source = String::from_utf8_lossy(&self.src[start..self.pos]).into_owned();
        self.pos += 1;
        while self.peek(0).is_ascii_alphabetic() {
            self.pos += 1;
        }
        Ok(Token::Regex(source))
    }

    /// A `%` literal at the current position, if one starts here.
    pub(crate) fn percent(&mut self) -> Result<Option<Token>> {
        let (kind, open) = match self.peek(1) {
            k @ (b'w' | b'W' | b'i' | b'I' | b'q' | b'Q' | b'r') => (k, self.peek(2)),
            open => (b'Q', open),
        };
        let Some(close) = closing(open) else {
            return Ok(None);
        };
        self.pos += if open == self.peek(1) { 1 } else { 2 };
        if kind == b'r' {
            return self.regex(open, close).map(Some);
        }
        self.pos += 1;
        let raw = matches!(kind, b'q' | b'w' | b'i');
        let token = self.delimited(open, close, raw)?;
        let Token::Str { value, interpolated } = token else {
            unreachable!()
        };
        Ok(Some(match kind {
            b'w' | b'W' | b'i' | b'I' => Token::Words {
                items: value.split_whitespace().map(str::to_owned).collect(),
                symbols: matches!(kind, b'i' | b'I'),
            },
            _ => Token::Str { value, interpolated },
        }))
    }
}
