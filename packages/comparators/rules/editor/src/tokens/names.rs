use super::classify::{Role, TYPE_NAMES, binds_variable};
use super::lex::Kind;
use crate::Cel;
use crate::docs;
use projections_comparator_rules::check::{NAMESPACES, Scope};
use projections_comparator_rules::library;
use projections_comparator_rules::macros::MACROS;
use std::collections::HashSet;

/// What an expression's names can refer to.
pub(super) struct Classifier<'a> {
    pub(super) cel: &'a Cel,
    pub(super) scope: Scope,
    pub(super) params: HashSet<String>,
    pub(super) authors: HashSet<String>,
    pub(super) locals: HashSet<String>,
    pub(super) declarations: HashSet<usize>,
}

impl Classifier<'_> {
    pub(super) fn text(&self, i: usize) -> String {
        let lexeme = &self.cel.lexemes[i];
        self.cel.text(lexeme.start, lexeme.end)
    }

    pub(super) fn kind(&self, i: usize) -> Option<Kind> {
        self.cel.lexemes.get(i).map(|lexeme| lexeme.kind)
    }

    fn shadowed(&self, name: &str) -> bool {
        self.locals.contains(name) || self.params.contains(name) || self.scope.names().contains_key(name)
    }

    /// Whether string token `i` is a global `template(` call's format.
    pub(super) fn is_template(&self, i: usize) -> bool {
        i >= 2
            && self.kind(i - 1) == Some(Kind::LeftParen)
            && self.kind(i - 2) == Some(Kind::Ident)
            && self.text(i - 2) == "template"
            && (i < 3 || self.kind(i - 3) != Some(Kind::Dot))
    }

    /// An identifier's role: a call, a member, or a bare name.
    pub(super) fn ident(&self, i: usize) -> Role {
        let name = self.text(i);
        let call = self.kind(i + 1) == Some(Kind::LeftParen);
        let member = i >= 1 && self.kind(i - 1) == Some(Kind::Dot);
        // The bare name this one is selected from: `graph` in `graph.entity`.
        let root = (member && i >= 2 && self.kind(i - 2) == Some(Kind::Ident) && (i < 3 || self.kind(i - 3) != Some(Kind::Dot)))
            .then(|| self.text(i - 2));
        match (call, member) {
            (true, true) => self.member_call(name, root.as_deref()),
            (true, false) => self.global_call(name),
            (false, true) => self.member(name, root.as_deref()),
            (false, false) => self.bare(name, i),
        }
    }

    /// `x.name(…)`: a namespaced library or CEL function, a CEL macro, or a
    /// method.
    fn member_call(&self, name: String, root: Option<&str>) -> Role {
        let namespace = root.filter(|root| NAMESPACES.contains(root) && !self.shadowed(root));
        match namespace {
            Some(space) => function(format!("{space}.{name}")),
            None if binds_variable(&name) => Role::CelMacro(name),
            None if docs::builtin(&name, true).is_some() => Role::Builtin(name, true),
            None => Role::Method(name),
        }
    }

    /// `name(…)`: a macro, the file's function, a library or CEL function.
    fn global_call(&self, name: String) -> Role {
        if MACROS.contains(&name.as_str()) {
            Role::Macro(name)
        } else if name == "has" {
            Role::CelMacro(name)
        } else if self.authors.contains(&name) {
            Role::Author(name)
        } else {
            function(name)
        }
    }

    /// `x.name`: a variable, an option key or a field.
    fn member(&self, name: String, root: Option<&str>) -> Role {
        match root {
            Some("variables") if !self.locals.contains("variables") => Role::Variable(name),
            Some("options") if !self.locals.contains("options") && !self.params.contains("options") => Role::OptionKey(name),
            _ => Role::Field(name),
        }
    }

    /// A bare name: a comprehension variable, `variables`, a parameter, an
    /// input, a namespace or a type.
    fn bare(&self, name: String, i: usize) -> Role {
        let dotted = self.kind(i + 1) == Some(Kind::Dot);
        if self.declarations.contains(&i) {
            Role::Local(name, true)
        } else if self.locals.contains(&name) {
            Role::Local(name, false)
        } else if name == "variables" && dotted {
            Role::VariablesRoot
        } else if self.params.contains(&name) {
            Role::Param(name)
        } else if self.scope.names().contains_key(&name) {
            Role::Input(name)
        } else if NAMESPACES.contains(&name.as_str()) && dotted {
            Role::Namespace(name)
        } else if TYPE_NAMES.contains(&name.as_str()) {
            Role::TypeName(name)
        } else {
            Role::Name(name)
        }
    }
}

/// A function called by its full name: the library's, CEL's, or unknown.
fn function(name: String) -> Role {
    if library::function(&name).is_some() {
        Role::Library(name)
    } else if docs::builtin(&name, false).is_some() {
        Role::Builtin(name, false)
    } else {
        Role::Call(name)
    }
}
