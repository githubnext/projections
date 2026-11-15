//! The open-ended values items carry in `data`, which the content proofs
//! (`content`) walk. The Engine's model re-exports them.

#[cfg(not(verus_keep_ghost))]
use verus_builtin_macros::verus;
#[cfg(verus_keep_ghost)]
use vstd::prelude::*;

use alloc::collections::BTreeMap;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

#[cfg(not(verus_keep_ghost))]
mod encode;

verus! {

/// An object's fields, ordered by key.
pub type Fields = BTreeMap<String, Datum>;

/// A finite JSON number; an integer is a JavaScript safe integer. Equality
/// is by value, as canonical JSON compares numbers. The form an extractor
/// wrote (`1` or `1.0`) is kept only so a normalized extraction re-encodes
/// to the same bytes.
#[derive(Debug, Clone, Copy)]
pub enum Number {
    Integer(i64),
    Float(f64),
}

/// An open-ended value: an item's `data`, metadata, a generated value or its
/// basis. Unlike untyped JSON it holds only what the protocol accepts:
/// finite numbers, safe integers and objects without duplicate keys.
pub enum Datum {
    Null,
    Bool(bool),
    Number(Number),
    String(String),
    Array(Vec<Datum>),
    Object(Fields),
}

} // verus!

impl Number {
    pub fn value(self) -> f64 {
        match self {
            Number::Integer(value) => value as f64,
            Number::Float(value) => value,
        }
    }
}

impl PartialEq for Number {
    fn eq(&self, other: &Number) -> bool {
        self.value() == other.value()
    }
}

// `Clone`, `Debug` and `PartialEq` are what `#[derive]` would give, written
// out because Verus rejects derived impls for a type that contains itself
// through a map. Equality is structural, numbers by value.
impl Clone for Datum {
    fn clone(&self) -> Datum {
        match self {
            Datum::Null => Datum::Null,
            Datum::Bool(value) => Datum::Bool(*value),
            Datum::Number(number) => Datum::Number(*number),
            Datum::String(text) => Datum::String(text.clone()),
            Datum::Array(items) => Datum::Array(items.clone()),
            Datum::Object(fields) => Datum::Object(fields.clone()),
        }
    }
}

impl core::fmt::Debug for Datum {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Datum::Null => formatter.write_str("Null"),
            Datum::Bool(value) => formatter.debug_tuple("Bool").field(value).finish(),
            Datum::Number(number) => formatter.debug_tuple("Number").field(number).finish(),
            Datum::String(text) => formatter.debug_tuple("String").field(text).finish(),
            Datum::Array(items) => formatter.debug_tuple("Array").field(items).finish(),
            Datum::Object(fields) => formatter.debug_tuple("Object").field(fields).finish(),
        }
    }
}

impl PartialEq for Datum {
    fn eq(&self, other: &Datum) -> bool {
        match (self, other) {
            (Datum::Null, Datum::Null) => true,
            (Datum::Bool(a), Datum::Bool(b)) => a == b,
            (Datum::Number(a), Datum::Number(b)) => a == b,
            (Datum::String(a), Datum::String(b)) => a == b,
            (Datum::Array(a), Datum::Array(b)) => a == b,
            (Datum::Object(a), Datum::Object(b)) => a == b,
            _ => false,
        }
    }
}

impl Datum {
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Datum::Number(number) => Some(number.value()),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Datum::String(text) => Some(text),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&Fields> {
        match self {
            Datum::Object(fields) => Some(fields),
            _ => None,
        }
    }

    /// One step down, as an RFC 6901 token reads it: an object's field, or
    /// an array's item at a canonical decimal index.
    pub fn child(&self, key: &str) -> Option<&Datum> {
        match self {
            Datum::Object(fields) => fields.get(key),
            Datum::Array(items) => {
                let canonical = key == "0" || (!key.is_empty() && !key.starts_with('0') && key.bytes().all(|b| b.is_ascii_digit()));
                if !canonical {
                    return None;
                }
                key.parse::<usize>().ok().and_then(|index| items.get(index))
            }
            _ => None,
        }
    }

    /// The tokens one step down: an object's keys, or an array's indices.
    pub fn keys(&self) -> Vec<String> {
        match self {
            Datum::Object(fields) => fields.keys().cloned().collect(),
            Datum::Array(items) => (0..items.len()).map(|index| index.to_string()).collect(),
            _ => Vec::new(),
        }
    }
}

/// The value at `keys` below an item's `data`.
pub fn lookup<'a>(data: &'a Fields, keys: &[String]) -> Option<&'a Datum> {
    let (first, rest) = keys.split_first()?;
    rest.iter().try_fold(data.get(first)?, |value, key| value.child(key))
}
