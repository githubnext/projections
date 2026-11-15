//! Where coverage entries are, and what they say: an expression's text, its
//! line and column in the rules file, and the lines `coverage-ignore:`
//! comments exclude.

use crate::yaml::Position;
use cel::common::ast::{EntryExpr, Expr, IdedExpr, SourceInfo};
use std::collections::BTreeMap;

const MARKER: &str = "coverage-ignore:";
/// The longest condition text a report shows.
const LONGEST: usize = 80;

/// The lines `coverage-ignore: <reason>` comments exclude, 1-based, with
/// their reasons: the comment's own line when it follows code, or else the
/// next line. A marker without a reason excludes nothing.
pub fn exclusions(text: &str) -> BTreeMap<usize, String> {
    let mut lines = BTreeMap::new();
    for (index, line) in text.lines().enumerate() {
        let Some(at) = line.find(MARKER) else {
            continue;
        };
        let before = line[..at].trim_end();
        let Some(code) = before.strip_suffix('#').or_else(|| before.strip_suffix("//")) else {
            continue;
        };
        let reason = line[at + MARKER.len()..].trim();
        if reason.is_empty() {
            continue;
        }
        let target = if code.trim().is_empty() { index + 2 } else { index + 1 };
        lines.insert(target, reason.to_owned());
    }
    lines
}

/// The byte range an expression spans in `source`: the union of its nodes'
/// tokens. A token's stop is its last byte, and a call's token is its
/// parenthesis, preceded by the function's name.
fn span(expr: &IdedExpr, info: &SourceInfo, source: &str, out: &mut Option<(u32, u32)>) {
    if let Some((mut start, stop)) = info.offset_for(expr.id) {
        if let Expr::Call(call) = &expr.expr
            && call.target.is_none()
            && let Some(before) = source.get(..start as usize)
            && before.ends_with(call.func_name.as_str())
        {
            start -= call.func_name.len() as u32;
        }
        // `has(x.y)` is a select, placed at its parenthesis.
        if let Expr::Select(select) = &expr.expr
            && select.test
            && let Some(before) = source.get(..start as usize)
            && before.ends_with("has")
        {
            start -= 3;
        }
        let stop = stop + 1;
        *out = Some(match *out {
            Some((low, high)) => (low.min(start), high.max(stop)),
            None => (start, stop),
        });
    }
    let mut visit = |child: &IdedExpr| span(child, info, source, out);
    match &expr.expr {
        Expr::Call(call) => {
            if let Some(target) = &call.target {
                visit(target);
            }
            call.args.iter().for_each(&mut visit);
        }
        Expr::Comprehension(c) => {
            for child in [&c.iter_range, &c.accu_init, &c.loop_cond, &c.loop_step, &c.result] {
                visit(child);
            }
        }
        Expr::List(items) => items.elements.iter().for_each(&mut visit),
        Expr::Map(map) => {
            for entry in &map.entries {
                if let EntryExpr::MapEntry(entry) = &entry.expr {
                    visit(&entry.key);
                    visit(&entry.value);
                }
            }
        }
        Expr::Struct(structure) => {
            for entry in &structure.entries {
                if let EntryExpr::StructField(field) = &entry.expr {
                    visit(&field.value);
                }
            }
        }
        Expr::Select(select) => visit(&select.operand),
        _ => {}
    }
}

fn identifier(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// The end of the text an expression spans, from the end of its last token:
/// tokens don't cover a selected field's name or the parentheses and
/// brackets that close a call, a list or a map.
fn complete(source: &[u8], start: usize, stop: usize) -> usize {
    let mut stop = stop.min(source.len());
    let mut depth = 0i32;
    let mut quote = None;
    let mut index = start.min(stop);
    loop {
        while index < stop {
            let byte = source[index];
            match quote {
                Some(_) if byte == b'\\' => index += 1,
                Some(open) if byte == open => quote = None,
                Some(_) => {}
                None if byte == b'\'' || byte == b'"' => quote = Some(byte),
                None if matches!(byte, b'(' | b'[' | b'{') => depth += 1,
                None if matches!(byte, b')' | b']' | b'}') => depth -= 1,
                None => {}
            }
            index += 1;
        }
        let continues = stop < source.len()
            && stop > 0
            && quote.is_none()
            && (depth > 0
                || (identifier(source[stop - 1]) || source[stop - 1] == b'.') && identifier(source[stop])
                || source[stop] == b'.' && source.get(stop + 1).is_some_and(|byte| identifier(*byte)) && identifier(source[stop - 1]));
        if !continues && quote.is_none() {
            return stop;
        }
        if stop >= source.len() {
            return stop;
        }
        stop += 1;
    }
}

/// An expression's source and where it is in the rules file.
pub struct Text<'a> {
    pub source: &'a str,
    pub info: &'a SourceInfo,
    pub position: Option<Position>,
    /// The rules file's text, for positions in folded blocks.
    pub file: &'a str,
}

impl Text<'_> {
    /// Where an expression starts, in bytes.
    pub fn start(&self, expr: &IdedExpr) -> Option<u32> {
        let mut range = None;
        span(expr, self.info, self.source, &mut range);
        range.map(|(start, _)| start)
    }

    /// An expression as written, whitespace collapsed and shortened.
    pub fn of(&self, expr: &IdedExpr) -> String {
        let mut range = None;
        span(expr, self.info, self.source, &mut range);
        let written = range
            .and_then(|(start, stop)| {
                let stop = complete(self.source.as_bytes(), start as usize, stop as usize);
                self.source.get(start as usize..stop)
            })
            .unwrap_or_default();
        let collapsed = written.split_whitespace().collect::<Vec<_>>().join(" ");
        if collapsed.chars().count() <= LONGEST {
            return collapsed;
        }
        let short: String = collapsed.chars().take(LONGEST - 1).collect();
        format!("{}…", short.trim_end())
    }

    /// The line and column of a byte offset into the expression, or of the
    /// expression's start without one.
    pub fn line_column(&self, offset: Option<u32>) -> (usize, usize) {
        let Some(position) = &self.position else {
            return (0, 0);
        };
        let Some(offset) = offset else {
            return (position.line, position.column);
        };
        let bytes = (offset as usize).min(self.source.len());
        let characters = self.source.get(..bytes).map_or(bytes, |before| before.chars().count());
        position.at(self.source, characters, self.file)
    }
}
