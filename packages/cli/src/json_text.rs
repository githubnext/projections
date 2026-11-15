//! JSON files people open: pretty-printed with a final newline. Rewriting an
//! existing file keeps its indentation and its objects' field order, so the
//! difference is only what changed. Standard output for machines, NDJSON and
//! protocol messages stay compact; this is only for files.

use anyhow::Result;
use serde::de::{Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde::ser::{Serialize, SerializeMap, SerializeSeq, Serializer};
use serde_json::{Value, ser::PrettyFormatter};
use std::fmt;

/// The indentation of a new file.
pub const INDENT: &str = "  ";

/// A definition's fields in the order a new definition file lists them.
pub const DEFINITION_ORDER: [&str; 8] = [
    "id",
    "title",
    "description",
    "extractor",
    "comparator",
    "renderer",
    "execution",
    "sources",
];

/// `value` as JSON indented by `indent` per level, without a final newline.
pub fn to_string_indented(value: &impl Serialize, indent: &str) -> Result<String> {
    let mut bytes = Vec::new();
    let mut serializer = serde_json::Serializer::with_formatter(&mut bytes, PrettyFormatter::with_indent(indent.as_bytes()));
    value.serialize(&mut serializer)?;
    Ok(String::from_utf8(bytes)?)
}

/// A new file's text for `value`: two-space indentation and a final newline.
pub fn pretty(value: &impl Serialize) -> Result<String> {
    Ok(format!("{}\n", to_string_indented(value, INDENT)?))
}

/// The indentation unit of JSON text: the leading whitespace of its first
/// indented line, or `None` when no line is indented (such as minified JSON).
pub fn indent_of(text: &str) -> Option<&str> {
    text.lines().skip(1).find_map(|line| {
        let rest = line.trim_start_matches([' ', '\t']);
        let width = line.len() - rest.len();
        (width > 0 && !rest.is_empty()).then(|| &line[..width])
    })
}

/// The text of a file holding `value`. When `existing` (the file's current
/// text) is JSON, the result uses its indentation (two spaces when it has none)
/// and its objects' field order; fields it doesn't have come after, `order`'s
/// first, then the rest alphabetically. Ends with a newline.
pub fn render(value: &Value, existing: Option<&str>, order: &[&str]) -> Result<String> {
    let like = existing.and_then(|text| serde_json::from_str::<Ordered>(text).ok());
    let indent = existing.and_then(indent_of).unwrap_or(INDENT);
    let laid_out = Ordered::arrange(value, like.as_ref(), order);
    Ok(format!("{}\n", to_string_indented(&laid_out, indent)?))
}

/// A JSON value whose objects keep their fields in a chosen order (`Value`'s
/// objects are sorted by key).
#[derive(Clone, Debug, PartialEq)]
pub enum Ordered {
    Object(Vec<(String, Ordered)>),
    Array(Vec<Ordered>),
    Scalar(Value),
}

impl Ordered {
    /// `value` with each object's fields in `like`'s order where `like` has them
    /// (array items are matched by their `id`, else by position), then
    /// `order`'s fields, then the rest by key.
    pub fn arrange(value: &Value, like: Option<&Ordered>, order: &[&str]) -> Ordered {
        match value {
            Value::Object(fields) => {
                let like = match like {
                    Some(Ordered::Object(like)) => like.as_slice(),
                    _ => &[],
                };
                let mut keys: Vec<&String> = like.iter().map(|(key, _)| key).filter(|key| fields.contains_key(*key)).collect();
                let mut rest: Vec<&String> = fields.keys().filter(|key| !keys.contains(key)).collect();
                rest.sort_by_key(|key| order.iter().position(|first| first == key).unwrap_or(order.len()));
                keys.extend(rest);
                Ordered::Object(
                    keys.into_iter()
                        .map(|key| {
                            let previous = like.iter().find(|(name, _)| name == key).map(|(_, value)| value);
                            (key.clone(), Ordered::arrange(&fields[key], previous, order))
                        })
                        .collect(),
                )
            }
            Value::Array(items) => {
                let like = match like {
                    Some(Ordered::Array(like)) => like.as_slice(),
                    _ => &[],
                };
                Ordered::Array(
                    items
                        .iter()
                        .enumerate()
                        .map(|(index, item)| {
                            let previous = match item.get("id") {
                                Some(id) => like.iter().find(|candidate| candidate.id() == Some(id)),
                                None => like.get(index),
                            };
                            Ordered::arrange(item, previous, order)
                        })
                        .collect(),
                )
            }
            scalar => Ordered::Scalar(scalar.clone()),
        }
    }

    fn id(&self) -> Option<&Value> {
        match self {
            Ordered::Object(fields) => fields.iter().find_map(|(key, value)| match value {
                Ordered::Scalar(id) if key == "id" => Some(id),
                _ => None,
            }),
            _ => None,
        }
    }
}

impl Serialize for Ordered {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Ordered::Object(fields) => {
                let mut map = serializer.serialize_map(Some(fields.len()))?;
                for (key, value) in fields {
                    map.serialize_entry(key, value)?;
                }
                map.end()
            }
            Ordered::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(item)?;
                }
                seq.end()
            }
            Ordered::Scalar(value) => value.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for Ordered {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Any;
        impl<'de> Visitor<'de> for Any {
            type Value = Ordered;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a JSON value")
            }
            fn visit_bool<E>(self, value: bool) -> Result<Ordered, E> {
                Ok(Ordered::Scalar(Value::Bool(value)))
            }
            fn visit_i64<E>(self, value: i64) -> Result<Ordered, E> {
                Ok(Ordered::Scalar(Value::from(value)))
            }
            fn visit_u64<E>(self, value: u64) -> Result<Ordered, E> {
                Ok(Ordered::Scalar(Value::from(value)))
            }
            fn visit_f64<E>(self, value: f64) -> Result<Ordered, E> {
                Ok(Ordered::Scalar(Value::from(value)))
            }
            fn visit_str<E>(self, value: &str) -> Result<Ordered, E> {
                Ok(Ordered::Scalar(Value::from(value)))
            }
            fn visit_string<E>(self, value: String) -> Result<Ordered, E> {
                Ok(Ordered::Scalar(Value::String(value)))
            }
            fn visit_unit<E>(self) -> Result<Ordered, E> {
                Ok(Ordered::Scalar(Value::Null))
            }
            fn visit_none<E>(self) -> Result<Ordered, E> {
                Ok(Ordered::Scalar(Value::Null))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Ordered, A::Error> {
                let mut items = Vec::new();
                while let Some(item) = seq.next_element()? {
                    items.push(item);
                }
                Ok(Ordered::Array(items))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Ordered, A::Error> {
                let mut fields: Vec<(String, Ordered)> = Vec::new();
                while let Some((key, value)) = map.next_entry::<String, Ordered>()? {
                    // A repeated key's last value wins, as when parsing into a `Value`.
                    fields.retain(|(name, _)| name != &key);
                    fields.push((key, value));
                }
                Ok(Ordered::Object(fields))
            }
        }
        deserializer.deserialize_any(Any)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn new_files_are_indented_by_two_spaces_and_end_with_a_newline() {
        assert_eq!(
            pretty(&json!({"id": "map", "tags": ["a"]})).unwrap(),
            "{\n  \"id\": \"map\",\n  \"tags\": [\n    \"a\"\n  ]\n}\n"
        );
        let text = render(&json!({"title": "Map", "renderer": "graph", "id": "map"}), None, &DEFINITION_ORDER).unwrap();
        assert_eq!(text, "{\n  \"id\": \"map\",\n  \"title\": \"Map\",\n  \"renderer\": \"graph\"\n}\n");
    }

    #[test]
    fn rewriting_keeps_the_files_indentation_and_field_order() {
        let existing =
            "{\n    \"zeta\": 1,\n    \"nested\": {\"b\": 1, \"a\": 2},\n    \"items\": [{\"id\": \"x\", \"z\": 1, \"a\": 2}]\n}";
        let value = json!({"zeta": 2, "nested": {"a": 2, "b": 1, "c": 3},
            "items": [{"id": "new", "a": 1, "id2": 0}, {"id": "x", "a": 2, "z": 1}], "added": true});
        assert_eq!(
            render(&value, Some(existing), &["id"]).unwrap(),
            "{\n    \"zeta\": 2,\n    \"nested\": {\n        \"b\": 1,\n        \"a\": 2,\n        \"c\": 3\n    },\n    \"items\": [\n        {\n            \"id\": \"new\",\n            \"a\": 1,\n            \"id2\": 0\n        },\n        {\n            \"id\": \"x\",\n            \"z\": 1,\n            \"a\": 2\n        }\n    ],\n    \"added\": true\n}\n"
        );
        // Tabs are kept; a minified file gets two spaces but keeps its order.
        assert_eq!(
            render(&json!({"b": 1, "a": 2}), Some("{\n\t\"b\": 0,\n\t\"a\": 0\n}\n"), &[]).unwrap(),
            "{\n\t\"b\": 1,\n\t\"a\": 2\n}\n"
        );
        assert_eq!(
            render(&json!({"b": 1, "a": 2}), Some(r#"{"b":0,"a":0}"#), &[]).unwrap(),
            "{\n  \"b\": 1,\n  \"a\": 2\n}\n"
        );
    }
}
