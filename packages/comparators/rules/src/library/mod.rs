//! The standard library: typed functions every rules file can call, each
//! generic (no domain knowledge) and registered with its signature, a cost
//! note and documentation. `docs/design/declarative-comparators.md` justifies
//! each one; [`LIBRARY`] is the reference.

mod generated;
mod graph;
mod json;
mod lists;
mod prose;

use self::generated::generated_because;
pub use self::generated::generated_only;
pub use self::graph::Graph;
use self::graph::{components, depths};
use self::json::json;
use self::lists::{enumerate, from_entries, ids_key, ids_sort, keys, zip, zip_longest};
use self::prose::{classify, code, escape};
use crate::types::{Ty, list as list_of, map as map_of};
use cel::Value as Cel;
use std::sync::Arc;

pub type Operator = fn(&[Cel]) -> Result<Cel, String>;

/// One library function: its CEL name, parameter and result types, what it
/// costs and what it does.
pub struct Function {
    pub name: &'static str,
    pub params: fn() -> Vec<Ty>,
    pub returns: fn() -> Ty,
    pub cost: &'static str,
    pub doc: &'static str,
    /// Pure functions; `graph.parents` and `graph.children` are registered per
    /// comparison, over its index.
    pub run: Option<Operator>,
}

fn strings_ty() -> Ty {
    list_of(Ty::String)
}

