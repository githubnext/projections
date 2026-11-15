//! Structs, unions and enums, with their fields and variants.

use super::builder::{Builder, Declaration};
use super::contract::{api_contract, type_ref};
use super::generics::generics;
use super::rustdoc::{attributes, has_attribute, key, repr};
use super::types::ty;
use anyhow::Result;
use serde_json::{Value, json};

/// `(shape, fields, has private fields)`; a tuple's private fields are `None`.
type Shape = (&'static str, Vec<Option<String>>, bool);

impl Builder<'_> {
    pub(super) fn structure(&mut self, d: &Declaration, kind: &str) -> Result<()> {
        let (id, name, item, value) = (d.id, d.name, d.item, d.value);
        let generics = generics(&value["generics"], self);
        let (shape, fields, private) = struct_kind(value, kind);
        let contract = api_contract(
            kind,
            kind,
            json!({"nonExhaustive": has_attribute(item, "non_exhaustive"), "hiddenMembers": private,
                "typeParameters": generics.type_parameters(),
                "native": {"shape": if kind == "union" { "plain" } else { shape }, "repr": repr(item), "where": generics.clauses}}),
        );
        let body = match shape {
            "tuple" => format!(
                "({})",
                fields
                    .iter()
                    .map(|field| field
                        .as_deref()
                        .and_then(|id| self.item(id))
                        .map(|field| format!("pub {}", ty(&field["inner"]["struct_field"], self)))
                        .unwrap_or_else(|| "_".into()))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            "unit" => String::new(),
            _ => " { .. }".into(),
        };
        let signature = format!(
            "{}pub {kind} {name}{}{body}{}",
            attributes(item),
            generics.params(),
            generics.clauses()
        );
        self.entity(id, kind, name, signature, contract, item);
        self.contains(d.parent, id);
        self.fields(id, &fields)?;
        self.impls(id, name, value)
    }

    pub(super) fn enumeration(&mut self, d: &Declaration) -> Result<()> {
        let (id, name, item, value) = (d.id, d.name, d.item, d.value);
        let generics = generics(&value["generics"], self);
        let contract = api_contract(
            "enum",
            "enum",
            json!({"nonExhaustive": has_attribute(item, "non_exhaustive"),
                "hiddenMembers": value["has_stripped_variants"] == true,
                "typeParameters": generics.type_parameters(),
                "native": {"repr": repr(item), "where": generics.clauses}}),
        );
        let signature = format!("{}pub enum {name}{}{}", attributes(item), generics.params(), generics.clauses());
        self.entity(id, "enum", name, signature, contract, item);
        self.contains(d.parent, id);
        for variant in value["variants"].as_array().into_iter().flatten() {
            let variant_id = key(variant)?;
            if let Some(variant) = self.item(&variant_id) {
                self.variant(id, variant)?;
            }
        }
        self.impls(id, name, value)
    }

    fn fields(&mut self, parent: &str, fields: &[Option<String>]) -> Result<()> {
        for field in fields.iter().flatten() {
            let Some(item) = self.item(field) else {
                continue;
            };
            let name = item["name"].as_str().unwrap_or_default();
            let field_type = ty(&item["inner"]["struct_field"], self);
            let id = format!("{parent}.{name}");
            let numbered = name.chars().all(|character| character.is_ascii_digit());
            self.entity(
                &id,
                "field",
                name,
                if numbered {
                    format!("{name}: {field_type}")
                } else {
                    format!("pub {name}: {field_type}")
                },
                api_contract("field", "field", json!({"type": type_ref(&field_type)})),
                item,
            );
            self.contains(parent, &id);
        }
        Ok(())
    }

    fn variant(&mut self, parent: &str, item: &Value) -> Result<()> {
        let name = item["name"].as_str().unwrap_or_default();
        let id = format!("{parent}::{name}");
        let value = &item["inner"]["variant"];
        let (shape, fields, private) = variant_kind(value);
        let field_types: Vec<String> = fields
            .iter()
            .map(|field| {
                field
                    .as_deref()
                    .and_then(|id| self.item(id))
                    .map(|field| {
                        let field_type = ty(&field["inner"]["struct_field"], self);
                        match shape {
                            "tuple" => field_type,
                            _ => format!("{}: {field_type}", field["name"].as_str().unwrap_or("_")),
                        }
                    })
                    .unwrap_or_else(|| "_".into())
            })
            .collect();
        let body = match shape {
            "tuple" => format!("({})", field_types.join(", ")),
            "plain" if private => format!(" {{ {}, .. }}", field_types.join(", ")),
            "plain" => format!(" {{ {} }}", field_types.join(", ")),
            _ => String::new(),
        };
        let discriminant = value["discriminant"]["value"].as_str();
        let contract = api_contract(
            "variant",
            "variant",
            json!({"nonExhaustive": has_attribute(item, "non_exhaustive"), "hiddenMembers": private,
                "value": discriminant, "native": {"shape": shape}}),
        );
        let signature = format!(
            "{}{name}{body}{}",
            attributes(item),
            discriminant.map(|value| format!(" = {value}")).unwrap_or_default()
        );
        self.entity(&id, "variant", name, signature, contract, item);
        self.contains(parent, &id);
        self.fields(&id, &fields)
    }
}

fn field_keys(fields: &Value) -> Vec<Option<String>> {
    fields.as_array().into_iter().flatten().map(|field| key(field).ok()).collect()
}

/// The shape of a struct or union.
fn struct_kind(value: &Value, kind: &str) -> Shape {
    if kind == "union" {
        return ("plain", field_keys(&value["fields"]), value["has_stripped_fields"] == true);
    }
    match &value["kind"] {
        Value::String(_) => ("unit", Vec::new(), false),
        Value::Object(kind) => match kind.iter().next() {
            Some((shape, Value::Array(fields))) if shape == "tuple" => (
                "tuple",
                fields.iter().map(|field| key(field).ok()).collect(),
                fields.iter().any(Value::is_null),
            ),
            Some((shape, structure)) if shape == "plain" => {
                ("plain", field_keys(&structure["fields"]), structure["has_stripped_fields"] == true)
            }
            _ => ("unit", Vec::new(), false),
        },
        _ => ("unit", Vec::new(), false),
    }
}

/// The shape of an enum variant: any non-tuple structure is plain.
fn variant_kind(value: &Value) -> Shape {
    match &value["kind"] {
        Value::String(_) => ("unit", Vec::new(), false),
        Value::Object(kind) => match kind.iter().next() {
            Some((shape, Value::Array(fields))) if shape == "tuple" => (
                "tuple",
                fields.iter().map(|field| key(field).ok()).collect::<Vec<_>>(),
                fields.iter().any(Value::is_null),
            ),
            Some((_, structure)) => ("plain", field_keys(&structure["fields"]), structure["has_stripped_fields"] == true),
            None => ("unit", Vec::new(), false),
        },
        _ => ("unit", Vec::new(), false),
    }
}
