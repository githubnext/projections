use super::classify::{Role, classify};
use crate::Analysis;
use crate::map::Place;
use serde_json::{Value, json};

/// A semantic token's type and modifiers.
pub fn style(role: &Role) -> Option<(&'static str, &'static [&'static str])> {
    const LIBRARY: &[&str] = &["defaultLibrary"];
    const NONE: &[&str] = &[];
    Some(match role {
        Role::Library(_) | Role::Builtin(_, false) => ("function", LIBRARY),
        Role::Builtin(_, true) => ("method", LIBRARY),
        Role::Macro(_) => ("macro", NONE),
        Role::CelMacro(_) => ("macro", LIBRARY),
        Role::Author(_) | Role::Call(_) => ("function", NONE),
        Role::Method(_) => ("method", NONE),
        Role::Namespace(_) => ("namespace", LIBRARY),
        Role::VariablesRoot => ("namespace", NONE),
        Role::Variable(_) => ("variable", &["readonly"]),
        Role::OptionKey(_) | Role::Field(_) => ("property", NONE),
        Role::Input(_) => ("parameter", &["readonly", "defaultLibrary"]),
        Role::Param(_) => ("parameter", NONE),
        Role::Local(_, true) => ("variable", &["declaration"]),
        Role::Local(_, false) | Role::Name(_) => ("variable", NONE),
        Role::TypeName(_) => ("type", LIBRARY),
        Role::Keyword => ("keyword", NONE),
        Role::Number => ("number", NONE),
        Role::Str => ("string", NONE),
        Role::Operator => ("operator", NONE),
        Role::Comment => ("comment", NONE),
        Role::Error => return None,
    })
}

/// Emits a token over characters `start..end` of a value, one per run of
/// characters written side by side on one line.
pub(super) fn emit(
    out: &mut Vec<(usize, usize, usize, &'static str, &'static [&'static str])>,
    places: &[Option<Place>],
    (start, end): (usize, usize),
    (ty, modifiers): (&'static str, &'static [&'static str]),
) {
    let mut run: Option<(usize, usize, usize)> = None;
    let mut flush = |run: &mut Option<(usize, usize, usize)>| {
        if let Some((line, column, stop)) = run.take() {
            out.push((line, column, stop - column, ty, modifiers));
        }
    };
    for place in places.iter().take(end).skip(start) {
        match (place, run) {
            (Some(place), Some((line, _, stop))) if place.line == line && place.column == stop => {
                run = run.map(|(line, column, _)| (line, column, place.column + place.width));
            }
            (Some(place), _) => {
                flush(&mut run);
                run = Some((place.line, place.column, place.column + place.width));
            }
            (None, _) => flush(&mut run),
        }
    }
    flush(&mut run);
}

/// Every semantic token in a rules file, in order.
pub fn tokens(analysis: &Analysis) -> Vec<Value> {
    let mut out = Vec::new();
    for cel in &analysis.cels {
        let classified = classify(analysis, cel);
        for (i, (lexeme, role)) in cel.lexemes.iter().zip(&classified.roles).enumerate() {
            let Some(style) = style(role) else { continue };
            let fields: Vec<_> = classified.placeholders.iter().filter(|(index, ..)| *index == i).collect();
            let mut at = lexeme.start;
            for (_, start, end, name) in fields {
                emit(&mut out, &cel.places, (at, *start), style);
                emit(&mut out, &cel.places, (*start, start + 1), ("operator", &[]));
                let field = if analysis.params(&cel.path).iter().any(|(param, _)| param == name) {
                    ("parameter", &[][..])
                } else {
                    ("variable", &["readonly"][..])
                };
                emit(&mut out, &cel.places, (start + 1, end - 1), field);
                emit(&mut out, &cel.places, (end - 1, *end), ("operator", &[]));
                at = *end;
            }
            emit(&mut out, &cel.places, (at, lexeme.end), style);
        }
    }
    for (chars, places) in &analysis.types {
        let mut i = 0;
        while i < chars.len() {
            let start = i;
            if chars[i].is_ascii_alphanumeric() || chars[i] == '_' {
                while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                    i += 1;
                }
                emit(&mut out, places, (start, i), ("type", &[]));
            } else {
                i += 1;
                if !chars[start].is_whitespace() {
                    emit(&mut out, places, (start, i), ("operator", &[]));
                }
            }
        }
    }
    declarations(analysis, &mut out);
    out.sort_by_key(|(line, column, ..)| (*line, *column));
    out.dedup_by_key(|(line, column, ..)| (*line, *column));
    out.into_iter()
        .map(|(line, column, length, ty, modifiers)| {
            json!({"line": line, "column": column, "length": length, "type": ty, "modifiers": modifiers})
        })
        .collect()
}

/// Variable and parameter names where they are declared.
pub(super) fn declarations(analysis: &Analysis, out: &mut Vec<(usize, usize, usize, &'static str, &'static [&'static str])>) {
    let Some(document) = &analysis.document else {
        return;
    };
    let lines = crate::map::lines(&document.source);
    let mut name = |path: String, value: &Value, style: (&'static str, &'static [&'static str])| {
        if let (Some(text), Some(position)) = (value.as_str(), document.positions.get(&path)) {
            let places = crate::map::locate(&lines, position, text);
            emit(out, &places, (0, places.len()), style);
        }
    };
    let value = &document.value;
    let mut lists = vec!["/variables".to_owned()];
    for section in ["classify", "steps", "metadata"] {
        lists.push(format!("/{section}/variables"));
    }
    if let Some(functions) = value["functions"].as_object() {
        for (function, body) in functions {
            let base = projections_engine::pointer("/functions", function);
            lists.push(format!("{base}/variables"));
            for (index, param) in body["params"].as_array().into_iter().flatten().enumerate() {
                let declared = ("parameter", &["declaration"][..]);
                match param {
                    Value::String(_) => name(format!("{base}/params/{index}"), param, declared),
                    _ => name(format!("{base}/params/{index}/name"), &param["name"], declared),
                }
            }
        }
    }
    for list in lists {
        for (index, variable) in value.pointer(&list).and_then(Value::as_array).into_iter().flatten().enumerate() {
            name(
                format!("{list}/{index}/name"),
                &variable["name"],
                ("variable", &["declaration", "readonly"]),
            );
        }
    }
}
