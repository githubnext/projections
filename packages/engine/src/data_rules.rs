//! The typed `data` fields of the domain schemas. The table is the engine's
//! copy of the rules in `packages/schemas/src/domains.ts`, which also generates the
//! published JSON Schemas and the TypeScript types renderers receive; a test
//! requires it to equal `packages/schemas/fixtures/data-rules.json`.

use crate::model::{Datum, Fields, ItemRef};
use crate::{Failure, fail, pointer};

/// The value a field must hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldType {
    /// A string that isn't empty or only whitespace.
    Text,
    String,
    /// A finite number.
    Number,
    /// A finite number, zero or more.
    Nonnegative,
    Boolean,
    /// A string, or null when unknown.
    NullableString,
    /// An array of strings.
    Strings,
    Object,
    /// One of the listed strings.
    Enum(&'static [&'static str]),
    /// An array whose every item has the type.
    Array(&'static FieldType),
    /// An object with typed fields, and no others.
    Record(&'static Record),
}

/// A named object type: its fields, and no others.
#[derive(Debug, PartialEq, Eq)]
pub struct Record {
    pub name: &'static str,
    pub fields: &'static [Field],
}

impl FieldType {
    /// The name `packages/schemas/src/domains.ts` uses.
    pub fn name(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::String => "string",
            Self::Number => "number",
            Self::Nonnegative => "nonnegative",
            Self::Boolean => "boolean",
            Self::NullableString => "nullable-string",
            Self::Strings => "strings",
            Self::Object => "object",
            Self::Enum(_) => "enum",
            Self::Array(_) => "array",
            Self::Record(_) => "record",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Field {
    pub name: &'static str,
    pub field_type: FieldType,
    pub required: bool,
}

/// Fields of the `data` of the items of one collection, in one schema, of the
/// listed kinds or (without a list) every kind.
#[derive(Debug)]
pub struct DataRule {
    pub schema: &'static str,
    /// The vocabulary the rule belongs to: it applies only to extractions
    /// that declare it.
    pub vocabulary: Option<&'static str>,
    pub collection: &'static str,
    pub kinds: Option<&'static [&'static str]>,
    pub fields: &'static [Field],
}

const fn field(name: &'static str, field_type: FieldType, required: bool) -> Field {
    Field {
        name,
        field_type,
        required,
    }
}

use FieldType::*;

/// The vocabularies an extraction may declare, and the schemas each applies to.
pub const VOCABULARIES: &[(&str, &[&str])] = &[
    ("dependency-injection/v0", &["architecture/v0"]),
    ("infrastructure/v0", &["architecture/v0"]),
    ("runtime-policy/v0", &["architecture/v0"]),
    ("agentic-workflows/v0", &["architecture/v0"]),
    ("scenarios/v0", &["graph/v0"]),
];

pub const DATA_RULES: &[DataRule] = &[
    DataRule {
        schema: "treemap/v0",
        vocabulary: None,
        collection: "entities",
        kinds: None,
        fields: &[field("value", Nonnegative, false)],
    },
    DataRule {
        schema: "metrics/v0",
        vocabulary: None,
        collection: "entities",
        kinds: None,
        fields: &[field("value", Number, true), field("unit", String, false)],
    },
    DataRule {
        schema: "api/v0",
        vocabulary: None,
        collection: "entities",
        kinds: Some(&[
            "export",
            "type",
            "member",
            "function",
            "class",
            "interface",
            "method",
            "property",
            "enum",
        ]),
        fields: &[field("signature", String, true)],
    },
    DataRule {
        schema: "api/v0",
        vocabulary: None,
        collection: "entities",
        kinds: None,
        fields: &[field("contract", Record(&api::CONTRACT), false)],
    },
    DataRule {
        schema: "database/v0",
        vocabulary: None,
        collection: "entities",
        kinds: Some(&["column"]),
        fields: &[
            field("type", Text, true),
            field("databaseType", NullableString, false),
            field("nullable", Boolean, false),
            field("primaryKey", Boolean, false),
        ],
    },
    DataRule {
        schema: "database/v0",
        vocabulary: None,
        collection: "entities",
        kinds: Some(&["constraint"]),
        fields: &[
            field("type", String, false),
            field("table", String, false),
            field("columns", Strings, false),
        ],
    },
    DataRule {
        schema: "database/v0",
        vocabulary: None,
        collection: "entities",
        kinds: Some(&["primary-key"]),
        fields: &[field("table", String, false), field("columns", Strings, false)],
    },
    DataRule {
        schema: "database/v0",
        vocabulary: None,
        collection: "relationships",
        kinds: Some(&["foreign-key", "relation"]),
        fields: &[field("columns", Strings, false), field("principalColumns", Strings, false)],
    },
    DataRule {
        schema: "architecture/v0",
        vocabulary: Some("dependency-injection/v0"),
        collection: "entities",
        kinds: Some(&["service"]),
        fields: &[
            field("type", String, false),
            field("key", String, false),
            field("name", String, false),
            field("module", String, false),
        ],
    },
    DataRule {
        schema: "architecture/v0",
        vocabulary: Some("dependency-injection/v0"),
        collection: "entities",
        kinds: Some(&["registration"]),
        fields: &[
            field("lifetime", String, false),
            field("scope", String, false),
            field("declaredLifetime", String, false),
            field("ordinal", Number, false),
            field("implementation", String, false),
            field("module", String, false),
        ],
    },
    DataRule {
        schema: "architecture/v0",
        vocabulary: Some("dependency-injection/v0"),
        collection: "entities",
        kinds: Some(&["implementation"]),
        fields: &[field("type", String, false)],
    },
    DataRule {
        schema: "architecture/v0",
        vocabulary: Some("dependency-injection/v0"),
        collection: "relationships",
        kinds: Some(&["dependsOn"]),
        fields: &[
            field("parameter", String, false),
            field("optional", Boolean, false),
            field("collection", Boolean, false),
        ],
    },
    DataRule {
        schema: "architecture/v0",
        vocabulary: Some("infrastructure/v0"),
        collection: "entities",
        kinds: None,
        fields: &[
            field("type", String, false),
            field("provider", String, false),
            field("action", String, false),
            field("replaceOrder", String, false),
        ],
    },
    DataRule {
        schema: "architecture/v0",
        vocabulary: Some("runtime-policy/v0"),
        collection: "entities",
        kinds: Some(&["policy"]),
        fields: &[
            field("namespace", NullableString, false),
            field("mode", String, false),
            field("scope", String, false),
            field("nodes", String, false),
            field("effect", String, false),
        ],
    },
    DataRule {
        schema: "architecture/v0",
        vocabulary: Some("runtime-policy/v0"),
        collection: "entities",
        kinds: Some(&["hook"]),
        fields: &[
            field("hookType", String, false),
            field("stability", String, false),
            field("category", String, false),
        ],
    },
    DataRule {
        schema: "architecture/v0",
        vocabulary: Some("runtime-policy/v0"),
        collection: "entities",
        kinds: Some(&["selector"]),
        fields: &[
            field("effect", String, false),
            field("enforcement", String, false),
            field("ordinal", Number, false),
        ],
    },
    DataRule {
        schema: "architecture/v0",
        vocabulary: Some("runtime-policy/v0"),
        collection: "entities",
        kinds: Some(&["subject"]),
        fields: &[field("subjectKind", String, false)],
    },
    DataRule {
        schema: "architecture/v0",
        vocabulary: Some("runtime-policy/v0"),
        collection: "relationships",
        kinds: Some(&["matches", "excludes"]),
        fields: &[field("operator", String, false), field("parent", Boolean, false)],
    },
    DataRule {
        schema: "architecture/v0",
        vocabulary: Some("agentic-workflows/v0"),
        collection: "entities",
        kinds: Some(&["workflow"]),
        fields: &[
            field("path", Text, true),
            field("name", NullableString, false),
            field("group", String, false),
            field("tools", Strings, false),
            field("secrets", Strings, false),
            field("unrecognized", Strings, false),
            field("strict", Boolean, false),
        ],
    },
    DataRule {
        schema: "architecture/v0",
        vocabulary: Some("agentic-workflows/v0"),
        collection: "entities",
        kinds: Some(&["group"]),
        fields: &[field("workflows", Strings, false)],
    },
    DataRule {
        schema: "graph/v0",
        vocabulary: Some("scenarios/v0"),
        collection: "entities",
        kinds: Some(&["scenarios"]),
        fields: &[
            field("path", Text, true),
            field("renderer", String, false),
            field("scenarios", Strings, false),
        ],
    },
    DataRule {
        schema: "graph/v0",
        vocabulary: Some("scenarios/v0"),
        collection: "entities",
        kinds: Some(&["scenario"]),
        fields: &[
            field("renderer", Text, true),
            field("bundle", String, false),
            field("mode", Enum(&["extraction", "comparison"]), true),
            field("extraction", Object, false),
            field("before", Object, false),
            field("after", Object, false),
            field("comparison", Object, false),
            field("comparator", String, false),
            field("group", String, false),
            field("description", String, false),
            field("presentation", Object, false),
        ],
    },
];

fn text(value: &Datum, path: &str, nonempty: bool) -> Result<(), Failure> {
    match value.as_str() {
        Some(value) if !nonempty || !value.trim().is_empty() => Ok(()),
        _ => Err(fail(
            "invalid-type",
            path,
            if nonempty {
                "Expected a nonempty string"
            } else {
                "Expected a string"
            },
        )),
    }
}

/// Checks a number; every number is finite.
pub(crate) fn number(value: &Datum, path: &str, nonnegative: bool) -> Result<(), Failure> {
    if !value.as_f64().is_some_and(|n| !nonnegative || n >= 0.0) {
        return Err(fail(
            "invalid-domain-value",
            path,
            if nonnegative {
                "Expected a finite nonnegative number"
            } else {
                "Expected a finite number"
            },
        ));
    }
    Ok(())
}

fn array<'a>(value: &'a Datum, path: &str) -> Result<&'a [Datum], Failure> {
    match value {
        Datum::Array(items) => Ok(items),
        _ => Err(fail("invalid-type", path, "Expected an array")),
    }
}

