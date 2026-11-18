//! String literals: single-line, multiline (`"""`) and raw (`#"…"#`).

use super::{Kind, Lexer};
use anyhow::{Result, bail};

impl Lexer<'_> {
    /// `#…#"…"#…#`: a string whose escapes need as many `#` as surround it.
    pub(super) fn raw_string(&mut self) -> Result<()> {
        let mut hashes = 0;
        while self.peek(hashes) == Some('#') {
            hashes += 1;
        }
        if self.peek(hashes) != Some('"') {
            let line = self.line;
            self.skip(1);
            self.push(Kind::Punct, "#".into(), line);
            return Ok(());
        }
        self.skip(hashes);
        self.string(hashes)
    }

    /// The literal starting at the current `"`, closed by `"` and `hashes` `#`.
    pub(super) fn string(&mut self, hashes: usize) -> Result<()> {
        let line = self.line;
        let multiline = self.peek(1) == Some('"') && self.peek(2) == Some('"');
        let quotes = if multiline { 3 } else { 1 };
        self.skip(quotes);
        let mut value = String::new();
        let mut interpolated = false;
        loop {
            let Some(c) = self.peek(0) else {
                bail!("Unterminated string literal starting on line {line}");
            };
            if c == '"' && self.closes(quotes, hashes) {
                self.skip(quotes + hashes);
                break;
            }
            if c == '\n' && !multiline {
                bail!("Unterminated string literal on line {line}");
            }
            if c == '\\' && (1..=hashes).all(|offset| self.peek(offset) == Some('#')) {
                self.skip(1 + hashes);
                interpolated |= self.escape(&mut value)?;
                continue;
            }
            value.push(c);
            self.skip(1);
        }
        let value = if multiline { indented(&value) } else { value };
        self.push(Kind::Str { interpolated }, value, line);
        Ok(())
    }

    fn closes(&self, quotes: usize, hashes: usize) -> bool {
        (0..quotes).all(|offset| self.peek(offset) == Some('"')) && (0..hashes).all(|offset| self.peek(quotes + offset) == Some('#'))
    }

    /// One escape after its `\`; whether it was an interpolation.
    fn escape(&mut self, value: &mut String) -> Result<bool> {
        let line = self.line;
        let Some(c) = self.peek(0) else {
            bail!("Unterminated escape on line {line}");
        };
        self.skip(1);
        let escaped = match c {
            'n' => '\n',
            't' => '\t',
            'r' => '\r',
            '0' => '\0',
            '\n' => return Ok(false),
            'u' => self.unicode()?,
            '(' => {
                self.interpolation()?;
                return Ok(true);
            }
            other => other,
        };
        value.push(escaped);
        Ok(false)
    }

    fn unicode(&mut self) -> Result<char> {
        let line = self.line;
        if self.peek(0) != Some('{') {
            bail!("Malformed unicode escape on line {line}");
        }
        self.skip(1);
        let mut digits = String::new();
        while let Some(c) = self.peek(0).filter(|c| *c != '}') {
            digits.push(c);
            self.skip(1);
        }
        self.skip(1);
        u32::from_str_radix(&digits, 16)
            .ok()
            .and_then(char::from_u32)
            .ok_or_else(|| anyhow::anyhow!("Malformed unicode escape on line {line}"))
    }

    /// Skips an interpolation's expression, through its closing parenthesis.
    fn interpolation(&mut self) -> Result<()> {
        let line = self.line;
        let mut depth = 1;
        while depth > 0 {
            match self.peek(0) {
                None => bail!("Unterminated interpolation on line {line}"),
                Some('(') => depth += 1,
                Some(')') => depth -= 1,
                Some('"') => {
                    self.skip(1);
                    while self.peek(0).is_some_and(|c| c != '"') {
                        self.skip(if self.peek(0) == Some('\\') { 2 } else { 1 });
                    }
                }
                _ => {}
            }
            self.skip(1);
        }
        Ok(())
    }
}

/// A multiline literal's value: its lines without the closing delimiter's
/// indentation, and without the line breaks after `"""` and before the closing one.
fn indented(raw: &str) -> String {
    let body = raw.strip_prefix('\n').unwrap_or(raw);
    let (body, indentation) = match body.rfind('\n') {
        Some(last) if body[last + 1..].chars().all(char::is_whitespace) => (&body[..last], &body[last + 1..]),
        _ => (body, ""),
    };
    body.split('\n')
        .map(|line| line.strip_prefix(indentation).unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n")
}
