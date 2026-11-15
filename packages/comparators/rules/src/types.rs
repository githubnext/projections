//! The types rules expressions are checked against: CEL's own, and declared
//! object types for the protocol values rules read (extractions, items,
//! changes, steps, the lookup index) and the standard library's (findings).

use std::collections::BTreeMap;
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Ty {
    /// Unknown until run: everything is allowed.
    Dyn,
    /// The element type of an empty list: joins to anything.
    Never,
    Null,
    Bool,
    Int,
    UInt,
    Double,
    String,
    Bytes,
    /// A type value, such as `int` in `type(x) == int`.
    Type,
    List(Box<Ty>),
    Map(Box<Ty>, Box<Ty>),
    /// A declared object type.
    Object(&'static str),
    /// A map literal whose keys are all string literals.
    Record(BTreeMap<String, Ty>),
    Optional(Box<Ty>),
}

pub fn list(item: Ty) -> Ty {
    Ty::List(Box::new(item))
}

pub fn map(key: Ty, value: Ty) -> Ty {
    Ty::Map(Box::new(key), Box::new(value))
}

fn object(name: &'static str) -> Ty {
    Ty::Object(name)
}

/// The fields of a declared object type, or `None` for an unknown name.
pub fn fields(name: &str) -> Option<Vec<(&'static str, Ty)>> {
    let data = || map(Ty::String, Ty::Dyn);
    let ids = || list(Ty::String);
    let item = |relationship: bool| {
        let mut fields = vec![
            ("id", Ty::String),
            ("kind", Ty::String),
            ("label", Ty::String),
            ("data", data()),
            ("previousIds", ids()),
            ("evidence", list(Ty::Dyn)),
            ("confidence", Ty::String),
        ];
        if relationship {
            fields.extend([("from", Ty::String), ("to", Ty::String)]);
        }
        fields
    };
    Some(match name {
        "Extraction" => vec![
            ("protocolVersion", Ty::Int),
            ("schema", Ty::String),
            ("metadata", data()),
            ("entities", list(object("Entity"))),
            ("relationships", list(object("Relationship"))),
        ],
        "Entity" => item(false),
        "Relationship" | "Item" => item(true),
        "Change" => vec![
            ("id", Ty::String),
            ("collection", Ty::String),
            ("before", ids()),
            ("after", ids()),
            ("status", Ty::String),
            ("correspondence", Ty::String),
            ("varied", list(object("Varied"))),
            ("summary", Ty::String),
        ],
        "Varied" => vec![
            ("path", Ty::String),
            ("within", Ty::Bool),
            ("reason", Ty::String),
            ("generated", Ty::Bool),
            ("because", ids()),
        ],
        "Step" => vec![("changes", ids()), ("kind", Ty::String), ("summary", Ty::String)],
        "Comparison" => vec![
            ("protocolVersion", Ty::Int),
            ("changes", list(object("Change"))),
            ("steps", list(object("Step"))),
            ("order", data()),
            ("metadata", data()),
        ],
        "Side" => vec![
            ("entities", map(Ty::String, object("Entity"))),
            ("relationships", map(Ty::String, object("Relationship"))),
            ("incoming", map(Ty::String, list(object("Relationship")))),
            ("outgoing", map(Ty::String, list(object("Relationship")))),
        ],
        "Lookup" => vec![("before", object("Side")), ("after", object("Side"))],
        "Finding" => vec![
            ("level", Ty::String),
            ("rule", Ty::String),
            ("reason", Ty::String),
            ("kinds", ids()),
        ],
        "Classification" => vec![
            ("level", Ty::String),
            ("reason", Ty::String),
            ("kinds", ids()),
            ("findings", list(object("Finding"))),
        ],
        _ => return None,
    })
}

pub fn field(name: &str, field: &str) -> Option<Ty> {
    fields(name)?
        .into_iter()
        .find(|(candidate, _)| *candidate == field)
        .map(|(_, ty)| ty)
}

/// Object types an author can name in a function signature.
pub const OBJECTS: [&str; 13] = [
    "Extraction",
    "Entity",
    "Relationship",
    "Item",
    "Change",
    "Varied",
    "Step",
    "Comparison",
    "Side",
    "Lookup",
    "Finding",
    "Classification",
    "Pairs",
];

/// The type an author writes in a function signature: `string`, `int`,
/// `double`, `bool`, `dyn`, `list<T>`, `map<K, V>`, `optional<T>` or a
/// declared object type.
pub fn parse(text: &str) -> Result<Ty, String> {
    let text = text.trim();
    let inner = |prefix: &str| text.strip_prefix(prefix).and_then(|rest| rest.strip_suffix('>')).map(str::trim);
    if let Some(item) = inner("list<") {
        return Ok(list(parse(item)?));
    }
    if let Some(item) = inner("optional<") {
        return Ok(Ty::Optional(Box::new(parse(item)?)));
    }
    if let Some(pair) = inner("map<") {
        // The key type is a scalar, so the first comma separates them.
        let (key, value) = pair.split_once(',').ok_or_else(|| format!("Expected map<K, V>, not `{text}`"))?;
        return Ok(map(parse(key)?, parse(value)?));
    }
    Ok(match text {
        "dyn" => Ty::Dyn,
        "null" => Ty::Null,
        "bool" => Ty::Bool,
        "int" => Ty::Int,
        "uint" => Ty::UInt,
        "double" => Ty::Double,
        "string" => Ty::String,
        "bytes" => Ty::Bytes,
        "Pairs" => pairs(),
        name => match OBJECTS.iter().find(|object| **object == name) {
            Some(name) => Ty::Object(name),
            None => return Err(format!("Unknown type `{text}`")),
        },
    })
}

/// Per identity pass, its pairs: before ID to after ID.
pub fn pairs() -> Ty {
    map(Ty::String, map(Ty::String, Ty::String))
}

/// Per collection and side, each item's change ID.
pub fn change_of() -> Ty {
    map(Ty::String, map(Ty::String, map(Ty::String, Ty::String)))
}

/// The least type both are: types that disagree become `dyn`. A `null`
/// joins to the other type, because every value may be absent.
pub fn join(a: &Ty, b: &Ty) -> Ty {
    match (a, b) {
        (a, b) if a == b => a.clone(),
        (Ty::Never, other) | (other, Ty::Never) => other.clone(),
        (Ty::Null, other) | (other, Ty::Null) => other.clone(),
        (Ty::List(a), Ty::List(b)) => list(join(a, b)),
        (Ty::Map(k1, v1), Ty::Map(k2, v2)) => map(join(k1, k2), join(v1, v2)),
        (Ty::Optional(a), Ty::Optional(b)) => Ty::Optional(Box::new(join(a, b))),
        (Ty::Record(a), Ty::Record(b)) if a.keys().eq(b.keys()) => {
            Ty::Record(a.iter().map(|(key, ty)| (key.clone(), join(ty, &b[key]))).collect())
        }
        (Ty::Record(a), Ty::Record(b)) => map(Ty::String, a.values().chain(b.values()).fold(Ty::Never, |acc, ty| join(&acc, ty))),
        (Ty::Record(fields), Ty::Map(key, value)) | (Ty::Map(key, value), Ty::Record(fields)) => map(
            join(key, &Ty::String),
            fields.values().fold((**value).clone(), |acc, ty| join(&acc, ty)),
        ),
        (Ty::Object("Relationship"), Ty::Object("Entity"))
        | (Ty::Object("Entity"), Ty::Object("Relationship"))
        | (Ty::Object("Item"), Ty::Object("Entity" | "Relationship"))
        | (Ty::Object("Entity" | "Relationship"), Ty::Object("Item")) => Ty::Object("Item"),
        _ => Ty::Dyn,
    }
}

/// Whether a value of type `actual` may be passed where `expected` is
/// declared. Unknown types are always allowed; this only rejects what is
/// certainly wrong.
pub fn assignable(actual: &Ty, expected: &Ty) -> bool {
    match (actual, expected) {
        (Ty::Dyn | Ty::Never | Ty::Null, _) | (_, Ty::Dyn) => true,
        (a, b) if a == b => true,
        (Ty::List(a), Ty::List(b)) => assignable(a, b),
        (Ty::Map(k1, v1), Ty::Map(k2, v2)) => assignable(k1, k2) && assignable(v1, v2),
        (Ty::Optional(a), Ty::Optional(b)) => assignable(a, b),
        (Ty::Record(record), Ty::Map(key, value)) => assignable(&Ty::String, key) && record.values().all(|ty| assignable(ty, value)),
        (Ty::Record(record), Ty::Object(name)) => record
            .iter()
            .all(|(key, ty)| field(name, key).is_some_and(|expected| assignable(ty, &expected))),
        (Ty::Object(_), Ty::Map(key, value)) => assignable(&Ty::String, key) && **value == Ty::Dyn,
        (Ty::Object("Entity" | "Relationship"), Ty::Object("Item")) => true,
        (Ty::Object("Item"), Ty::Object("Entity" | "Relationship")) => true,
        _ => false,
    }
}

impl fmt::Display for Ty {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Ty::Dyn => write!(f, "dyn"),
            Ty::Never => write!(f, "dyn"),
            Ty::Null => write!(f, "null"),
            Ty::Bool => write!(f, "bool"),
            Ty::Int => write!(f, "int"),
            Ty::UInt => write!(f, "uint"),
            Ty::Double => write!(f, "double"),
            Ty::String => write!(f, "string"),
            Ty::Bytes => write!(f, "bytes"),
            Ty::Type => write!(f, "type"),
            Ty::List(item) => write!(f, "list<{item}>"),
            Ty::Map(key, value) => write!(f, "map<{key}, {value}>"),
            Ty::Object(name) => write!(f, "{name}"),
            Ty::Record(fields) => write!(
                f,
                "{{{}}}",
                fields.iter().map(|(key, ty)| format!("{key}: {ty}")).collect::<Vec<_>>().join(", ")
            ),
            Ty::Optional(item) => write!(f, "optional<{item}>"),
        }
    }
}