fn check(value: &Datum, field_type: FieldType, path: &str) -> Result<(), Failure> {
    match field_type {
        Text => text(value, path, true),
        String => text(value, path, false),
        Number => number(value, path, false),
        Nonnegative => number(value, path, true),
        Boolean if matches!(value, Datum::Bool(_)) => Ok(()),
        Boolean => Err(fail("invalid-domain-value", path, "Expected a boolean")),
        NullableString if *value == Datum::Null => Ok(()),
        NullableString => text(value, path, false).map_err(|_| fail("invalid-type", path, "Expected a string or null")),
        Strings => {
            for (index, item) in array(value, path)?.iter().enumerate() {
                text(item, &pointer(path, &index.to_string()), false)?;
            }
            Ok(())
        }
        Object if value.as_object().is_some() => Ok(()),
        Object => Err(fail("invalid-type", path, "Expected an object")),
        Enum(values) => match value.as_str() {
            Some(text) if values.contains(&text) => Ok(()),
            _ => Err(fail(
                "invalid-domain-value",
                path,
                &format!(
                    "Expected one of {}",
                    values.iter().map(|value| format!("`{value}`")).collect::<Vec<_>>().join(", ")
                ),
            )),
        },
        Array(items) => {
            for (index, item) in array(value, path)?.iter().enumerate() {
                check(item, *items, &pointer(path, &index.to_string()))?;
            }
            Ok(())
        }
        Record(record) => {
            let object = value.as_object().ok_or_else(|| fail("invalid-type", path, "Expected an object"))?;
            if let Some(key) = object
                .keys()
                .find(|key| !record.fields.iter().any(|field| field.name == key.as_str()))
            {
                return Err(fail(
                    "unknown-field",
                    &pointer(path, key),
                    &format!("`{}` has no field `{key}`", record.name),
                ));
            }
            check_fields(object, record.fields, path)
        }
    }
}

