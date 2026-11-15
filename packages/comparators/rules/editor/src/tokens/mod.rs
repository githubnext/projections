//! CEL tokens, by the `cel` crate's own lexer, and what each one is in a
//! rules file: a library function, a macro, the file's own function, a
//! variable, an input, a parameter, a field. Semantic tokens use LSP's
//! standard types and modifiers, so every theme colours them.

mod classify;
mod lex;
mod names;
mod semantic;

pub use self::classify::{Role, binds_variable, classify, locals};
pub use self::lex::{Kind, Lexeme, lex};
pub use self::semantic::tokens;
use crate::Cel;
use std::collections::{BTreeSet, HashSet};

/// The text of a string literal, without its prefix and quotes.
pub fn literal(text: &str) -> String {
    let text = text.trim_start_matches(['r', 'R', 'b', 'B']);
    for quote in ["'''", "\"\"\"", "'", "\""] {
        if let Some(inner) = text.strip_prefix(quote) {
            return inner.strip_suffix(quote).unwrap_or(inner).to_owned();
        }
    }
    text.to_owned()
}

/// The `options` keys an expression reads: `options.key`, `options['key']`,
/// and the keys a comprehension over `options` compares its variable with.
pub fn option_keys(cel: &Cel, keys: &mut BTreeSet<String>) {
    let lx = &cel.lexemes;
    let text = |i: usize| cel.text(lx[i].start, lx[i].end);
    let kind = |i: usize| lx.get(i).map(|lexeme| lexeme.kind);
    let mut over_options = HashSet::new();
    for i in 0..lx.len() {
        if kind(i) != Some(Kind::Ident) || text(i) != "options" || (i > 0 && kind(i - 1) == Some(Kind::Dot)) {
            continue;
        }
        match (kind(i + 1), kind(i + 2), kind(i + 3)) {
            (Some(Kind::Dot), Some(Kind::Ident), next) if next != Some(Kind::LeftParen) => {
                keys.insert(text(i + 2));
            }
            (Some(Kind::LeftBracket), Some(Kind::Str), Some(Kind::RightBracket)) => {
                keys.insert(literal(&text(i + 2)));
            }
            (Some(Kind::Dot), Some(Kind::Ident), Some(Kind::LeftParen))
                if binds_variable(&text(i + 2)) && kind(i + 4) == Some(Kind::Ident) =>
            {
                over_options.insert(text(i + 4));
            }
            _ => {}
        }
    }
    for i in 0..lx.len() {
        if kind(i) != Some(Kind::Ident) || !over_options.contains(&text(i)) {
            continue;
        }
        let compared = |j: usize| kind(j) == Some(Kind::Operator) && ["==", "!="].contains(&text(j).as_str());
        if compared(i + 1) && kind(i + 2) == Some(Kind::Str) {
            keys.insert(literal(&text(i + 2)));
        }
        if i >= 2 && compared(i - 1) && kind(i - 2) == Some(Kind::Str) {
            keys.insert(literal(&text(i - 2)));
        }
        if kind(i + 1) == Some(Kind::Keyword) && text(i + 1) == "in" && kind(i + 2) == Some(Kind::LeftBracket) {
            let mut j = i + 3;
            while let Some(next) = kind(j) {
                match next {
                    Kind::Str => {
                        keys.insert(literal(&text(j)));
                    }
                    Kind::Comma => {}
                    _ => break,
                }
                j += 1;
            }
        }
    }
    keys.retain(|key| !key.is_empty());
}
