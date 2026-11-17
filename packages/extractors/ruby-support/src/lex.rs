//! Splits Ruby source into tokens with their lines and byte ranges. It covers
//! the literal-heavy Ruby that configuration DSLs are written in: names,
//! constants, labels, symbols, strings (with interpolation kept as text),
//! heredocs, numbers, regular expressions, `%w`/`%i` word arrays and operators.
//! Comments, `=begin` blocks and everything after `__END__` are skipped.

mod percent;
mod strings;
mod words;

use anyhow::{Result, bail};

#[derive(Clone, Debug, PartialEq)]
pub enum Token {
    /// A local name, method name or keyword; may end in `?` or `!`.
    Ident(String),
    Const(String),
    /// `name:` or `"name":`, a hash key or keyword argument.
    Label(String),
    Symbol(String),
    /// A string; `interpolated` strings keep their `#{...}` text.
    Str {
        value: String,
        interpolated: bool,
    },
    Number(String),
    Regex(String),
    /// `%w[...]` (strings) or `%i[...]` (symbols).
    Words {
        items: Vec<String>,
        symbols: bool,
    },
    Op(&'static str),
    Newline,
    End,
}

#[derive(Clone, Debug)]
pub struct Lexed {
    pub token: Token,
    pub line: usize,
    pub start: usize,
    pub end: usize,
    /// Whether whitespace separates it from the token before it.
    pub space_before: bool,
}

/// Operators, longest first so that each matches whole.
const OPERATORS: [&str; 45] = [
    "**=", "||=", "&&=", "<=>", "===", "...", "::", "=>", "->", "==", "!=", "=~", "!~", "<=", ">=", "&&", "||", "<<", ">>", "**", "&.",
    "..", "+=", "-=", "*=", "/=", "|", "&", "(", ")", "[", "]", "{", "}", ",", ".", "=", "+", "-", "*", "/", "%", "!", "?", ":",
];
const SINGLE: [&str; 6] = ["<", ">", "^", "~", ";", "@"];

/// Keywords after which a value, not an operator, follows.
const VALUE_KEYWORDS: [&str; 10] = ["if", "unless", "when", "and", "or", "not", "return", "then", "elsif", "while"];

pub(crate) fn ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b >= 0x80
}

pub(crate) struct Lexer<'a> {
    pub(crate) src: &'a [u8],
    pub(crate) pos: usize,
    pub(crate) line: usize,
    pub(crate) tokens: Vec<Lexed>,
    /// Heredocs whose bodies start on the next line: token index, terminator, squiggly or dash, raw.
    pub(crate) heredocs: Vec<strings::Pending>,
    pub(crate) path: &'a str,
}

