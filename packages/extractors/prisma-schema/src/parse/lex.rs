//! Splits schema source into tokens with their lines, decoding string literals
//! and their escape sequences.

use anyhow::Result;

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Token {
    Ident(String),
    String(String),
    Number(String),
    Punct(char),
    /// `@@`
    BlockAt,
    Newline,
    End,
}

pub(super) struct Lexed {
    pub(super) token: Token,
    pub(super) line: usize,
}

pub(super) fn describe(token: &Token) -> String {
    match token {
        Token::Ident(s) => format!("`{s}`"),
        Token::String(s) => format!("string {s:?}"),
        Token::Number(s) => format!("number {s}"),
        Token::Punct(c) => format!("`{c}`"),
        Token::BlockAt => "`@@`".into(),
        Token::Newline => "end of line".into(),
        Token::End => "end of file".into(),
    }
}

fn identifier_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

/// The position just past a run of ASCII digits starting at `i`.
fn skip_digits(chars: &[char], mut i: usize) -> usize {
    while chars.get(i).is_some_and(|d| d.is_ascii_digit()) {
        i += 1;
    }
    i
}

/// Lexer state: the source characters, the position and line, and the tokens so far.
struct Lexer<'a> {
    chars: Vec<char>,
    i: usize,
    line: usize,
    path: &'a str,
    tokens: Vec<Lexed>,
}

impl Lexer<'_> {
    fn error(&self, line: usize, message: impl std::fmt::Display) -> anyhow::Error {
        anyhow::anyhow!("Invalid Prisma schema at {}:{line}: {message}", self.path)
    }

    fn push(&mut self, token: Token, width: usize) {
        self.tokens.push(Lexed { token, line: self.line });
        self.i += width;
    }

    fn number(&mut self) -> Result<()> {
        let start = self.i;
        let mut i = skip_digits(&self.chars, start + 1);
        if self.chars.get(i) == Some(&'.') && self.chars.get(i + 1).is_some_and(|d| d.is_ascii_digit()) {
            i = skip_digits(&self.chars, i + 1);
        }
        if self.chars.get(i).is_some_and(|&d| identifier_char(d)) {
            return Err(self.error(self.line, "invalid number literal"));
        }
        let literal = self.chars[start..i].iter().collect();
        self.push(Token::Number(literal), i - start);
        Ok(())
    }

    fn identifier(&mut self) {
        let start = self.i;
        let mut i = start;
        while self.chars.get(i).is_some_and(|&d| identifier_char(d)) {
            i += 1;
        }
        let name = self.chars[start..i].iter().collect();
        self.push(Token::Ident(name), i - start);
    }

    fn starts_number(&self, c: char) -> bool {
        c.is_ascii_digit() || (c == '-' && self.chars.get(self.i + 1).is_some_and(|d| d.is_ascii_digit()))
    }

    fn token(&mut self, c: char, nesting: &mut usize) -> Result<()> {
        match c {
            '\n' => {
                if *nesting == 0 {
                    self.push(Token::Newline, 0);
                }
                self.line += 1;
                self.i += 1;
            }
            ' ' | '\t' | '\r' | '\u{feff}' => self.i += 1,
            '/' if self.chars.get(self.i + 1) == Some(&'/') => {
                while self.i < self.chars.len() && self.chars[self.i] != '\n' {
                    self.i += 1;
                }
            }
            '"' => {
                let start = self.line;
                let value = string_literal(self)?;
                self.tokens.push(Lexed {
                    token: Token::String(value),
                    line: start,
                });
            }
            '@' if self.chars.get(self.i + 1) == Some(&'@') => self.push(Token::BlockAt, 2),
            '(' | '[' => {
                *nesting += 1;
                self.push(Token::Punct(c), 1);
            }
            ')' | ']' => {
                *nesting = nesting.saturating_sub(1);
                self.push(Token::Punct(c), 1);
            }
            '@' | '{' | '}' | '=' | ':' | ',' | '?' | '.' => self.push(Token::Punct(c), 1),
            c if self.starts_number(c) => self.number()?,
            c if c.is_ascii_alphabetic() || c == '_' => self.identifier(),
            other => return Err(self.error(self.line, format!("unexpected character {other:?}"))),
        }
        Ok(())
    }
}

pub(super) fn lex(source: &str, path: &str) -> Result<Vec<Lexed>> {
    let mut lexer = Lexer {
        chars: source.chars().collect(),
        i: 0,
        line: 1,
        path,
        tokens: Vec::new(),
    };
    // Newlines are insignificant inside argument lists and arrays.
    let mut nesting = 0usize;
    while let Some(&c) = lexer.chars.get(lexer.i) {
        lexer.token(c, &mut nesting)?;
    }
    lexer.push(Token::End, 0);
    Ok(lexer.tokens)
}

fn hex(chars: &[char], at: usize) -> Option<u32> {
    let digits: String = chars.get(at..at + 4)?.iter().collect();
    u32::from_str_radix(&digits, 16).ok()
}

/// Decodes a `\uXXXX` escape whose digits start at the lexer position,
/// combining a UTF-16 surrogate pair written as two escapes.
fn unicode_escape(lexer: &mut Lexer) -> Result<char> {
    let (chars, line) = (&lexer.chars, lexer.line);
    let Some(high) = hex(chars, lexer.i) else {
        return Err(lexer.error(line, "invalid unicode escape"));
    };
    lexer.i += 4;
    let code = if (0xD800..0xDC00).contains(&high) {
        let i = lexer.i;
        let low = (chars.get(i) == Some(&'\\') && chars.get(i + 1) == Some(&'u'))
            .then(|| hex(chars, i + 2))
            .flatten()
            .filter(|low| (0xDC00..0xE000).contains(low));
        let Some(low) = low else {
            return Err(lexer.error(line, "unpaired surrogate in unicode escape"));
        };
        lexer.i += 6;
        0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00)
    } else {
        high
    };
    char::from_u32(code).ok_or_else(|| lexer.error(line, "invalid unicode escape"))
}

/// Decodes the escape sequence after a backslash at the lexer position.
fn escape(lexer: &mut Lexer, start: usize) -> Result<char> {
    let Some(&escaped) = lexer.chars.get(lexer.i) else {
        return Err(lexer.error(start, "unterminated string literal"));
    };
    lexer.i += 1;
    Ok(match escaped {
        '"' => '"',
        '\\' => '\\',
        '/' => '/',
        'b' => '\u{8}',
        'f' => '\u{c}',
        'n' => '\n',
        'r' => '\r',
        't' => '\t',
        'u' => unicode_escape(lexer)?,
        other => return Err(lexer.error(lexer.line, format!("unknown escape sequence \\{other}"))),
    })
}

/// Reads a string literal starting at the opening quote at the lexer position.
fn string_literal(lexer: &mut Lexer) -> Result<String> {
    let start = lexer.line;
    let mut value = String::new();
    lexer.i += 1;
    loop {
        let Some(&c) = lexer.chars.get(lexer.i) else {
            return Err(lexer.error(start, "unterminated string literal"));
        };
        lexer.i += 1;
        match c {
            '"' => return Ok(value),
            '\n' => return Err(lexer.error(start, "unterminated string literal")),
            '\\' => value.push(escape(lexer, start)?),
            c => value.push(c),
        }
    }
}
