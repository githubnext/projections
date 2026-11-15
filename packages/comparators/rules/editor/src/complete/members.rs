//! Completions after `operand.`: the variables in scope, the option keys, a
//! library namespace's functions, or the fields and methods of the operand's
//! type.

use super::Items;
use crate::docs::{self, BUILTINS, CEL_MACROS, Form};
use crate::hover::variable_markdown;
use crate::resolve::type_at;
use crate::tokens::{Kind, locals};
use crate::{Analysis, Cel};
use projections_comparator_rules::check::NAMESPACES;
use projections_comparator_rules::types::{self, Ty};

/// Whether a member function applies to a value of `ty`.
fn applies(receiver: &str, ty: &Ty) -> bool {
    match ty {
        Ty::Dyn | Ty::Never => true,
        Ty::String => matches!(receiver, "string" | "any"),
        Ty::List(_) => matches!(receiver, "list" | "any"),
        Ty::Map(..) | Ty::Record(_) => matches!(receiver, "list" | "any"),
        Ty::Optional(_) => receiver == "optional",
        Ty::Bytes => receiver == "any",
        _ => false,
    }
}

fn members(items: &mut Items, ty: &Ty) {
    match ty {
        Ty::Object(object) => {
            for (name, field) in types::fields(object).unwrap_or_default() {
                items.add(name, "field", &format!("{object}.{name}: {field}"), "", None);
            }
        }
        Ty::Record(fields) => {
            for (name, field) in fields {
                items.add(name, "field", &field.to_string(), "", None);
            }
        }
        _ => {}
    }
    for doc in CEL_MACROS.iter().chain(BUILTINS) {
        if let Form::Member(receiver) | Form::Both(receiver) = doc.form {
            if applies(receiver, ty) {
                let kind = if doc.binds { "macro" } else { "method" };
                items.doc(doc, doc.name, kind);
            }
        }
    }
}

/// The completions after `operand.`: the variables in scope, the option keys,
/// a library namespace's functions, or the fields and methods of the
/// operand's type.
pub(super) fn after_dot(items: &mut Items, analysis: &Analysis, cel: &Cel, prefix: &Cel, operand: usize) {
    let lx = &prefix.lexemes;
    let kind = |i: usize| lx.get(i).map(|lexeme| lexeme.kind);
    let text = |i: usize| prefix.text(lx[i].start, lx[i].end);
    let bare = |i: usize| i == 0 || kind(i - 1) != Some(Kind::Dot);
    let name = (kind(operand) == Some(Kind::Ident) && bare(operand)).then(|| text(operand));
    let (locals, _) = locals(prefix);
    let params: Vec<String> = analysis.params(&cel.path).into_iter().map(|(name, _)| name).collect();
    let shadowed = |name: &str| locals.contains(name) || params.iter().any(|param| param == name);
    match name.as_deref() {
        Some("variables") if !shadowed("variables") => {
            for (name, ty) in analysis.scope(&cel.path).names() {
                if let Some(variable) = name.strip_prefix("variables.") {
                    let documentation = variable_markdown(analysis, &cel.path, variable).unwrap_or_default();
                    items.add(variable, "variable", &format!("{name}: {ty}"), &documentation, None);
                }
            }
        }
        Some("options") if !shadowed("options") => {
            for key in &analysis.options {
                items.add(key, "property", "comparator option", "", None);
            }
        }
        Some(namespace) if NAMESPACES.contains(&namespace) && !shadowed(namespace) => {
            for function in docs::library_in(Some(namespace)) {
                let label = &function.name[namespace.len() + 1..];
                items.library(function, label);
            }
            for doc in BUILTINS {
                if let Some(label) = doc.name.strip_prefix(&format!("{namespace}.")) {
                    items.doc(doc, label, "function");
                }
            }
        }
        _ => members(items, &type_at(analysis, prefix, operand)),
    }
}
