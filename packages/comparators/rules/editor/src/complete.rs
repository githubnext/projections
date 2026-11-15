//! Completions in an expression: after `variables.`, the variables in scope;
//! after `options.`, the option keys the file reads; after a library
//! namespace, its functions; after a value of a declared type, its fields and
//! methods; otherwise every name in scope, the file's functions, the library,
//! the macros and CEL's functions.

mod globals;
mod members;

use crate::docs::{self, Doc};
use crate::tokens::{Kind, lex};
use crate::{Analysis, Cel};
use projections_comparator_rules::library::Function;
use serde_json::{Value, json};
use std::collections::BTreeSet;

struct Items {
    seen: BTreeSet<String>,
    items: Vec<Value>,
}

impl Items {
    fn add(&mut self, label: &str, kind: &str, detail: &str, documentation: &str, insert: Option<String>) {
        if !self.seen.insert(label.to_owned()) {
            return;
        }
        let mut item = json!({"label": label, "kind": kind, "detail": detail, "documentation": documentation});
        if let Some(insert) = insert {
            item["insert"] = json!(insert);
        }
        self.items.push(item);
    }

    fn call(&mut self, label: &str, kind: &str, detail: &str, documentation: &str) {
        self.add(label, kind, detail, documentation, Some(format!("{label}($0)")));
    }

    fn library(&mut self, function: &Function, label: &str) {
        self.call(label, "function", &docs::signature(function), function.doc);
    }

    fn doc(&mut self, doc: &Doc, label: &str, kind: &str) {
        self.call(label, kind, doc.signature, doc.doc);
    }
}

/// The completions at a source position, and the range they replace.
pub fn complete(analysis: &Analysis, line: usize, column: usize) -> Value {
    let none = json!({"items": [], "range": null});
    let Some((cel, offset)) = analysis.at(line, column) else {
        return none;
    };
    let source: String = cel.chars[..offset].iter().collect();
    let prefix = Cel {
        path: cel.path.clone(),
        chars: cel.chars[..offset].to_vec(),
        places: cel.places[..offset].to_vec(),
        lexemes: lex(&source),
    };
    let lx = &prefix.lexemes;
    let last = lx.last().copied();
    // Inside a string, a number or a comment, there is nothing to complete.
    if last.is_some_and(|lexeme| lexeme.end == offset && matches!(lexeme.kind, Kind::Str | Kind::Number | Kind::Comment)) {
        return none;
    }
    let (word, before) = match last {
        Some(lexeme) if lexeme.kind == Kind::Ident && lexeme.end == offset => (lexeme.start, lx.len().checked_sub(2)),
        _ => (offset, lx.len().checked_sub(1)),
    };
    let mut items = Items {
        seen: BTreeSet::new(),
        items: Vec::new(),
    };
    let kind = |i: usize| lx.get(i).map(|lexeme| lexeme.kind);
    match before {
        Some(dot) if kind(dot) == Some(Kind::Dot) => {
            let Some(operand) = dot.checked_sub(1) else {
                return none;
            };
            members::after_dot(&mut items, analysis, cel, &prefix, operand);
        }
        _ => globals::in_scope(&mut items, analysis, cel, &prefix),
    }
    let start = prefix
        .places
        .get(word)
        .copied()
        .flatten()
        .map_or(column, |place| if place.line == line { place.column } else { column });
    json!({
        "items": items.items,
        "range": {"line": line, "column": start, "endColumn": column},
    })
}
