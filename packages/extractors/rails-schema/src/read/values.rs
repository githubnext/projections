//! Ruby literals as JSON.

use projections_extractor_ruby_support::{Expr, Kind, Stmt};
use serde_json::{Map, Value, json};

/// A number as JSON: integers and decimals stay exact; others are kept as written.
fn number(text: &str) -> Value {
    if let Ok(integer) = text.parse::<i64>() {
        return json!(integer);
    }
    match text.parse::<f64>() {
        Ok(float) if float.is_finite() && !text.contains(['x', 'b', 'o']) => json!(float),
        _ => json!(text),
    }
}

/// A literal expression as JSON: strings and symbols as strings, numbers,
/// booleans, `nil`, arrays and hashes. A lambda whose body is a string, such
/// as a default's `-> { "now()" }`, is `{"sql": "now()"}`. Anything else is
/// `{"ruby": <source>}`, so its change is still seen.
pub fn json(expr: &Expr) -> Value {
    match &expr.kind {
        Kind::Nil => Value::Null,
        Kind::Bool(b) => json!(b),
        Kind::Str {
            value,
            interpolated: false,
        }
        | Kind::Symbol(value) => json!(value),
        Kind::Number(n) => number(n),
        Kind::Array(items) => Value::Array(items.iter().map(json).collect()),
        Kind::Hash(pairs) => {
            let mut object = Map::new();
            for (key, value) in pairs {
                object.insert(key.name().map_or_else(|| key.text.clone(), str::to_owned), json(value));
            }
            Value::Object(object)
        }
        Kind::Lambda(block) => match block.body.as_slice() {
            [Stmt::Expr(body)] if body.string().is_some() => json!({"sql": body.string()}),
            _ => json!({"ruby": expr.text}),
        },
        _ => json!({"ruby": expr.text}),
    }
}
