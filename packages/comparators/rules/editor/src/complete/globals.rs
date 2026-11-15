//! Completions for a bare name: the comprehension variables, parameters and
//! inputs in scope, the file's functions, the library, the macros, CEL's
//! functions and the keywords.

use super::Items;
use crate::docs::{self, BUILTINS, Form, INPUTS, MACROS};
use crate::tokens::locals;
use crate::{Analysis, Cel};
use projections_comparator_rules::check::NAMESPACES;

pub(super) fn in_scope(items: &mut Items, analysis: &Analysis, cel: &Cel, prefix: &Cel) {
    let scope = analysis.scope(&cel.path);
    let (locals, declarations) = locals(prefix);
    for name in &locals {
        let declared_here = declarations
            .iter()
            .any(|at| *at + 1 == prefix.lexemes.len() && prefix.text(prefix.lexemes[*at].start, prefix.lexemes[*at].end) == *name);
        if !declared_here {
            items.add(name, "variable", "comprehension variable", "", None);
        }
    }
    for (name, ty) in analysis.params(&cel.path) {
        items.add(&name, "parameter", &format!("(parameter) {name}: {ty}"), "", None);
    }
    let mut variables = false;
    for (name, ty) in scope.names() {
        if name.starts_with("variables.") {
            variables = true;
        } else {
            let doc = INPUTS.iter().find(|(input, _)| input == name).map_or("", |(_, doc)| *doc);
            items.add(name, "input", &format!("{name}: {ty}"), doc, None);
        }
    }
    if variables {
        items.add("variables", "namespace", "variables.<name>", "The named values in scope.", None);
    }
    for name in analysis.functions() {
        let signature = analysis.signature(&name).unwrap_or_default();
        let description = analysis
            .function(&name)
            .and_then(|function| function["description"].as_str())
            .unwrap_or_default()
            .trim()
            .to_owned();
        items.call(&name, "function", &signature, &description);
    }
    for doc in MACROS {
        items.doc(doc, doc.name, "macro");
    }
    items.doc(docs::builtin("has", false).expect("has is documented"), "has", "macro");
    for function in docs::library_in(None) {
        items.library(function, function.name);
    }
    for namespace in NAMESPACES {
        items.add(namespace, "namespace", &format!("{namespace}.*"), "", None);
    }
    for doc in BUILTINS {
        if matches!(doc.form, Form::Global | Form::Both(_)) && !doc.name.contains('.') {
            items.doc(doc, doc.name, "function");
        }
    }
    for keyword in ["true", "false", "null", "in"] {
        items.add(keyword, "keyword", "", "", None);
    }
}