/// Checks the typed fields of an object at `path`: each present field has
/// its type, and every required field is present.
fn check_fields(object: &Fields, fields: &[Field], path: &str) -> Result<(), Failure> {
    for field in fields {
        match object.get(field.name) {
            Some(value) => check(value, field.field_type, &pointer(path, field.name))?,
            // Never a nullable string: the rules make those optional.
            None if field.required => check(&Datum::Null, field.field_type, &pointer(path, field.name))?,
            None => {}
        }
    }
    Ok(())
}

/// Checks one item's `data` against every rule of its schema, declared
/// vocabularies, collection and kind. `path` is the item's path.
pub(crate) fn check_data(schema: &str, vocabularies: &[&str], item: &ItemRef, path: &str) -> Result<(), Failure> {
    let collection = item.collection.name();
    let data_path = pointer(path, "data");
    for rule in DATA_RULES.iter().filter(|rule| {
        rule.schema == schema
            && rule.vocabulary.is_none_or(|vocabulary| vocabularies.contains(&vocabulary))
            && rule.collection == collection
            && rule.kinds.is_none_or(|kinds| kinds.contains(&item.kind))
    }) {
        check_fields(item.data, rule.fields, &data_path)?;
    }
    Ok(())
}

/// The typed `data.contract` of `api/v0` declarations: the language-neutral
/// facts compatibility rules read (see `apiContract` in `packages/schemas/src/api-contract.ts`).
mod api;
