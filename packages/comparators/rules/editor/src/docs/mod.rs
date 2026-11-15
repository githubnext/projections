//! What an editor shows about names it doesn't learn from the rules file: the
//! macros, CEL's own functions, the standard library's parameter names and
//! the inputs. Editor-only: none of it is in the language manifest, so it
//! doesn't change the interpreter's identity.

mod builtins;
mod inputs;
mod macros;

pub use self::builtins::BUILTINS;
pub use self::inputs::{INPUTS, PARAMS};
pub use self::macros::{CEL_MACROS, MACROS};
use projections_comparator_rules::library::{self, Function};

/// How a CEL function is called.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Form {
    /// `name(args)`, or `namespace.name(args)`.
    Global,
    /// `receiver.name(args)`, on a value of this kind (`string`, `list`, `map`,
    /// `optional` or `any`).
    Member(&'static str),
    /// Either.
    Both(&'static str),
}

/// A function or macro an editor documents.
pub struct Doc {
    pub name: &'static str,
    pub form: Form,
    pub signature: &'static str,
    /// The result's type, as a rules type (`dyn` when it depends on the arguments).
    pub returns: &'static str,
    pub doc: &'static str,
    /// Whether it binds a variable in its arguments (`list.all(x, p)`).
    pub binds: bool,
}

const fn doc(name: &'static str, form: Form, signature: &'static str, returns: &'static str, doc: &'static str) -> Doc {
    Doc {
        name,
        form,
        signature,
        returns,
        doc,
        binds: false,
    }
}

const fn binding(name: &'static str, form: Form, signature: &'static str, returns: &'static str, doc: &'static str) -> Doc {
    Doc {
        name,
        form,
        signature,
        returns,
        doc,
        binds: true,
    }
}

/// The macro or CEL function documented as `name`, called globally or as a
/// member.
pub fn builtin(name: &str, member: bool) -> Option<&'static Doc> {
    MACROS.iter().chain(CEL_MACROS).chain(BUILTINS).find(|doc| {
        doc.name == name
            && match doc.form {
                Form::Global => !member,
                Form::Member(_) => member,
                Form::Both(_) => true,
            }
    })
}

/// A library function's signature, with its parameter names.
pub fn signature(function: &Function) -> String {
    let names = PARAMS
        .iter()
        .find(|(name, _)| *name == function.name)
        .map_or(&[][..], |(_, names)| *names);
    let params: Vec<String> = (function.params)()
        .iter()
        .enumerate()
        .map(|(index, ty)| match names.get(index) {
            Some(name) => format!("{name}: {ty}"),
            None => ty.to_string(),
        })
        .collect();
    format!("{}({}) -> {}", function.name, params.join(", "), (function.returns)())
}

/// A library function's documentation, as Markdown.
pub fn library_markdown(function: &Function) -> String {
    format!(
        "```\n{}\n```\n\n{}\n\nCost: {}.",
        signature(function),
        function.doc,
        function.cost.to_lowercase()
    )
}

/// A macro's or CEL function's documentation, as Markdown.
pub fn markdown(doc: &Doc) -> String {
    format!("```\n{}\n```\n\n{}", doc.signature, doc.doc)
}

/// The library functions in a namespace (`graph`), or the global ones.
pub fn library_in(namespace: Option<&str>) -> impl Iterator<Item = &'static Function> + '_ {
    library::LIBRARY
        .iter()
        .filter(move |function| match (function.name.split_once('.'), namespace) {
            (Some((space, _)), Some(namespace)) => space == namespace,
            (None, None) => true,
            _ => false,
        })
}
