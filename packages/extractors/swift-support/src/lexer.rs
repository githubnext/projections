//! Swift source as tokens: identifiers, literals, operators and punctuation,
//! with comments dropped and compiler directives (`#if`) kept as tokens. It
//! reads enough of the language to find declarations and literal expressions;
//! it never type-checks or expands macros.

mod strings;

use anyhow::{Result, bail};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kind {
    /// An identifier or keyword; a backticked one without its backticks.
    Ident,
    /// A string literal's value. `interpolated` when it has `\(...)` segments,
    /// whose value is only known when the program runs.
    Str {
        interpolated: bool,
    },
    Number,
    /// An operator (`..<`, `+=`, `->`) or punctuation (`(`, `,`, `.`).
    Punct,
    /// `#` and a name: `#if`, `#elseif`, `#else`, `#endif`, `#available`, …
    Directive,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Token {
    pub kind: Kind,
    pub text: String,
    /// The 1-based line the token starts on.
    pub line: usize,
}

impl Token {
    pub fn is(&self, kind: &Kind, text: &str) -> bool {
        &self.kind == kind && self.text == text
    }

    pub fn punct(&self, text: &str) -> bool {
        self.is(&Kind::Punct, text)
    }

    pub fn ident(&self, text: &str) -> bool {
        self.is(&Kind::Ident, text)
    }
}

const OPERATOR: &str = "/=-+!*%<>&|^~?";
const SINGLE: &str = "()[]{},:;@$\\";

/// The tokens of Swift `source`.
pub fn tokens(source: &str) -> Result<Vec<Token>> {
    let chars: Vec<char> = source.chars().collect();
    let mut lexer = Lexer {
        chars: &chars,
        at: 0,
        line: 1,
        tokens: Vec::new(),
    };
    while lexer.at < chars.len() {
        lexer.next()?;
    }
    Ok(lexer.tokens)
}

struct Lexer<'a> {
    chars: &'a [char],
    at: usize,
    line: usize,
    tokens: Vec<Token>,
}

impl Lexer<'_> {
    fn peek(&self, offset: usize) -> Option<char> {
        self.chars.get(self.at + offset).copied()
    }

    fn push(&mut self, kind: Kind, text: String, line: usize) {
        self.tokens.push(Token { kind, text, line });
    }

    /// Advances past `count` characters, counting lines.
    fn skip(&mut self, count: usize) {
        for _ in 0..count {
            if self.peek(0) == Some('\n') {
                self.line += 1;
            }
            self.at += 1;
        }
    }

    fn next(&mut self) -> Result<()> {
        let c = self.peek(0).unwrap_or_default();
        let line = self.line;
        match c {
            _ if c.is_whitespace() => self.skip(1),
            '/' if self.peek(1) == Some('/') => self.line_comment(),
            '/' if self.peek(1) == Some('*') => self.block_comment()?,
            '"' => self.string(0)?,
            '#' if matches!(self.peek(1), Some('"' | '#')) => self.raw_string()?,
            '#' => {
                self.skip(1);
                let name = self.word();
                self.push(Kind::Directive, format!("#{name}"), line);
            }
            '`' => {
                self.skip(1);
                let name = self.word();
                if self.peek(0) != Some('`') {
                    bail!("Unterminated backticked identifier on line {line}");
                }
                self.skip(1);
                self.push(Kind::Ident, name, line);
            }
            _ if c.is_ascii_digit() => {
                let number = self.number();
                self.push(Kind::Number, number, line);
            }
            _ if c == '_' || c.is_alphabetic() => {
                let word = self.word();
                self.push(Kind::Ident, word, line);
            }
            '.' => self.dots(),
            _ if OPERATOR.contains(c) => self.operator(),
            _ if SINGLE.contains(c) => {
                self.skip(1);
                self.push(Kind::Punct, c.to_string(), line);
            }
            _ => bail!("Unexpected character {c:?} on line {line}"),
        }
        Ok(())
    }

    fn word(&mut self) -> String {
        let start = self.at;
        while self.peek(0).is_some_and(|c| c == '_' || c == '$' || c.is_alphanumeric()) {
            self.at += 1;
        }
        self.chars[start..self.at].iter().collect()
    }

    fn number(&mut self) -> String {
        let start = self.at;
        loop {
            match self.peek(0) {
                Some(c) if c.is_ascii_alphanumeric() || c == '_' => self.at += 1,
                Some('.') if self.peek(1).is_some_and(|c| c.is_ascii_digit()) => self.at += 1,
                _ => break,
            }
        }
        self.chars[start..self.at].iter().collect()
    }

    /// `.`, or a dot operator such as `...` and `..<`.
    fn dots(&mut self) {
        let (start, line) = (self.at, self.line);
        self.at += 1;
        if self.peek(0) == Some('.') {
            while self.peek(0).is_some_and(|c| c == '.' || OPERATOR.contains(c)) {
                self.at += 1;
            }
        }
        let text = self.chars[start..self.at].iter().collect();
        self.push(Kind::Punct, text, line);
    }

    fn operator(&mut self) {
        let (start, line) = (self.at, self.line);
        while self.peek(0).is_some_and(|c| OPERATOR.contains(c)) {
            // A comment ends an operator: `a+/* x */b`.
            if self.peek(0) == Some('/') && matches!(self.peek(1), Some('/' | '*')) && self.at > start {
                break;
            }
            self.at += 1;
        }
        let text = self.chars[start..self.at].iter().collect();
        self.push(Kind::Punct, text, line);
    }

    fn line_comment(&mut self) {
        while self.peek(0).is_some_and(|c| c != '\n') {
            self.at += 1;
        }
    }

    /// A block comment, which Swift lets nest.
    fn block_comment(&mut self) -> Result<()> {
        let line = self.line;
        let mut depth = 0;
        loop {
            match (self.peek(0), self.peek(1)) {
                (Some('/'), Some('*')) => {
                    depth += 1;
                    self.skip(2);
                }
                (Some('*'), Some('/')) => {
                    depth -= 1;
                    self.skip(2);
                    if depth == 0 {
                        return Ok(());
                    }
                }
                (Some(_), _) => self.skip(1),
                (None, _) => bail!("Unterminated comment starting on line {line}"),
            }
        }
    }
}

#[cfg(test)]
mod tests;
