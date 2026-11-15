//! Where each character of a scalar's value is written in the file. The YAML
//! reader keeps each scalar's first position; this walks the source from
//! there, decoding quotes, escapes, block indentation and line folding, and
//! maps a character only where the source says exactly that character, so an
//! editor never marks the wrong text.

use projections_comparator_rules::yaml::{Position, Style};

/// Where one character of a value is written: a 1-based line and column (in
/// characters), and how many source characters spell it (2 for `''` or `\n`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Place {
    pub line: usize,
    pub column: usize,
    pub width: usize,
}

/// The source's lines, as characters, without line terminators.
pub fn lines(source: &str) -> Vec<Vec<char>> {
    source
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line).chars().collect())
        .collect()
}

enum At {
    Char(char),
    End,
    Eof,
}

struct Cursor<'a> {
    lines: &'a [Vec<char>],
    line: usize,
    column: usize,
    /// A block scalar's indentation, skipped at the start of each line.
    indent: Option<usize>,
}

impl Cursor<'_> {
    fn at(&self) -> At {
        match self.lines.get(self.line) {
            None => At::Eof,
            Some(text) => match text.get(self.column) {
                Some(c) => At::Char(*c),
                None => At::End,
            },
        }
    }

    fn ahead(&self, offset: usize) -> Option<char> {
        self.lines.get(self.line)?.get(self.column + offset).copied()
    }

    /// Moves to the next line, past its indentation: a flow scalar's leading
    /// whitespace, or a block's indentation.
    fn next_line(&mut self) {
        self.line += 1;
        let text = self.lines.get(self.line).map_or(&[][..], Vec::as_slice);
        let flow = self.indent.is_none();
        let leading = text.iter().take_while(|c| **c == ' ' || (flow && **c == '\t')).count();
        self.column = match self.indent {
            Some(indent) => leading.min(indent),
            None => leading,
        };
    }

    /// Whether only whitespace is left on this line (trimmed before a fold).
    fn trailing_space(&self) -> bool {
        self.lines
            .get(self.line)
            .is_some_and(|text| text[self.column.min(text.len())..].iter().all(|c| *c == ' ' || *c == '\t'))
    }

    fn place(&self, width: usize) -> Place {
        Place {
            line: self.line + 1,
            column: self.column + 1,
            width,
        }
    }
}

/// A double-quoted scalar's escape at the cursor: the character it stands
/// for (`None` for an escaped line break, which stands for nothing) and its
/// width on the line.
fn escape(cursor: &Cursor) -> Option<(Option<char>, usize)> {
    let code = |length: usize| -> Option<(Option<char>, usize)> {
        let digits: String = (0..length).map(|offset| cursor.ahead(2 + offset)).collect::<Option<String>>()?;
        let value = u32::from_str_radix(&digits, 16).ok()?;
        Some((Some(char::from_u32(value)?), 2 + length))
    };
    let simple = |c: char| Some((Some(c), 2));
    match cursor.ahead(1) {
        None => Some((None, 1)),
        Some('0') => simple('\0'),
        Some('a') => simple('\u{7}'),
        Some('b') => simple('\u{8}'),
        Some('t' | '\t') => simple('\t'),
        Some('n') => simple('\n'),
        Some('v') => simple('\u{b}'),
        Some('f') => simple('\u{c}'),
        Some('r') => simple('\r'),
        Some('e') => simple('\u{1b}'),
        Some(' ') => simple(' '),
        Some('"') => simple('"'),
        Some('/') => simple('/'),
        Some('\\') => simple('\\'),
        Some('N') => simple('\u{85}'),
        Some('_') => simple('\u{a0}'),
        Some('L') => simple('\u{2028}'),
        Some('P') => simple('\u{2029}'),
        Some('x') => code(2),
        Some('u') => code(4),
        Some('U') => code(8),
        Some(_) => None,
    }
}

/// Where each character of `value` is written, given the scalar's position:
/// `None` for characters the source doesn't spell one for one (a folded line
/// break), and for every character once the source stops matching.
pub fn locate(lines: &[Vec<char>], position: &Position, value: &str) -> Vec<Option<Place>> {
    let chars: Vec<char> = value.chars().collect();
    let mut places = vec![None; chars.len()];
    if position.line == 0 || position.column == 0 {
        return places;
    }
    let first = lines.get(position.line - 1).map_or(&[][..], Vec::as_slice);
    let (quote, block) = match position.style {
        Style::Inline { quoted } => (
            first
                .get(position.column - 1)
                .copied()
                .filter(|c| quoted && (*c == '\'' || *c == '"')),
            None,
        ),
        Style::Block { folded, indent } => (None, Some((folded, indent))),
    };
    let mut cursor = Cursor {
        lines,
        line: position.line - 1,
        column: position.column - 1 + usize::from(quote.is_some()),
        indent: block.map(|(_, indent)| indent),
    };
    if block.is_some() {
        let leading = first.iter().take_while(|c| **c == ' ').count();
        cursor.column = cursor.column.min(leading);
    }
    let literal = matches!(block, Some((false, _)));
    let mut index = 0;
    // Each step maps a character or moves the cursor forward, so the walk
    // ends; the bound is a backstop.
    let limit = 4 * (chars.len() + lines.len()) + 16;
    for _ in 0..limit {
        let Some(&c) = chars.get(index) else {
            break;
        };
        match cursor.at() {
            At::Eof => break,
            At::End => {
                if c == '\n' || c == ' ' {
                    // A line break, or a fold: no source character spells it.
                    cursor.next_line();
                    index += 1;
                } else if literal {
                    break;
                } else {
                    // A fold before blank lines is dropped.
                    cursor.next_line();
                }
            }
            At::Char(s) => {
                if quote == Some('"') && s == '\\' {
                    match escape(&cursor) {
                        Some((None, _)) => cursor.next_line(),
                        Some((Some(decoded), width)) if decoded == c => {
                            places[index] = Some(cursor.place(width));
                            cursor.column += width;
                            index += 1;
                        }
                        _ => break,
                    }
                } else if quote == Some('\'') && s == '\'' && c == '\'' && cursor.ahead(1) == Some('\'') {
                    places[index] = Some(cursor.place(2));
                    cursor.column += 2;
                    index += 1;
                } else if s == c && quote != Some(s) {
                    places[index] = Some(cursor.place(1));
                    cursor.column += 1;
                    index += 1;
                } else if (s == ' ' || s == '\t') && block.is_none() && cursor.trailing_space() {
                    cursor.column = cursor.lines[cursor.line].len();
                } else {
                    break;
                }
            }
        }
    }
    places
}
