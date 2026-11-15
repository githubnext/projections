use super::error::ComparatorError;
use super::limiter::Limiter;
use super::{COMPARISON_FIELDS, INPUT_FIELDS, Limits, PROTOCOL_VERSION};
use serde_json::{Map, Value};
use wasmi::{ExternType, FuncType, Module, Store, ValType};

/// The output bytes an export returned, packed as `(pointer << 32) | length`.
pub(super) fn read_output(
    store: &mut Store<Limiter>,
    memory: &wasmi::Memory,
    packed: u64,
    export: &str,
    limits: &Limits,
) -> Result<Vec<u8>, ComparatorError> {
    let output_start = (packed >> 32) as usize;
    let output_length = (packed & 0xffff_ffff) as usize;
    if output_length > limits.max_output_bytes {
        return Err(ComparatorError::OutputTooLarge {
            size: output_length,
            limit: limits.max_output_bytes,
        });
    }
    let mut output = vec![0; output_length];
    memory.read(&*store, output_start, &mut output).map_err(|_| {
        ComparatorError::InvalidReturn(format!(
            "{export} returned {output_length} bytes at {output_start}, outside its {}-byte memory",
            memory.data_size(&*store)
        ))
    })?;
    Ok(output)
}

pub(super) fn check_function(
    module: &Module,
    name: &'static str,
    params: &[ValType],
    results: &[ValType],
    expected: &'static str,
) -> Result<(), ComparatorError> {
    match module.get_export(name) {
        None => Err(ComparatorError::MissingExport(name)),
        Some(ExternType::Func(func)) if func.params() == params && func.results() == results => Ok(()),
        Some(other) => Err(ComparatorError::InvalidExport {
            name,
            expected,
            found: describe(&other),
        }),
    }
}

pub(super) fn describe(ty: &ExternType) -> String {
    match ty {
        ExternType::Func(func) => describe_function(func),
        ExternType::Memory(memory) if memory.is_64() => "a 64-bit linear memory".into(),
        ExternType::Memory(_) => "a linear memory".into(),
        ExternType::Table(_) => "a table".into(),
        ExternType::Global(_) => "a global".into(),
    }
}

pub(super) fn describe_function(func: &FuncType) -> String {
    let list = |types: &[ValType]| {
        types
            .iter()
            .map(|ty| format!("{ty:?}").to_lowercase())
            .collect::<Vec<_>>()
            .join(", ")
    };
    format!("a function ({}) -> ({})", list(func.params()), list(func.results()))
}

pub(super) fn parse_object(bytes: &[u8], what: &str) -> Result<Map<String, Value>, String> {
    let text = std::str::from_utf8(bytes).map_err(|error| format!("{what} is not UTF-8: {error}"))?;
    match serde_json::from_str(text) {
        Ok(Value::Object(object)) => Ok(object),
        Ok(_) => Err(format!("{what} must be a JSON object")),
        Err(error) => Err(format!("{what} is not valid JSON: {error}")),
    }
}

pub(super) fn check_fields(object: &Map<String, Value>, allowed: &[&str], what: &str) -> Result<(), String> {
    match object.keys().find(|key| !allowed.contains(&key.as_str())) {
        Some(key) => Err(format!("{what} has unknown field `{key}`")),
        None => Ok(()),
    }
}

pub(super) fn check_protocol(object: &Map<String, Value>, what: &str) -> Result<(), String> {
    match object.get("protocolVersion").and_then(Value::as_u64) {
        Some(PROTOCOL_VERSION) => Ok(()),
        _ => Err(format!("{what} must have protocolVersion {PROTOCOL_VERSION}")),
    }
}

pub(super) fn check_input(bytes: &[u8]) -> Result<(), ComparatorError> {
    let check = || {
        let object = parse_object(bytes, "input")?;
        check_fields(&object, &INPUT_FIELDS, "input")?;
        check_protocol(&object, "input")?;
        for field in ["before", "after", "baseline", "options"] {
            if !object.get(field).is_some_and(Value::is_object) {
                return Err(format!("input field `{field}` must be an object"));
            }
        }
        Ok(())
    };
    check().map_err(ComparatorError::InvalidInput)
}

pub(super) fn check_output(bytes: &[u8]) -> Result<(), ComparatorError> {
    let object = parse_object(bytes, "output").map_err(ComparatorError::InvalidOutput)?;
    if let Some(error) = object.get("error") {
        return match error {
            Value::String(message) if object.len() == 1 => Err(ComparatorError::Comparator(message.clone())),
            _ => Err(ComparatorError::InvalidOutput(
                "an error result must be exactly {\"error\": \"message\"}".into(),
            )),
        };
    }
    let check = || {
        check_fields(&object, &COMPARISON_FIELDS, "comparison")?;
        check_protocol(&object, "comparison")?;
        for (field, required, array) in [
            ("changes", true, true),
            ("steps", true, true),
            ("reverseSteps", false, true),
            ("order", false, false),
            ("variation", false, false),
            ("metadata", false, false),
        ] {
            match object.get(field) {
                None if !required => {}
                Some(Value::Array(_)) if array => {}
                Some(Value::Object(_)) if !array => {}
                _ => {
                    let kind = if array { "an array" } else { "an object" };
                    return Err(format!("comparison field `{field}` must be {kind}"));
                }
            }
        }
        Ok(())
    };
    check().map_err(ComparatorError::InvalidOutput)
}
