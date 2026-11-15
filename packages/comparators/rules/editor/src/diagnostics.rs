//! Diagnostics as loading reports them: a rules file through the same reader
//! and checker as `projections_rules_inspect` (and so `projections check` and
//! `npm run check:comparators`), a test file through the test format's reader, each
//! at the line and column it is about.

use crate::Analysis;
use crate::map::lines;
use projections_comparator_rules::Comparator;
use projections_comparator_rules::yaml::suite;
use projections_engine::Diagnostic;
use serde_json::{Value, json};

/// `Line N, column M: message`, as every located diagnostic is written.
fn located(message: &str) -> Option<(usize, usize, &str)> {
    let rest = message.strip_prefix("Line ")?;
    let (line, rest) = rest.split_once(", column ")?;
    let (column, rest) = rest.split_once(": ")?;
    Some((line.parse().ok()?, column.parse().ok()?, rest))
}

/// Where a diagnostic ends: the end of the expression token it starts at, or
/// else of the word there.
fn end(analysis: Option<&Analysis>, source: &str, line: usize, column: usize) -> usize {
    if let Some((cel, offset)) = analysis.and_then(|analysis| analysis.at(line, column)) {
        if let Some(lexeme) = cel.lexemes.iter().find(|lexeme| lexeme.start <= offset && offset < lexeme.end) {
            let last = cel.places[offset..lexeme.end]
                .iter()
                .take_while(|place| place.is_some_and(|place| place.line == line))
                .last()
                .copied()
                .flatten();
            if let Some(place) = last {
                return place.column + place.width;
            }
        }
    }
    let text = lines(source).into_iter().nth(line.saturating_sub(1)).unwrap_or_default();
    let word = text
        .iter()
        .skip(column.saturating_sub(1))
        .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | '$'))
        .count();
    column + word.max(1)
}

fn item(
    severity: &str,
    code: &str,
    path: &str,
    message: &str,
    (line, column): (usize, usize),
    analysis: Option<&Analysis>,
    source: &str,
) -> Value {
    json!({
        "severity": severity,
        "code": code,
        "path": path,
        "message": message,
        "line": line,
        "column": column,
        "endLine": line,
        "endColumn": end(analysis, source, line, column),
    })
}

/// A diagnostic's position: written in its message, or else that of its
/// path, or of the nearest enclosing value that has one.
fn position(analysis: &Analysis, diagnostic: &Diagnostic) -> (usize, usize) {
    let Some(document) = &analysis.document else {
        return (1, 1);
    };
    let mut path = diagnostic.path.as_str();
    loop {
        if let Some(position) = document.positions.get(path) {
            return (position.line, position.column);
        }
        match path.rsplit_once('/') {
            Some((parent, _)) => path = parent,
            None => return (1, 1),
        }
    }
}

/// Every problem loading the file reports, errors then lint warnings.
pub fn diagnostics(source: &str, tests: bool) -> Vec<Value> {
    if tests {
        return match suite::parse(source) {
            Ok(_) => Vec::new(),
            Err(found) => found
                .iter()
                .map(|diagnostic| {
                    item(
                        "error",
                        "invalid-tests",
                        &diagnostic.pointer,
                        &diagnostic.message,
                        (diagnostic.location.line.max(1), diagnostic.location.column.max(1)),
                        None,
                        source,
                    )
                })
                .collect(),
        };
    }
    let (errors, warnings) = match Comparator::from_yaml(source) {
        Ok(comparator) => (Vec::new(), comparator.warnings().to_vec()),
        Err(failure) => (failure, Vec::new()),
    };
    if errors.is_empty() && warnings.is_empty() {
        return Vec::new();
    }
    let analysis = Analysis::new(source);
    let report = |severity: &str, diagnostic: &Diagnostic| match located(&diagnostic.message) {
        Some((line, column, message)) => item(
            severity,
            &diagnostic.code,
            &diagnostic.path,
            message,
            (line, column),
            Some(&analysis),
            source,
        ),
        None => item(
            severity,
            &diagnostic.code,
            &diagnostic.path,
            &diagnostic.message,
            position(&analysis, diagnostic),
            Some(&analysis),
            source,
        ),
    };
    errors
        .iter()
        .map(|diagnostic| report("error", diagnostic))
        .chain(warnings.iter().map(|diagnostic| report("warning", diagnostic)))
        .collect()
}
