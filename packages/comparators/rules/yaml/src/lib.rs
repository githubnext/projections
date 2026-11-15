//! Comparator files are a restricted subset of YAML, read into JSON values; the
//! JSON Schema and the rules parser validate the result.
//!
//! The subset: one document of block or flow mappings, sequences and scalars,
//! at most [`MAX_BYTES`] long and [`MAX_DEPTH`] deep. Anchors, aliases, tags,
//! merge keys (`<<`) and duplicate keys are rejected, so a file means what it
//! shows and can't expand (no alias bombs). Plain scalars resolve by YAML
//! 1.2's core schema restricted to `null`/`~`/empty, `true`, `false`, decimal
//! integers and decimal floats; everything else, and every quoted or block
//! scalar, is a string.
//!
//! Every scalar's position is kept, by JSON pointer, so errors in an
//! expression can name the line and column where it is written.
//!
//! [`coverage`] merges and summarizes the rule coverage reports the
//! interpreter writes.
//!
//! [`suite`] reads comparator rules test files, which are written in the same
//! subset, and judges comparisons against them. This crate never evaluates
//! rules, so the CLI can read test files without depending on the rules
//! interpreter, which it runs only in the sandbox.

pub mod coverage;
// Hosts read test files natively; in WebAssembly only the editor's language
// service does (the `suite` feature), so `rules.wasm` doesn't carry it.
#[cfg(any(not(target_arch = "wasm32"), feature = "suite"))]
pub mod suite;

use projections_engine::{Failure, fail, pointer};
use serde_json::{Map, Number, Value};
use std::collections::HashMap;
use yaml_rust2::Event;
use yaml_rust2::parser::Parser;
use yaml_rust2::scanner::{Marker, TScalarStyle};

/// Largest rules file, in bytes.
pub const MAX_BYTES: usize = 1024 * 1024;
/// Deepest nesting of mappings and sequences.
pub const MAX_DEPTH: usize = 32;

/// How a scalar is written, which decides where its characters are.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Style {
    /// Plain or quoted, starting at a column of one line.
    Inline { quoted: bool },
    /// A literal (`|`) or folded (`>`) block: its content starts on `line`,
    /// indented by `indent` columns.
    Block { folded: bool, indent: usize },
}

/// Where a scalar is written: 1-based line and column of its first character.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Position {
    pub line: usize,
    pub column: usize,
    pub style: Style,
}

impl Position {
    /// The line and column of the character at `offset` (in characters)
    /// within the scalar's value.
    pub fn at(&self, value: &str, offset: usize, source: &str) -> (usize, usize) {
        let offset = offset.min(value.chars().count());
        match self.style {
            Style::Inline { quoted } => (self.line, self.column + usize::from(quoted) + offset),
            Style::Block { folded: false, indent } => {
                let before: String = value.chars().take(offset).collect();
                let line = before.matches('\n').count();
                let column = before.rsplit('\n').next().map_or(0, |last| last.chars().count());
                (self.line + line, indent + 1 + column)
            }
            Style::Block { folded: true, indent } => {
                // Each source line contributes its content and one folded space.
                let mut remaining = offset;
                for (index, text) in source.lines().skip(self.line - 1).enumerate() {
                    let content = text.chars().count().saturating_sub(indent);
                    if remaining <= content || text.trim().is_empty() && index > 0 {
                        return (self.line + index, indent + 1 + remaining.min(content));
                    }
                    remaining -= content + 1;
                }
                (self.line, indent + 1)
            }
        }
    }
}

/// A parsed rules file: its value and every scalar's position.
#[derive(Debug, Clone, Default)]
pub struct Document {
    pub value: Value,
    pub positions: HashMap<String, Position>,
    pub source: String,
}

fn invalid(marker: &Marker, message: &str) -> Failure {
    fail(
        "invalid-rules",
        "",
        &format!("Line {}, column {}: {message}", marker.line(), marker.col() + 1),
    )
}

pub fn parse(text: &str) -> Result<Document, Failure> {
    if text.len() > MAX_BYTES {
        return Err(fail("invalid-rules", "", "Comparator files are at most 1 MiB"));
    }
    let mut reader = Reader {
        parser: Parser::new_from_str(text),
        lines: text.lines().collect(),
        positions: HashMap::new(),
    };
    let mut document = None;
    loop {
        let (event, marker) = reader.next()?;
        match event {
            Event::StreamStart | Event::DocumentEnd => {}
            Event::StreamEnd => break,
            Event::DocumentStart => {
                if document.is_some() {
                    return Err(invalid(&marker, "Expected one document"));
                }
                let (event, marker) = reader.next()?;
                document = Some(reader.node(event, marker, "", 0)?);
            }
            _ => return Err(invalid(&marker, "Unexpected event")),
        }
    }
    Ok(Document {
        value: document.ok_or_else(|| fail("invalid-rules", "", "Expected a YAML document"))?,
        positions: reader.positions,
        source: text.to_owned(),
    })
}

