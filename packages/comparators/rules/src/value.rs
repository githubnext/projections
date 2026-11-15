//! JSON to CEL values and back.
//!
//! JSON numbers that are integers within `i64` become CEL `int`, every other
//! number a CEL `double`, so `size(x) == item.data.count` and list indexing
//! work without conversions. Objects become CEL maps with string keys.

use cel::Value as Cel;
use cel::objects::{Key, Map};
use serde_json::{Map as JsonMap, Number, Value as Json};
use std::collections::HashMap;
use std::sync::Arc;

pub fn to_cel(value: &Json) -> Cel {
    match value {
        Json::Null => Cel::Null,
        Json::Bool(value) => Cel::Bool(*value),
        Json::Number(number) => match number.as_i64() {
            Some(integer) => Cel::Int(integer),
            None => Cel::Float(number.as_f64().unwrap_or(f64::NAN)),
        },
        Json::String(text) => Cel::String(Arc::new(text.clone())),
        Json::Array(items) => Cel::List(Arc::new(items.iter().map(to_cel).collect())),
        Json::Object(fields) => object(fields.iter().map(|(key, value)| (key.clone(), to_cel(value)))),
    }
}

/// An entity or relationship for rules: `data` is always an object, so
/// `item.data.key` needs no guard for `data` itself.
pub fn item_to_cel(item: &Json) -> Cel {
    let Json::Object(fields) = item else {
        return to_cel(item);
    };
    let data = fields.get("data").filter(|data| data.is_object());
    object(
        fields
            .iter()
            .filter(|(key, _)| *key != "data")
            .map(|(key, value)| (key.clone(), to_cel(value)))
            .chain([("data".to_owned(), data.map_or_else(|| object([]), to_cel))]),
    )
}

/// An extraction for rules: its items as [`item_to_cel`] makes them.
pub fn extraction_to_cel(extraction: &Json) -> Cel {
    let Json::Object(fields) = extraction else {
        return to_cel(extraction);
    };
    object(fields.iter().map(|(key, value)| {
        let converted = match (key.as_str(), value) {
            ("entities" | "relationships", Json::Array(items)) => Cel::List(Arc::new(items.iter().map(item_to_cel).collect())),
            _ => to_cel(value),
        };
        (key.clone(), converted)
    }))
}

pub fn object(fields: impl IntoIterator<Item = (String, Cel)>) -> Cel {
    let map: HashMap<Key, Cel> = fields.into_iter().map(|(key, value)| (Key::String(Arc::new(key)), value)).collect();
    Cel::Map(Map { map: Arc::new(map) })
}

pub fn list(items: impl IntoIterator<Item = Cel>) -> Cel {
    Cel::List(Arc::new(items.into_iter().collect()))
}

pub fn string(text: &str) -> Cel {
    Cel::String(Arc::new(text.to_owned()))
}

pub fn to_json(value: &Cel) -> Result<Json, String> {
    Ok(match value {
        Cel::Null => Json::Null,
        Cel::Bool(value) => Json::Bool(*value),
        Cel::Int(value) => Json::from(*value),
        Cel::UInt(value) => Json::from(*value),
        Cel::Float(value) => Json::Number(Number::from_f64(*value).ok_or_else(|| format!("{value} is not a JSON number"))?),
        Cel::String(text) => Json::String(text.as_ref().clone()),
        Cel::List(items) => Json::Array(items.iter().map(to_json).collect::<Result<_, _>>()?),
        Cel::Map(map) => {
            let mut fields = JsonMap::new();
            for (key, value) in map.map.iter() {
                let Key::String(key) = key else {
                    return Err("JSON object keys must be strings".into());
                };
                fields.insert(key.as_ref().clone(), to_json(value)?);
            }
            Json::Object(fields)
        }
        other => return Err(format!("{:?} has no JSON form", other.type_of())),
    })
}
