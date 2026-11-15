//! Hovers: what a token in an expression is, with its signature or type and
//! its documentation.

use crate::docs::{self, INPUTS};
use crate::resolve::{field, local_type, type_at};
use crate::tokens::{Role, classify};
use crate::{Analysis, Cel};
use projections_comparator_rules::library;
use projections_comparator_rules::types::Ty;
use serde_json::{Value, json};

fn code(text: &str) -> String {
    format!("```\n{text}\n```")
}

/// A variable's description and expression.
pub fn variable_markdown(analysis: &Analysis, path: &str, name: &str) -> Option<String> {
    let (declaration, ty) = analysis.variable(path, name)?;
    let mut parts = vec![code(&format!("variables.{name}: {ty}"))];
    if let Some(description) = declaration["description"].as_str() {
        parts.push(description.trim().to_owned());
    }
    if let Some(expression) = declaration["expression"].as_str() {
        parts.push(code(expression.trim()));
    }
    if let Some(values) = declaration["values"].as_array() {
        let values: Vec<String> = values.iter().map(Value::to_string).collect();
        parts.push(format!("Values: {}", values.join(", ")));
    }
    Some(parts.join("\n\n"))
}

/// One of the file's functions: its signature and description.
pub fn function_markdown(analysis: &Analysis, name: &str) -> Option<String> {
    let mut parts = vec![code(&analysis.signature(name)?)];
    if let Some(description) = analysis.function(name)?["description"].as_str() {
        parts.push(description.trim().to_owned());
    }
    Some(parts.join("\n\n"))
}

/// An input's type and what it is.
pub fn input_markdown(name: &str, ty: &Ty) -> String {
    let doc = INPUTS
        .iter()
        .find(|(input, _)| *input == name)
        .map(|(_, doc)| format!("\n\n{doc}"))
        .unwrap_or_default();
    format!("{}{doc}", code(&format!("{name}: {ty}")))
}

fn describe(analysis: &Analysis, cel: &Cel, index: usize, role: &Role) -> Option<String> {
    let scope = analysis.scope(&cel.path);
    Some(match role {
        Role::Library(name) => docs::library_markdown(library::function(name)?),
        Role::Builtin(name, member) => docs::markdown(docs::builtin(name, *member)?),
        Role::Macro(name) => docs::markdown(docs::builtin(name, false)?),
        Role::CelMacro(name) => docs::markdown(docs::builtin(name, name != "has")?),
        Role::Author(name) => function_markdown(analysis, name)?,
        Role::Variable(name) => variable_markdown(analysis, &cel.path, name)?,
        Role::VariablesRoot => {
            let names: Vec<String> = scope
                .names()
                .keys()
                .filter_map(|name| name.strip_prefix("variables.").map(|name| format!("`{name}`")))
                .collect();
            format!("The named values in scope: {}.", names.join(", "))
        }
        Role::Input(name) => input_markdown(name, scope.names().get(name)?),
        Role::Param(name) => {
            let (_, ty) = analysis.params(&cel.path).into_iter().find(|(param, _)| param == name)?;
            code(&format!("(parameter) {name}: {ty}"))
        }
        Role::Local(name, _) => format!(
            "{}\n\nA comprehension variable.",
            code(&format!("{name}: {}", local_type(analysis, cel, index, name).unwrap_or(Ty::Dyn)))
        ),
        Role::Field(name) => {
            let operand = type_at(analysis, cel, index.checked_sub(2)?);
            let ty = field(&operand, name);
            if matches!(operand, Ty::Dyn) {
                return None;
            }
            code(&format!("{operand}.{name}: {ty}"))
        }
        Role::OptionKey(name) => format!(
            "{}\n\nA comparator option, as the definition passes it.",
            code(&format!("options.{name}: dyn"))
        ),
        Role::Namespace(name) => {
            let functions: Vec<String> = docs::library_in(Some(name))
                .map(|function| format!("`{}`", function.name))
                .chain(
                    docs::BUILTINS
                        .iter()
                        .filter(|doc| doc.name.starts_with(&format!("{name}.")))
                        .map(|doc| format!("`{}`", doc.name)),
                )
                .collect();
            format!("The `{name}` namespace: {}.", functions.join(", "))
        }
        Role::TypeName(name) => format!("{}\n\nA CEL type.", code(name)),
        _ => return None,
    })
}

/// The hover at a source position: Markdown and the token's range.
pub fn hover(analysis: &Analysis, line: usize, column: usize) -> Value {
    let Some((cel, offset)) = analysis.at(line, column) else {
        return Value::Null;
    };
    let Some(index) = cel.lexemes.iter().position(|lexeme| lexeme.start <= offset && offset < lexeme.end) else {
        return Value::Null;
    };
    let classified = classify(analysis, cel);
    let lexeme = cel.lexemes[index];
    // A template's `{name}` reads a parameter, or else a variable.
    let placeholder = classified
        .placeholders
        .iter()
        .find(|(at, start, end, _)| *at == index && *start < offset && offset < end - 1);
    let (markdown, start, end) = match placeholder {
        Some((_, start, end, name)) => {
            let markdown = if analysis.params(&cel.path).iter().any(|(param, _)| param == name) {
                describe(analysis, cel, index, &Role::Param(name.clone()))
            } else {
                variable_markdown(analysis, &cel.path, name)
            };
            (markdown, start + 1, end - 1)
        }
        None => {
            let role = &classified.roles[index];
            let markdown = describe(analysis, cel, index, role);
            (markdown, lexeme.start, lexeme.end)
        }
    };
    let Some(markdown) = markdown else {
        return Value::Null;
    };
    let places: Vec<_> = cel.places[start..end].iter().flatten().filter(|place| place.line == line).collect();
    let (Some(first), Some(last)) = (places.first(), places.last()) else {
        return Value::Null;
    };
    json!({
        "markdown": markdown,
        "line": line,
        "column": first.column,
        "endLine": line,
        "endColumn": last.column + last.width,
    })
}