struct Reader<'a> {
    parser: Parser<std::str::Chars<'a>>,
    /// The source's lines, split once.
    lines: Vec<&'a str>,
    positions: HashMap<String, Position>,
}

impl Reader<'_> {
    fn next(&mut self) -> Result<(Event, Marker), Failure> {
        self.parser.next_token().map_err(|error| invalid(error.marker(), error.info()))
    }

    fn position(&self, marker: &Marker, style: TScalarStyle, path: &str) -> Position {
        match style {
            TScalarStyle::Literal | TScalarStyle::Folded => {
                // The scanner marks a block scalar where it ends. Its content
                // starts on the line after its indicator, which is on its
                // key's line, or on the line of its `- ` in a sequence.
                let lines = &self.lines;
                let indicator = match self.positions.get(path) {
                    Some(key) => key.line,
                    None => (1..=marker.line().min(lines.len()))
                        .rev()
                        .find(|line| {
                            let text = lines[line - 1].trim_start();
                            text.starts_with("- |") || text.starts_with("- >")
                        })
                        .unwrap_or(marker.line()),
                };
                let line = indicator + 1;
                let indent = lines
                    .iter()
                    .skip(indicator)
                    .find(|text| !text.trim().is_empty())
                    .map_or(0, |text| text.len() - text.trim_start_matches(' ').len());
                Position {
                    line,
                    column: indent + 1,
                    style: Style::Block {
                        folded: style == TScalarStyle::Folded,
                        indent,
                    },
                }
            }
            _ => Position {
                line: marker.line(),
                column: marker.col() + 1,
                style: Style::Inline {
                    quoted: matches!(style, TScalarStyle::SingleQuoted | TScalarStyle::DoubleQuoted),
                },
            },
        }
    }

    fn node(&mut self, event: Event, marker: Marker, path: &str, depth: usize) -> Result<Value, Failure> {
        if depth > MAX_DEPTH {
            return Err(invalid(&marker, "Nested too deeply"));
        }
        match event {
            Event::Alias(_) => Err(invalid(&marker, "Aliases aren't allowed")),
            Event::Scalar(_, _, anchor, _) | Event::SequenceStart(anchor, _) | Event::MappingStart(anchor, _) if anchor != 0 => {
                Err(invalid(&marker, "Anchors aren't allowed"))
            }
            Event::Scalar(_, _, _, Some(_)) | Event::SequenceStart(_, Some(_)) | Event::MappingStart(_, Some(_)) => {
                Err(invalid(&marker, "Tags aren't allowed"))
            }
            Event::Scalar(text, style, _, None) => {
                let position = self.position(&marker, style, path);
                self.positions.insert(path.to_owned(), position);
                Ok(scalar(text, style))
            }
            Event::SequenceStart(..) => {
                let mut items = Vec::new();
                loop {
                    let (event, marker) = self.next()?;
                    if event == Event::SequenceEnd {
                        return Ok(Value::Array(items));
                    }
                    let path = pointer(path, &items.len().to_string());
                    items.push(self.node(event, marker, &path, depth + 1)?);
                }
            }
            Event::MappingStart(..) => {
                self.positions
                    .insert(path.to_owned(), self.position(&marker, TScalarStyle::Plain, path));
                let mut fields = Map::new();
                loop {
                    let (event, marker) = self.next()?;
                    let key = match event {
                        Event::MappingEnd => return Ok(Value::Object(fields)),
                        Event::Scalar(text, _, 0, None) => text,
                        _ => return Err(invalid(&marker, "Keys must be plain strings")),
                    };
                    if key == "<<" {
                        return Err(invalid(&marker, "Merge keys aren't allowed"));
                    }
                    if fields.contains_key(&key) {
                        return Err(invalid(&marker, &format!("Duplicate key {key}")));
                    }
                    let path = pointer(path, &key);
                    // A key's own position stands for its value until the value records one.
                    self.positions
                        .insert(path.clone(), self.position(&marker, TScalarStyle::Plain, &path));
                    let (event, marker) = self.next()?;
                    let value = self.node(event, marker, &path, depth + 1)?;
                    fields.insert(key, value);
                }
            }
            _ => Err(invalid(&marker, "Unexpected event")),
        }
    }
}

fn scalar(text: String, style: TScalarStyle) -> Value {
    if style != TScalarStyle::Plain {
        return Value::String(text);
    }
    match text.as_str() {
        "" | "~" | "null" => return Value::Null,
        "true" => return Value::Bool(true),
        "false" => return Value::Bool(false),
        _ => {}
    }
    let digits = text.strip_prefix('-').unwrap_or(&text);
    let decimal = !digits.is_empty()
        && digits
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-'))
        && digits.starts_with(|c: char| c.is_ascii_digit());
    if decimal {
        if let Ok(integer) = text.parse::<i64>() {
            return Value::from(integer);
        }
        if let Some(number) = text.parse::<f64>().ok().and_then(Number::from_f64) {
            return Value::Number(number);
        }
    }
    Value::String(text)
}
