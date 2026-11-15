//! The declared type of the value a token ends, as far as the rules file and
//! the declared types say: for completing `x.` and describing a field.

use crate::docs;
use crate::tokens::{Kind, binds_variable};
use crate::{Analysis, Cel};
use projections_comparator_rules::check::NAMESPACES;
use projections_comparator_rules::library;
use projections_comparator_rules::types::{self, Ty, list};

/// The type a field `name` of a `ty` value has.
pub fn field(ty: &Ty, name: &str) -> Ty {
    match ty {
        Ty::Object(object) => types::field(object, name).unwrap_or(Ty::Dyn),
        Ty::Record(fields) => fields.get(name).cloned().unwrap_or(Ty::Dyn),
        Ty::Map(_, value) => (**value).clone(),
        _ => Ty::Dyn,
    }
}

/// What a comprehension over a `ty` value binds its variable to.
pub fn element(ty: &Ty) -> Ty {
    match ty {
        Ty::List(item) => (**item).clone(),
        Ty::Map(key, _) => (**key).clone(),
        Ty::Record(_) => Ty::String,
        _ => Ty::Dyn,
    }
}

fn parse(text: &str) -> Ty {
    types::parse(text).unwrap_or(Ty::Dyn)
}

/// The index of the token that opens the bracket closed at `close`.
fn opening(cel: &Cel, close: usize, open: Kind, closed: Kind) -> Option<usize> {
    let mut depth = 0usize;
    for j in (0..=close).rev() {
        let kind = cel.lexemes[j].kind;
        if kind == closed {
            depth += 1;
        } else if kind == open {
            depth -= 1;
            if depth == 0 {
                return Some(j);
            }
        }
    }
    None
}

/// The type of the operand whose last token is `end`.
pub fn type_at(analysis: &Analysis, cel: &Cel, end: usize) -> Ty {
    resolve(analysis, cel, end, 0)
}

fn resolve(analysis: &Analysis, cel: &Cel, end: usize, depth: usize) -> Ty {
    if depth > 32 || end >= cel.lexemes.len() {
        return Ty::Dyn;
    }
    match cel.lexemes[end].kind {
        Kind::Str => Ty::String,
        Kind::Ident => ident(analysis, cel, end, depth),
        Kind::RightParen => call(analysis, cel, end, depth),
        Kind::RightBracket => index(analysis, cel, end, depth),
        _ => Ty::Dyn,
    }
}

fn text(cel: &Cel, i: usize) -> String {
    cel.text(cel.lexemes[i].start, cel.lexemes[i].end)
}

fn kind(cel: &Cel, i: usize) -> Option<Kind> {
    cel.lexemes.get(i).map(|lexeme| lexeme.kind)
}

/// Whether token `i` doesn't follow a `.`: a name, not a field or method.
fn bare(cel: &Cel, i: usize) -> bool {
    i == 0 || kind(cel, i - 1) != Some(Kind::Dot)
}

/// A name: `variables.<name>`, a field, a comprehension variable, a
/// parameter or a name in scope.
fn ident(analysis: &Analysis, cel: &Cel, end: usize, depth: usize) -> Ty {
    let scope = analysis.scope(&cel.path);
    let name = text(cel, end);
    if !bare(cel, end) {
        if end < 2 {
            return Ty::Dyn;
        }
        if kind(cel, end - 2) == Some(Kind::Ident) && text(cel, end - 2) == "variables" && bare(cel, end - 2) {
            return scope.names().get(&format!("variables.{name}")).cloned().unwrap_or(Ty::Dyn);
        }
        return field(&resolve(analysis, cel, end - 2, depth + 1), &name);
    }
    if let Some(ty) = local(analysis, cel, end, &name, depth) {
        return ty;
    }
    let params = analysis.params(&cel.path);
    if let Some((_, ty)) = params.iter().find(|(param, _)| *param == name) {
        return ty.clone();
    }
    scope.names().get(&name).cloned().unwrap_or(Ty::Dyn)
}

/// A call's result: the file's function, a library function, CEL's own, or
/// a method, by its declared return type.
fn call(analysis: &Analysis, cel: &Cel, end: usize, depth: usize) -> Ty {
    let Some(open) = opening(cel, end, Kind::LeftParen, Kind::RightParen) else {
        return Ty::Dyn;
    };
    if open == 0 || kind(cel, open - 1) != Some(Kind::Ident) {
        return Ty::Dyn;
    }
    let callee = open - 1;
    let name = text(cel, callee);
    if bare(cel, callee) {
        if analysis.function(&name).is_some() {
            return analysis.returns(&name);
        }
        if let Some(function) = library::function(&name) {
            return (function.returns)();
        }
        return docs::builtin(&name, false).map_or(Ty::Dyn, |doc| parse(doc.returns));
    }
    if callee < 2 {
        return Ty::Dyn;
    }
    let receiver = callee - 2;
    if kind(cel, receiver) == Some(Kind::Ident) && bare(cel, receiver) && NAMESPACES.contains(&text(cel, receiver).as_str()) {
        let full = format!("{}.{name}", text(cel, receiver));
        if let Some(function) = library::function(&full) {
            return (function.returns)();
        }
        return docs::builtin(&full, false).map_or(Ty::Dyn, |doc| parse(doc.returns));
    }
    let target = resolve(analysis, cel, receiver, depth + 1);
    match name.as_str() {
        "filter" | "sortBy" | "distinct" | "sort" | "slice" | "reverse" => target,
        _ => docs::builtin(&name, true).map_or(Ty::Dyn, |doc| parse(doc.returns)),
    }
}

/// An index's result, or a list literal.
fn index(analysis: &Analysis, cel: &Cel, end: usize, depth: usize) -> Ty {
    let Some(open) = opening(cel, end, Kind::LeftBracket, Kind::RightBracket) else {
        return Ty::Dyn;
    };
    let indexes = open > 0 && matches!(kind(cel, open - 1), Some(Kind::Ident | Kind::RightParen | Kind::RightBracket));
    if !indexes {
        return list(Ty::Dyn);
    }
    match resolve(analysis, cel, open - 1, depth + 1) {
        Ty::List(item) => *item,
        Ty::Map(_, value) => *value,
        _ => Ty::Dyn,
    }
}

/// The type of comprehension variable `name`, declared at or before token `at`.
pub fn local_type(analysis: &Analysis, cel: &Cel, at: usize, name: &str) -> Option<Ty> {
    local(analysis, cel, at + 1, name, 0)
}

/// The type of comprehension variable `name`, declared before token `at`.
fn local(analysis: &Analysis, cel: &Cel, at: usize, name: &str, depth: usize) -> Option<Ty> {
    let lx = &cel.lexemes;
    (4..at.min(lx.len()))
        .rev()
        .find(|declared| {
            let macro_index = declared - 2;
            lx[*declared].kind == Kind::Ident
                && cel.text(lx[*declared].start, lx[*declared].end) == name
                && lx[declared - 1].kind == Kind::LeftParen
                && lx[macro_index - 1].kind == Kind::Dot
                && binds_variable(&cel.text(lx[macro_index].start, lx[macro_index].end))
                && lx.get(declared + 1).map(|lexeme| lexeme.kind) == Some(Kind::Comma)
        })
        .map(|declared| element(&resolve(analysis, cel, declared - 4, depth + 1)))
}