pub const LIBRARY: &[Function] = &[
    Function {
        name: "json",
        params: || vec![Ty::Dyn],
        returns: || Ty::String,
        cost: "Linear in the value's size",
        doc: "The value as JSON text, as JavaScript's `JSON.stringify` writes it for canonical input: ECMAScript numbers, keys in UTF-16 order (array-index keys first).",
        run: Some(json),
    },
    Function {
        name: "ids.sort",
        params: || vec![strings_ty()],
        returns: strings_ty,
        cost: "n log n in the list's length",
        doc: "IDs in UTF-16 code-unit order, the order the protocol sorts IDs in (CEL's `sort()` uses code points).",
        run: Some(ids_sort),
    },
    Function {
        name: "ids.key",
        params: || vec![Ty::String],
        returns: || Ty::String,
        cost: "Linear in the string's length",
        doc: "A sort key whose order is the ID's UTF-16 order, for `sortBy`.",
        run: Some(ids_key),
    },
    Function {
        name: "lists.zip",
        params: || vec![list_of(Ty::Dyn), list_of(Ty::Dyn)],
        returns: || list_of(list_of(Ty::Dyn)),
        cost: "Linear in the shorter list",
        doc: "`lists.zip(a, b)`: `[a[i], b[i]]` pairs, as long as the shorter list.",
        run: Some(zip),
    },
    Function {
        name: "lists.zipLongest",
        params: || vec![list_of(Ty::Dyn), list_of(Ty::Dyn)],
        returns: || list_of(list_of(Ty::Dyn)),
        cost: "Linear in the longer list",
        doc: "`lists.zipLongest(a, b)`: `[a[i], b[i]]` pairs, as long as the longer list, with null where a list ends.",
        run: Some(zip_longest),
    },
    Function {
        name: "lists.enumerate",
        params: || vec![list_of(Ty::Dyn)],
        returns: || list_of(list_of(Ty::Dyn)),
        cost: "Linear in the list",
        doc: "`lists.enumerate(items)`: `[index, item]` pairs, in order.",
        run: Some(enumerate),
    },
    Function {
        name: "maps.fromEntries",
        params: || vec![list_of(list_of(Ty::Dyn))],
        returns: || map_of(Ty::String, Ty::Dyn),
        cost: "Linear in the number of entries",
        doc: "A map from `[key, value]` pairs with string keys; a later pair replaces an earlier one with the same key.",
        run: Some(from_entries),
    },
    Function {
        name: "maps.keys",
        params: || vec![map_of(Ty::String, Ty::Dyn)],
        returns: strings_ty,
        cost: "n log n in the map's size",
        doc: "A map's keys in UTF-16 order. Iterating a map directly follows hash order, which differs between runs.",
        run: Some(keys),
    },
    Function {
        name: "graph.parents",
        params: || vec![Ty::String, Ty::String, Ty::String],
        returns: strings_ty,
        cost: "Linear in the result",
        doc: "`graph.parents(side, id, kind)`: the sources of the `kind` relationships into entity `id` on `side` (`before` or `after`), in extraction order.",
        run: None,
    },
    Function {
        name: "graph.children",
        params: || vec![Ty::String, Ty::String, Ty::String],
        returns: strings_ty,
        cost: "Linear in the result",
        doc: "`graph.children(side, id, kind)`: the targets of the `kind` relationships out of entity `id` on `side`, in extraction order.",
        run: None,
    },
    Function {
        name: "graph.entity",
        params: || vec![Ty::String, Ty::String],
        returns: || Ty::Object("Entity"),
        cost: "Constant, plus the entity's size",
        doc: "`graph.entity(side, id)`: entity `id` on `side` (`before` or `after`), or null.",
        run: None,
    },
    Function {
        name: "graph.relationship",
        params: || vec![Ty::String, Ty::String],
        returns: || Ty::Object("Relationship"),
        cost: "Constant, plus the relationship's size",
        doc: "`graph.relationship(side, id)`: relationship `id` on `side`, or null.",
        run: None,
    },
    Function {
        name: "graph.depths",
        params: || vec![strings_ty(), list_of(strings_ty())],
        returns: || map_of(Ty::String, Ty::Int),
        cost: "Linear in nodes and edges",
        doc: "`graph.depths(nodes, edges)`: every node's longest-path depth from the roots; edges are `[from, to]`. Self-loops, duplicates and edges to unknown nodes are ignored; nodes on a cycle keep the depth they reached.",
        run: Some(depths),
    },
    Function {
        name: "graph.components",
        params: || vec![strings_ty(), list_of(strings_ty())],
        returns: || list_of(strings_ty()),
        cost: "Near-linear in nodes and edges",
        doc: "`graph.components(nodes, edges)`: the connected components among `nodes`, ordered by their first member, members in `nodes` order.",
        run: Some(components),
    },
    Function {
        name: "findings.classify",
        params: || vec![list_of(Ty::Object("Finding")), strings_ty()],
        returns: || Ty::Object("Classification"),
        cost: "Linear in the findings",
        doc: "`findings.classify(findings, levels)`: the most severe level among `findings` (`{level, rule, reason, kinds?}`), by its position in `levels` (least severe first), with that level's distinct reasons joined by `; ` and kinds in order. Consecutive duplicate findings count once. Needs at least one finding.",
        run: Some(classify),
    },
    Function {
        name: "generated.because",
        params: || vec![Ty::Object("Change")],
        returns: strings_ty,
        cost: "Linear in the change's varied values",
        doc: "`generated.because(change)`: the basis parts that moved across all of a change's generated values, unique and in UTF-16 order; `[]` when none moved.",
        run: Some(generated_because),
    },
    Function {
        name: "generated.only",
        params: || vec![Ty::Object("Change"), strings_ty()],
        returns: || Ty::Bool,
        cost: "Linear in the change's varied values",
        doc: "`generated.only(change, parts)`: whether a one-to-one change differs only in generated values whose bases moved only in `parts`, so it would be unchanged if those parts didn't count. False for a change whose content differs anywhere else, or with no such value.",
        run: None,
    },
    Function {
        name: "prose.code",
        params: || vec![Ty::String],
        returns: || Ty::String,
        cost: "Linear in the string's length",
        doc: "Text as an inline code span of protocol prose: backtick-delimited, backticks and backslashes escaped.",
        run: Some(code),
    },
    Function {
        name: "prose.escape",
        params: || vec![Ty::String],
        returns: || Ty::String,
        cost: "Linear in the string's length",
        doc: "Plain text as protocol prose: backticks and backslashes escaped.",
        run: Some(escape),
    },
];

pub fn function(name: &str) -> Option<&'static Function> {
    LIBRARY.iter().find(|function| function.name == name)
}

fn arity(args: &[Cel], count: usize) -> Result<(), String> {
    if args.len() == count {
        Ok(())
    } else {
        Err(format!("expected {count} arguments, got {}", args.len()))
    }
}

fn strings(value: &Cel, what: &str) -> Result<Vec<Arc<String>>, String> {
    let Cel::List(items) = value else {
        return Err(format!("{what} must be a list of strings"));
    };
    items
        .iter()
        .map(|item| match item {
            Cel::String(text) => Ok(text.clone()),
            _ => Err(format!("{what} must be a list of strings")),
        })
        .collect()
}

fn side(value: &Cel) -> Result<usize, String> {
    match value {
        Cel::String(text) if text.as_str() == "before" => Ok(0),
        Cel::String(text) if text.as_str() == "after" => Ok(1),
        other => Err(format!("side must be `before` or `after`, not {other:?}")),
    }
}

fn string_list(value: &Cel, what: &str) -> Result<Vec<String>, String> {
    Ok(strings(value, what)?.into_iter().map(|text| text.as_ref().clone()).collect())
}
