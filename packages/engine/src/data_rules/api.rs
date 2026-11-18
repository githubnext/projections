use super::FieldType::*;
use super::{FieldType, Record, field};

const VISIBILITY: FieldType = Enum(&["public", "protected"]);

const CONSTITUENT: Record = Record {
    name: "constituent",
    fields: &[field("text", String, true), field("primitive", String, false)],
};

const TYPE_REF: Record = Record {
    name: "typeRef",
    fields: &[field("text", String, true), field("union", Array(&Record(&CONSTITUENT)), false)],
};

const TYPE_PARAMETER: Record = Record {
    name: "typeParameter",
    fields: &[
        field("name", String, true),
        field("constraints", Strings, true),
        field("default", String, false),
        field("type", String, false),
    ],
};

const ACCESS: Record = Record {
    name: "access",
    fields: &[
        field("read", VISIBILITY, false),
        field("write", VISIBILITY, false),
        field("init", VISIBILITY, false),
    ],
};

const PARAMETER: Record = Record {
    name: "parameter",
    fields: &[
        field("name", String, true),
        field("type", Record(&TYPE_REF), true),
        field("optional", Boolean, true),
        field("variadic", Boolean, true),
        field("default", String, false),
        field("passing", Enum(&["value", "ref", "out", "in", "ref readonly"]), true),
        field("attributes", Strings, false),
    ],
};

const SIGNATURE: Record = Record {
    name: "signature",
    fields: &[
        field("parameters", Array(&Record(&PARAMETER)), true),
        field("returns", Record(&TYPE_REF), true),
        field("returnAttributes", Strings, false),
        field("typeParameters", Array(&Record(&TYPE_PARAMETER)), false),
    ],
};

const SUPERTYPE: Record = Record {
    name: "supertype",
    fields: &[
        field("relation", Enum(&["extends", "implements"]), true),
        field("type", String, true),
    ],
};

/// The kinds of declaration (`apiDeclarations`).
pub const DECLARATIONS: &[&str] = &[
    "package",
    "module",
    "class",
    "struct",
    "union",
    "enum",
    "interface",
    "alias",
    "type",
    "function",
    "method",
    "constructor",
    "property",
    "field",
    "variant",
    "constant",
    "variable",
    "event",
    "index",
    "call",
    "construct",
    "associated-type",
    "implementation",
    "re-export",
    "macro",
];

pub const CONTRACT: Record = Record {
    name: "contract",
    fields: &[
        field("declaration", Enum(DECLARATIONS), true),
        field("term", Text, true),
        field("visibility", VISIBILITY, true),
        field("static", Boolean, false),
        field("abstract", Boolean, false),
        field("sealed", Boolean, false),
        field("readonly", Boolean, false),
        field("required", Boolean, false),
        field("optional", Boolean, false),
        field("nonExhaustive", Boolean, false),
        field("hiddenMembers", Boolean, false),
        field("type", Record(&TYPE_REF), false),
        field("value", String, false),
        field("underlying", String, false),
        field("source", String, false),
        field("access", Record(&ACCESS), false),
        field("attributes", Strings, false),
        field("signatures", Array(&Record(&SIGNATURE)), false),
        field("typeParameters", Array(&Record(&TYPE_PARAMETER)), false),
        field("supertypes", Array(&Record(&SUPERTYPE)), false),
        field("constraints", Strings, false),
        field("native", Object, false),
    ],
};
