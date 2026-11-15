use crate::{Diagnostic, Failure};
use serde::de::{DeserializeSeed, Error, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value};
use std::{cell::RefCell, fmt};

pub(super) const SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

#[derive(Default)]
struct Context {
    diagnostic: Option<Diagnostic>,
    path: String,
}

struct Seed<'a> {
    context: &'a RefCell<Context>,
    path: String,
    depth: usize,
}

impl Seed<'_> {
    fn error<E: Error>(&self, code: &str, message: &str) -> E {
        self.context.borrow_mut().diagnostic = Some(Diagnostic::new(code, &self.path, message));
        E::custom(message)
    }

    fn child(&self, key: &str) -> Seed<'_> {
        Seed {
            context: self.context,
            path: crate::pointer(&self.path, key),
            depth: self.depth + 1,
        }
    }
}

impl<'de> DeserializeSeed<'de> for Seed<'_> {
    type Value = Value;

    fn deserialize<D: serde::Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
        self.context.borrow_mut().path.clone_from(&self.path);
        if self.depth > 64 {
            return Err(self.error("depth-limit", "JSON nesting exceeds the transport limit of 64"));
        }
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for Seed<'_> {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("valid JSON with unique keys and safe numbers")
    }

    fn visit_bool<E: Error>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_unit<E: Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_str<E: Error>(self, value: &str) -> Result<Value, E> {
        Ok(Value::String(value.to_owned()))
    }

    fn visit_string<E: Error>(self, value: String) -> Result<Value, E> {
        Ok(Value::String(value))
    }

    fn visit_i64<E: Error>(self, value: i64) -> Result<Value, E> {
        if value.unsigned_abs() > SAFE_INTEGER as u64 {
            return Err(self.error("unsafe-integer", "Integer exceeds the JavaScript safe-integer range"));
        }
        Ok(Value::Number(Number::from(value)))
    }

    fn visit_u64<E: Error>(self, value: u64) -> Result<Value, E> {
        if value > SAFE_INTEGER as u64 {
            return Err(self.error("unsafe-integer", "Integer exceeds the JavaScript safe-integer range"));
        }
        Ok(Value::Number(Number::from(value)))
    }

    fn visit_f64<E: Error>(self, value: f64) -> Result<Value, E> {
        if !value.is_finite() {
            return Err(self.error("nonfinite-number", "Numbers must be finite"));
        }
        if value.fract() == 0.0 && value.abs() > SAFE_INTEGER {
            return Err(self.error("unsafe-integer", "Integer exceeds the JavaScript safe-integer range"));
        }
        Ok(Value::Number(Number::from_f64(if value == 0.0 { 0.0 } else { value }).unwrap()))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut access: A) -> Result<Value, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = access.next_element_seed(self.child(&values.len().to_string()))? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut access: A) -> Result<Value, A::Error> {
        let mut values = Map::new();
        while let Some(key) = access.next_key::<String>()? {
            if values.contains_key(&key) {
                return Err(self.child(&key).error("duplicate-key", "Duplicate JSON object key"));
            }
            let value = access.next_value_seed(self.child(&key))?;
            values.insert(key, value);
        }
        Ok(Value::Object(values))
    }
}

pub(crate) fn parse(input: &str) -> Result<Value, Failure> {
    let context = RefCell::new(Context::default());
    let mut deserializer = serde_json::Deserializer::from_str(input);
    let value = Seed {
        context: &context,
        path: String::new(),
        depth: 0,
    }
    .deserialize(&mut deserializer)
    .and_then(|value| deserializer.end().map(|()| value));
    value.map_err(|error| {
        let mut context = context.borrow_mut();
        vec![
            context
                .diagnostic
                .take()
                .unwrap_or_else(|| Diagnostic::new("invalid-json", &context.path, &error.to_string())),
        ]
    })
}

#[cfg(test)]
mod tests {
    //! serde_json never calls these visitor methods for text input, but other
    //! deserializers may; they must keep the strict rules.
    use super::*;
    use serde::de::{Expected, value::Error as ValueError};

    fn seed(context: &RefCell<Context>) -> Seed<'_> {
        Seed {
            context,
            path: "/x".to_owned(),
            depth: 0,
        }
    }

    #[test]
    fn owned_strings_are_strings() {
        let context = RefCell::default();
        let value: Result<Value, ValueError> = seed(&context).visit_string("text".to_owned());
        assert_eq!(value.unwrap(), Value::String("text".to_owned()));
    }

    #[test]
    fn nonfinite_floats_are_rejected_with_a_diagnostic() {
        for number in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let context = RefCell::default();
            let value: Result<Value, ValueError> = seed(&context).visit_f64(number);
            assert!(value.is_err());
            let diagnostic = context.into_inner().diagnostic.unwrap();
            assert_eq!(diagnostic.code, "nonfinite-number");
            assert_eq!(diagnostic.path, "/x");
        }
    }

    #[test]
    fn the_expectation_describes_strict_json() {
        let context = RefCell::default();
        let seed = seed(&context);
        assert_eq!(
            format!("{}", &seed as &dyn Expected),
            "valid JSON with unique keys and safe numbers"
        );
    }
}
