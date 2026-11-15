use super::lex::Kind;
use super::names::Classifier;
use crate::docs::CEL_MACROS;
use crate::{Analysis, Cel};
use std::collections::HashSet;

/// What a token is.
#[derive(Debug, Clone, PartialEq)]
pub enum Role {
    /// A standard library function, by its qualified name.
    Library(String),
    /// A CEL function: its name and whether it is called as a member.
    Builtin(String, bool),
    /// A rules macro: `match`, `cond`, `collect`, `template`.
    Macro(String),
    /// A CEL macro: `has`, `all`, `map`, …
    CelMacro(String),
    /// One of the file's functions.
    Author(String),
    /// An unknown function or method.
    Call(String),
    Method(String),
    /// `graph`, `ids`, … before a library function.
    Namespace(String),
    /// `variables` before a variable's name.
    VariablesRoot,
    /// `variables.<name>`.
    Variable(String),
    /// `options.<name>`.
    OptionKey(String),
    /// `.<name>` on a value.
    Field(String),
    /// An input or a section's name (`before`, `item`, `change`, …).
    Input(String),
    /// A function parameter.
    Param(String),
    /// A comprehension variable, and whether this is where it is declared.
    Local(String, bool),
    TypeName(String),
    Name(String),
    Keyword,
    Number,
    Str,
    Operator,
    Comment,
    Error,
}

pub(super) const TYPE_NAMES: [&str; 11] = [
    "int",
    "uint",
    "double",
    "string",
    "bool",
    "bytes",
    "list",
    "map",
    "null_type",
    "type",
    "dyn",
];

/// Whether `name` is a CEL macro that binds a variable.
pub fn binds_variable(name: &str) -> bool {
    CEL_MACROS.iter().any(|doc| doc.binds && doc.name == name)
}

/// What a CEL value's tokens are, by index.
pub struct Classified {
    pub roles: Vec<Role>,
    /// Template placeholders: (lexeme, start, end, name), character offsets.
    pub placeholders: Vec<(usize, usize, usize, String)>,
}

/// The comprehension variables an expression declares, and where.
pub fn locals(cel: &Cel) -> (HashSet<String>, HashSet<usize>) {
    let lx = &cel.lexemes;
    let mut names = HashSet::new();
    let mut declarations = HashSet::new();
    for i in 1..lx.len() {
        let at = |offset: usize| lx.get(i + offset).map(|lexeme| lexeme.kind);
        if lx[i].kind == Kind::Ident
            && lx[i - 1].kind == Kind::Dot
            && binds_variable(&cel.text(lx[i].start, lx[i].end))
            && at(1) == Some(Kind::LeftParen)
            && at(2) == Some(Kind::Ident)
            && at(3) == Some(Kind::Comma)
        {
            names.insert(cel.text(lx[i + 2].start, lx[i + 2].end));
            declarations.insert(i + 2);
        }
    }
    (names, declarations)
}

/// What a CEL value's tokens are: each token's role, and a `template`
/// string's placeholders.
pub fn classify(analysis: &Analysis, cel: &Cel) -> Classified {
    let (locals, declarations) = locals(cel);
    let classifier = Classifier {
        cel,
        scope: analysis.scope(&cel.path),
        params: analysis.params(&cel.path).into_iter().map(|(name, _)| name).collect(),
        authors: analysis.functions().into_iter().collect(),
        locals,
        declarations,
    };
    let lx = &cel.lexemes;
    let mut roles = Vec::with_capacity(lx.len());
    let mut placeholders = Vec::new();
    for (i, lexeme) in lx.iter().enumerate() {
        let role = match lexeme.kind {
            Kind::Keyword => Role::Keyword,
            Kind::Number => Role::Number,
            Kind::Comment => Role::Comment,
            Kind::Error => Role::Error,
            Kind::Str => {
                if classifier.is_template(i) {
                    for (start, end, name) in fields(&cel.chars[lexeme.start..lexeme.end]) {
                        placeholders.push((i, lexeme.start + start, lexeme.start + end, name));
                    }
                }
                Role::Str
            }
            Kind::Ident => classifier.ident(i),
            _ => Role::Operator,
        };
        roles.push(role);
    }
    // A library namespace is named by the call it qualifies.
    for i in 0..lx.len() {
        if classifier.kind(i + 1) == Some(Kind::Dot)
            && matches!(roles.get(i + 2), Some(Role::Library(_) | Role::Builtin(_, false) | Role::Call(_)))
            && matches!(roles[i], Role::Name(_) | Role::TypeName(_))
        {
            roles[i] = Role::Namespace(classifier.text(i));
        }
    }
    Classified { roles, placeholders }
}

/// A template string's `{name}` fields: (start, end, name), offsets of the
/// braces in the string token; `{{` and `}}` are literal braces.
pub(super) fn fields(chars: &[char]) -> Vec<(usize, usize, String)> {
    let mut found = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '{' && chars.get(i + 1) == Some(&'{') {
            i += 2;
            continue;
        }
        if chars[i] == '{' {
            let name: String = chars[i + 1..]
                .iter()
                .take_while(|c| c.is_ascii_alphanumeric() || **c == '_')
                .collect();
            let end = i + 1 + name.chars().count();
            if !name.is_empty() && chars.get(end) == Some(&'}') {
                found.push((i, end + 1, name));
                i = end + 1;
                continue;
            }
        }
        i += 1;
    }
    found
}