impl Lexer<'_> {
    pub(crate) fn peek(&self, offset: usize) -> u8 {
        self.src.get(self.pos + offset).copied().unwrap_or(0)
    }

    pub(crate) fn error<T>(&self, message: &str) -> Result<T> {
        bail!("{}:{}: {message}", self.path, self.line)
    }

    fn push(&mut self, token: Token, start: usize, line: usize, space_before: bool) {
        self.tokens.push(Lexed {
            token,
            line,
            start,
            end: self.pos,
            space_before,
        });
    }

    /// Whether a value, rather than an operator, may start here: after an
    /// operator, a keyword that takes a value, a line start, or a method name
    /// separated from it by a space (a command call's first argument).
    pub(crate) fn value_expected(&self, space_before: bool) -> bool {
        match self.tokens.last().map(|t| &t.token) {
            None | Some(Token::Newline | Token::Label(_)) => true,
            Some(Token::Op(op)) => !matches!(*op, ")" | "]" | "}"),
            Some(Token::Ident(name)) => VALUE_KEYWORDS.contains(&name.as_str()) || (space_before && !self.peek(1).is_ascii_whitespace()),
            _ => false,
        }
    }

    fn skip_space(&mut self) -> bool {
        let start = self.pos;
        loop {
            match self.peek(0) {
                b' ' | b'\t' | b'\r' => self.pos += 1,
                b'\\' if self.peek(1) == b'\n' => {
                    self.pos += 2;
                    self.line += 1;
                }
                b'#' => {
                    while !matches!(self.peek(0), b'\n' | 0) {
                        self.pos += 1;
                    }
                }
                _ => break,
            }
        }
        self.pos > start
    }

    /// At a line start: skips `=begin`/`=end` comments; `__END__` ends the source.
    fn line_start(&mut self) -> bool {
        let rest = &self.src[self.pos..];
        if rest.starts_with(b"__END__") && matches!(rest.get(7), None | Some(b'\n' | b'\r')) {
            self.pos = self.src.len();
            return true;
        }
        if rest.starts_with(b"=begin") {
            while self.pos < self.src.len() {
                let at_end = self.src[self.pos..].starts_with(b"=end");
                while !matches!(self.peek(0), b'\n' | 0) {
                    self.pos += 1;
                }
                if self.peek(0) == b'\n' {
                    self.pos += 1;
                    self.line += 1;
                }
                if at_end {
                    break;
                }
            }
            return true;
        }
        false
    }

    fn newline(&mut self) -> Result<()> {
        let start = self.pos;
        self.pos += 1;
        if !matches!(self.tokens.last().map(|t| &t.token), None | Some(Token::Newline)) {
            self.push(Token::Newline, start, self.line, false);
        }
        self.line += 1;
        if !self.heredocs.is_empty() {
            self.heredoc_bodies()?;
        }
        while self.line_start() {}
        Ok(())
    }

    fn operator(&mut self) -> Result<Token> {
        let rest = &self.src[self.pos..];
        for op in OPERATORS.iter().chain(&SINGLE) {
            if rest.starts_with(op.as_bytes()) {
                self.pos += op.len();
                return Ok(if *op == ";" { Token::Newline } else { Token::Op(op) });
            }
        }
        self.error(&format!("unexpected character {:?}", self.peek(0) as char))
    }

    fn token(&mut self, space_before: bool) -> Result<Token> {
        let b = self.peek(0);
        let value = self.value_expected(space_before);
        Ok(match b {
            b'"' | b'\'' | b'`' => {
                let token = self.quoted()?;
                match (token, self.peek(0), self.peek(1)) {
                    (
                        Token::Str {
                            value,
                            interpolated: false,
                        },
                        b':',
                        next,
                    ) if next != b':' => {
                        self.pos += 1;
                        Token::Label(value)
                    }
                    (token, ..) => token,
                }
            }
            b':' if self.peek(1) != b':' => match self.symbol()? {
                Some(token) => token,
                None => self.operator()?,
            },
            b'0'..=b'9' => self.number(),
            b if ident_byte(b) => self.word(),
            b'/' if value => self.regex(b'/', b'/')?,
            b'%' if value => match self.percent()? {
                Some(token) => token,
                None => self.operator()?,
            },
            b'<' if value && self.peek(1) == b'<' => match self.heredoc()? {
                Some(token) => token,
                None => self.operator()?,
            },
            b'@' | b'$' => {
                self.pos += 1;
                self.word()
            }
            _ => self.operator()?,
        })
    }
}

/// The tokens of `source`, ending in `Token::End`.
pub fn lex(source: &str, path: &str) -> Result<Vec<Lexed>> {
    let mut lexer = Lexer {
        src: source.as_bytes(),
        pos: 0,
        line: 1,
        tokens: Vec::new(),
        heredocs: Vec::new(),
        path,
    };
    while lexer.line_start() {}
    loop {
        let space_before = lexer.skip_space();
        let (start, line) = (lexer.pos, lexer.line);
        match lexer.peek(0) {
            0 if lexer.pos >= lexer.src.len() => break,
            b'\n' => lexer.newline()?,
            _ => {
                let token = lexer.token(space_before)?;
                lexer.push(token, start, line, space_before);
            }
        }
    }
    if let Some(pending) = lexer.heredocs.first() {
        return lexer.error(&format!("heredoc {} is not terminated", pending.terminator));
    }
    let (end, line) = (lexer.pos, lexer.line);
    lexer.push(Token::Newline, end, line, false);
    lexer.push(Token::End, end, line, false);
    Ok(lexer.tokens)
}

#[cfg(test)]
mod tests;
