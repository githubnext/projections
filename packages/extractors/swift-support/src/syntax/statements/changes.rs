//! The changes a statement makes to values: `x += …`, `x.append(…)`,
//! `x = …`, `x[i] = …` and other mutating methods, through member chains.

use super::super::Expr;
use super::super::expr::Parser;
use super::super::expr::skip::{closes, opens};
use super::Mutation;
use crate::lexer::{Kind, Token};

/// Methods that change an array in place: `RangeReplaceableCollection`'s and
/// `MutableCollection`'s.
const MUTATING: [&str; 15] = [
    "append",
    "insert",
    "remove",
    "removeAll",
    "removeFirst",
    "removeLast",
    "removeSubrange",
    "popFirst",
    "popLast",
    "replaceSubrange",
    "sort",
    "reverse",
    "shuffle",
    "swapAt",
    "partition",
];

/// Every change to a value the statement makes. `offset` is the index of its
/// first token in the file.
pub(super) fn mutations(statement: &[Token], offset: usize, conditional: bool, found: &mut Vec<Mutation>) {
    for (at, token) in statement.iter().enumerate() {
        if token.kind != Kind::Ident {
            continue;
        }
        let rest = &statement[at + 1..];
        // `x.append(…)` changes `x`, not a member named `append`.
        if MUTATING.contains(&token.text.as_str()) && at > 0 && statement[at - 1].punct(".") {
            continue;
        }
        let Some(change) = change(rest) else {
            continue;
        };
        let (start, path) = chain(statement, at);
        let appended = match change {
            Change::Append(skip) if start == 0 && !conditional => appended(&rest[skip..], offset + at + 1 + skip),
            _ => None,
        };
        found.push(Mutation {
            path,
            appended,
            line: token.line,
            end: offset + statement.len(),
        });
    }
}

/// The member chain ending at `end` (`package.targets[0].dependencies`) as its
/// names, and where it starts. Subscripts, calls and `?`/`!` are skipped.
fn chain(statement: &[Token], end: usize) -> (usize, Vec<String>) {
    let mut names = vec![statement[end].text.clone()];
    let mut at = end;
    while at > 0 && statement[at - 1].punct(".") {
        let mut before = at - 1;
        loop {
            match statement[..before].last() {
                Some(token) if token.kind == Kind::Punct && matches!(token.text.as_str(), "?" | "!") => before -= 1,
                Some(token) if closes(token) => before = opening(statement, before - 1),
                _ => break,
            }
        }
        match statement[..before].last() {
            Some(token) if token.kind == Kind::Ident => {
                at = before - 1;
                names.insert(0, token.text.clone());
            }
            _ => break,
        }
    }
    (at, names)
}

/// The index of the bracket that opens the one closing at `close`.
fn opening(statement: &[Token], close: usize) -> usize {
    let mut depth = 0usize;
    for at in (0..=close).rev() {
        if closes(&statement[at]) {
            depth += 1;
        } else if opens(&statement[at]) {
            depth -= 1;
            if depth == 0 {
                return at;
            }
        }
    }
    0
}

enum Change {
    /// Appends what starts this many tokens later.
    Append(usize),
    Other,
}

/// The change that follows a path, if any.
fn change(rest: &[Token]) -> Option<Change> {
    let first = rest.first()?;
    if first.punct("+=") {
        return Some(Change::Append(1));
    }
    if first.kind == Kind::Punct && matches!(first.text.as_str(), "=" | "-=") {
        return Some(Change::Other);
    }
    if first.punct("[") {
        let close = rest.iter().position(|token| token.punct("]"))?;
        return rest.get(close + 1).filter(|token| token.punct("=")).map(|_| Change::Other);
    }
    let method = rest.get(1).filter(|_| first.punct("."))?;
    if !MUTATING.contains(&method.text.as_str()) || !rest.get(2).is_some_and(|token| token.punct("(")) {
        return None;
    }
    Some(if method.text == "append" {
        Change::Append(2)
    } else {
        Change::Other
    })
}

/// What `+= value` or `.append(value)` (from the `(`) adds, as an array.
/// `base` is the index of `tokens[0]` in the file.
fn appended(tokens: &[Token], base: usize) -> Option<Expr> {
    let mut parser = Parser { tokens, at: 0, base };
    if !tokens.first()?.punct("(") {
        let value = parser.expression().ok()?;
        return (parser.at == tokens.len()).then_some(value);
    }
    let args = parser.arguments().ok()?;
    if parser.at != tokens.len() {
        return None;
    }
    match args.as_slice() {
        [single] if single.label.as_deref() == Some("contentsOf") => Some(single.value.clone()),
        [single] if single.label.is_none() => Some(Expr::Array(vec![single.value.clone()])),
        _ => None,
    }
}
