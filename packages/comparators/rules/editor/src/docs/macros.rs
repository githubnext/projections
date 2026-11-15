use super::{Doc, Form, binding, doc};

/// The rules macros (`macros::MACROS`).
pub const MACROS: &[Doc] = &[
    doc(
        "match",
        Form::Global,
        "match(subject, {'key': value, …}, default)",
        "dyn",
        "A table keyed by one value: the value of the key `subject` equals, else `default`. Keys are string or int literals, each once. Expands to `subject == 'key' ? value : … : default`; a `match` on a name with declared `values:` is checked against them.",
    ),
    doc(
        "cond",
        Form::Global,
        "cond({condition: value, …}, default)",
        "dyn",
        "Ordered conditions: the value of the first condition that holds, else `default`. Expands to `condition ? value : … : default`.",
    ),
    doc(
        "collect",
        Form::Global,
        "collect({condition: value, …})",
        "list<dyn>",
        "The values whose conditions hold, in order. Expands to `(condition ? [value] : []) + …`.",
    ),
    doc(
        "template",
        Form::Global,
        "template('… {name} …', {'name': value, …})",
        "string",
        "Named fields in a format string. Without the map, `{name}` is the function parameter `name`, or else `variables.name`. `{{` and `}}` are literal braces. Expands to `'… %s …'.format([value, …])`.",
    ),
];

/// CEL's macros.
pub const CEL_MACROS: &[Doc] = &[
    doc(
        "has",
        Form::Global,
        "has(value.field) -> bool",
        "bool",
        "Whether a map has the key, or a message the field: `has(item.data.mode)`.",
    ),
    binding(
        "all",
        Form::Member("list"),
        "list.all(x, predicate) -> bool",
        "bool",
        "Whether the predicate holds for every element (every key of a map).",
    ),
    binding(
        "exists",
        Form::Member("list"),
        "list.exists(x, predicate) -> bool",
        "bool",
        "Whether the predicate holds for some element (some key of a map).",
    ),
    binding(
        "exists_one",
        Form::Member("list"),
        "list.exists_one(x, predicate) -> bool",
        "bool",
        "Whether the predicate holds for exactly one element.",
    ),
    binding(
        "existsOne",
        Form::Member("list"),
        "list.existsOne(x, predicate) -> bool",
        "bool",
        "Whether the predicate holds for exactly one element.",
    ),
    binding(
        "map",
        Form::Member("list"),
        "list.map(x, transform) -> list, list.map(x, predicate, transform) -> list",
        "list<dyn>",
        "Each element transformed, optionally only those the predicate selects.",
    ),
    binding(
        "filter",
        Form::Member("list"),
        "list.filter(x, predicate) -> list",
        "list<dyn>",
        "The elements the predicate selects, in order.",
    ),
    binding(
        "sortBy",
        Form::Member("list"),
        "list.sortBy(x, key) -> list",
        "list<dyn>",
        "The elements ordered by a key computed from each; `ids.key(x)` sorts IDs in protocol order.",
    ),
    binding(
        "optMap",
        Form::Member("optional"),
        "optional.optMap(x, transform) -> optional",
        "dyn",
        "The optional's value transformed, or an empty optional.",
    ),
    binding(
        "optFlatMap",
        Form::Member("optional"),
        "optional.optFlatMap(x, transform) -> optional",
        "dyn",
        "The optional the transform returns for the value, or an empty optional.",
    ),
];
