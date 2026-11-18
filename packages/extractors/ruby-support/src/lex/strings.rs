//! String literals: quoted strings with their escapes, and heredocs, whose
//! bodies follow the line that opens them.

use super::{Lexer, Token, ident_byte};
use anyhow::Result;

pub(crate) struct Pending {
    pub(crate) token: usize,
    pub(crate) terminator: String,
    /// `<<~`: the body's common indentation is removed.
    squiggly: bool,
    /// `<<-` or `<<~`: the terminator may be indented.
    indented: bool,
    raw: bool,
}

fn escape(b: u8) -> Option<char> {
    Some(match b {
        b'n' => '\n',
        b't' => '\t',
        b's' => ' ',
        b'r' => '\r',
        b'0' => '\0',
        b'e' => '\u{1b}',
        _ => return None,
    })
}

impl Lexer<'_> {
    /// Skips an interpolation `#{...}` starting at `#`, including nested braces and strings.
    pub(crate) fn interpolation(&mut self) -> Result<()> {
        self.pos += 2;
        let mut depth = 1;
        while depth > 0 {
            match self.peek(0) {
                0 if self.pos >= self.src.len() => return self.error("unterminated interpolation"),
                b'{' => depth += 1,
                b'}' => depth -= 1,
                b'\n' => self.line += 1,
                b'"' | b'\'' => {
                    self.quoted()?;
                    continue;
                }
                _ => {}
            }
            self.pos += 1;
        }
        Ok(())
    }

    /// A string delimited by `close`, starting after its opening delimiter.
    /// Single-quoted (`raw`) strings only unescape the delimiter and `\\`.
    pub(crate) fn delimited(&mut self, open: u8, close: u8, raw: bool) -> Result<Token> {
        let mut bytes = Vec::new();
        let mut interpolated = false;
        let mut depth = 0;
        loop {
            let b = self.peek(0);
            match b {
                0 if self.pos >= self.src.len() => return self.error("unterminated string"),
                b'\\' => {
                    let next = self.peek(1);
                    self.pos += 2;
                    match escape(next).filter(|_| !raw) {
                        Some(c) => bytes.extend(c.to_string().bytes()),
                        None if raw && next != close && next != b'\\' => bytes.extend([b'\\', next]),
                        None => bytes.push(next),
                    }
                    continue;
                }
                b'#' if !raw && self.peek(1) == b'{' => {
                    interpolated = true;
                    let start = self.pos;
                    self.interpolation()?;
                    bytes.extend_from_slice(&self.src[start..self.pos]);
                    continue;
                }
                _ if b == close && depth == 0 => {
                    self.pos += 1;
                    break;
                }
                _ if b == close => depth -= 1,
                _ if b == open && open != close => depth += 1,
                b'\n' => self.line += 1,
                _ => {}
            }
            bytes.push(b);
            self.pos += 1;
        }
        Ok(Token::Str {
            value: String::from_utf8_lossy(&bytes).into_owned(),
            interpolated,
        })
    }

    /// A `"`, `'` or `` ` `` string at the current position.
    pub(crate) fn quoted(&mut self) -> Result<Token> {
        let quote = self.peek(0);
        self.pos += 1;
        self.delimited(quote, quote, quote == b'\'')
    }

    /// `<<~ID`, `<<-ID`, `<<ID` or a quoted ID at the current position; its body
    /// is read at the end of the line.
    pub(crate) fn heredoc(&mut self) -> Result<Option<Token>> {
        let mut at = self.pos + 2;
        let mode = self.src.get(at).copied().unwrap_or(0);
        let (squiggly, indented) = (mode == b'~', mode == b'~' || mode == b'-');
        if indented {
            at += 1;
        }
        let quote = self.src.get(at).copied().unwrap_or(0);
        let raw = quote == b'\'';
        let quoted = matches!(quote, b'\'' | b'"');
        if quoted {
            at += 1;
        }
        let start = at;
        while self.src.get(at).is_some_and(|b| ident_byte(*b)) {
            at += 1;
        }
        let name = &self.src[start..at];
        if name.is_empty() || (!quoted && !indented && !name[0].is_ascii_uppercase()) {
            return Ok(None);
        }
        let terminator = String::from_utf8_lossy(name).into_owned();
        if quoted {
            at += 1;
        }
        self.pos = at;
        self.heredocs.push(Pending {
            token: self.tokens.len(),
            terminator,
            squiggly,
            indented,
            raw,
        });
        Ok(Some(Token::Str {
            value: String::new(),
            interpolated: false,
        }))
    }

    /// Reads the bodies of the heredocs opened on the line just ended.
    pub(crate) fn heredoc_bodies(&mut self) -> Result<()> {
        for pending in std::mem::take(&mut self.heredocs) {
            let mut lines = Vec::new();
            loop {
                if self.pos >= self.src.len() {
                    return self.error(&format!("heredoc {} is not terminated", pending.terminator));
                }
                let end = self.src[self.pos..]
                    .iter()
                    .position(|b| *b == b'\n')
                    .map_or(self.src.len(), |i| self.pos + i);
                let line = String::from_utf8_lossy(&self.src[self.pos..end]).into_owned();
                self.pos = (end + 1).min(self.src.len());
                self.line += 1;
                let candidate = if pending.indented {
                    line.trim()
                } else {
                    line.trim_end_matches('\r')
                };
                if candidate == pending.terminator {
                    break;
                }
                lines.push(line);
            }
            if pending.squiggly {
                let indent = lines
                    .iter()
                    .filter(|l| !l.trim().is_empty())
                    .map(|l| l.len() - l.trim_start().len())
                    .min()
                    .unwrap_or(0);
                for line in &mut lines {
                    *line = line.get(indent..).unwrap_or("").to_owned();
                }
            }
            let mut value = lines.join("\n");
            if !lines.is_empty() {
                value.push('\n');
            }
            let interpolated = !pending.raw && value.contains("#{");
            self.tokens[pending.token].token = Token::Str { value, interpolated };
        }
        Ok(())
    }
}
