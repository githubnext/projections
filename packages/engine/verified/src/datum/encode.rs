//! Values as JSON. Ordinary builds only: Verus checks the crate without its
//! dependencies, and nothing proved encodes.

use super::{Datum, Number};
use serde::ser::{Serialize, Serializer};

impl Serialize for Number {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Number::Integer(value) => serializer.serialize_i64(*value),
            Number::Float(value) => serializer.serialize_f64(*value),
        }
    }
}

impl Serialize for Datum {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Datum::Null => serializer.serialize_unit(),
            Datum::Bool(value) => serializer.serialize_bool(*value),
            Datum::Number(number) => number.serialize(serializer),
            Datum::String(text) => serializer.serialize_str(text),
            Datum::Array(items) => serializer.collect_seq(items),
            Datum::Object(fields) => serializer.collect_map(fields),
        }
    }
}

impl Datum {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::to_value(self).expect("a value encodes as JSON")
    }
}
