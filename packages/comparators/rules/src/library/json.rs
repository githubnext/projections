use super::arity;
use crate::value::string;
use cel::Value as Cel;
use cel::objects::Key;
use std::sync::Arc;

/// `JSON.stringify(value)` as the JavaScript engine computes it for a value
/// parsed from canonical JSON: numbers in ECMAScript form, object keys that
/// are array indices first in numeric order, then the others in the order
/// they arrived, which for canonical input is code-point order.
pub(super) fn json(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 1)?;
    let mut out = String::new();
    write_json(&args[0], &mut out)?;
    Ok(string(&out))
}

pub(super) fn array_index(key: &str) -> Option<u32> {
    if key == "0" {
        return Some(0);
    }
    if key.starts_with('0') {
        return None;
    }
    key.parse::<u32>().ok().filter(|index| *index != u32::MAX)
}

pub(super) fn write_json(value: &Cel, out: &mut String) -> Result<(), String> {
    match value {
        Cel::Null => out.push_str("null"),
        Cel::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
        Cel::Int(value) => write_number(*value as f64, out),
        Cel::UInt(value) => write_number(*value as f64, out),
        Cel::Float(value) => write_number(*value, out),
        Cel::String(text) => out.push_str(&serde_json::to_string(text.as_str()).unwrap()),
        Cel::List(items) => {
            out.push('[');
            for (position, item) in items.iter().enumerate() {
                if position > 0 {
                    out.push(',');
                }
                write_json(item, out)?;
            }
            out.push(']');
        }
        Cel::Map(map) => {
            let mut keys: Vec<&str> = map
                .map
                .keys()
                .map(|key| match key {
                    Key::String(key) => Ok(key.as_str()),
                    _ => Err("json() needs string keys".to_owned()),
                })
                .collect::<Result<_, _>>()?;
            keys.sort_by(|a, b| match (array_index(a), array_index(b)) {
                (Some(a), Some(b)) => a.cmp(&b),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => a.cmp(b),
            });
            out.push('{');
            for (position, key) in keys.iter().enumerate() {
                if position > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(key).unwrap());
                out.push(':');
                let value = map.map.get(&Key::String(Arc::new((*key).to_owned()))).unwrap();
                write_json(value, out)?;
            }
            out.push('}');
        }
        _ => return Err("json() takes JSON values".into()),
    }
    Ok(())
}

pub(super) fn write_number(value: f64, out: &mut String) {
    if value.is_finite() {
        // RFC 8785 numbers are ECMAScript's Number::toString.
        out.push_str(&projections_engine::canonical(&serde_json::json!(value)).unwrap());
    } else {
        out.push_str("null");
    }
}
