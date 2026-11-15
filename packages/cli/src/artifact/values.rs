//! Strict JSON objects and fields, where a field's error is in its text, and
//! the validators that fields share.

use std::collections::HashSet;

use anyhow::{Context, Result, ensure};
use serde_json::{Map, Value, json};

pub fn parse(raw: &str) -> Result<Value> {
    // The Engine sees the original JSON, before a host parser could erase duplicate keys.
    crate::engine("parse-json", json!({"json": raw}))
}

pub(crate) fn object<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>> {
    value.as_object().with_context(|| format!("{label} must be an object"))
}

pub(crate) fn fields(value: &Value, allowed: &[&str], label: &str) -> Result<()> {
    for key in object(value, label)?.keys() {
        if !allowed.contains(&key.as_str()) {
            let parent = if label == "Projection definition" {
                String::new()
            } else {
                format!("/{}", label.replace('.', "/"))
            };
            return Err(FieldError {
                pointer: format!("{parent}/{}", pointer_token(key)),
                message: format!("{label} has unknown field {key}"),
            }
            .into());
        }
    }
    Ok(())
}

/// A validation error about one field, with its JSON pointer (`/comparator/module`), so it can be
/// reported at the field's line.
#[derive(Debug)]
pub struct FieldError {
    pub pointer: String,
    pub message: String,
}

impl std::fmt::Display for FieldError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for FieldError {}

fn pointer_token(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

/// Where a definition validation error points: its field's pointer, or one read
/// from a message that starts with a dotted field name (`comparator.file must …`).
pub fn error_pointer(error: &anyhow::Error) -> Option<String> {
    if let Some(field) = error.downcast_ref::<FieldError>() {
        return Some(field.pointer.clone());
    }
    let message = error.to_string();
    let first = message.split_whitespace().next()?;
    let first = first.strip_prefix("projection.").unwrap_or(first);
    let top = first.split('.').next()?;
    let known = [
        "id",
        "title",
        "description",
        "extractor",
        "comparator",
        "renderer",
        "inputs",
        "correspondence",
        "execution",
        "presentation",
    ];
    (known.contains(&top) && first.chars().all(|character| character.is_ascii_alphanumeric() || character == '.'))
        .then(|| format!("/{}", first.replace('.', "/")))
}

/// The 1-based line and column of the member a JSON pointer names in `raw`
/// JSON text (its key, for an object member), or of the deepest part of the
/// pointer that exists. `None` when the text isn't JSON enough to walk.
pub fn locate(raw: &str, pointer: &str) -> Option<(usize, usize)> {
    let bytes = raw.as_bytes();
    let whitespace = |mut at: usize| {
        while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
            at += 1;
        }
        at
    };
    // The end of the string starting at `at` (just past its closing quote).
    let string_end = |at: usize| -> Option<usize> {
        let mut index = at + 1;
        loop {
            match bytes.get(index)? {
                b'\\' => index += 2,
                b'"' => return Some(index + 1),
                _ => index += 1,
            }
        }
    };
    let value_end = |at: usize| -> Option<usize> {
        match bytes.get(at)? {
            b'"' => string_end(at),
            b'{' | b'[' => {
                let mut depth = 0usize;
                let mut index = at;
                loop {
                    match bytes.get(index)? {
                        b'"' => {
                            index = string_end(index)?;
                            continue;
                        }
                        b'{' | b'[' => depth += 1,
                        b'}' | b']' => {
                            depth -= 1;
                            if depth == 0 {
                                return Some(index + 1);
                            }
                        }
                        _ => {}
                    }
                    index += 1;
                }
            }
            _ => {
                let mut index = at;
                while bytes
                    .get(index)
                    .is_some_and(|byte| !matches!(byte, b',' | b'}' | b']') && !byte.is_ascii_whitespace())
                {
                    index += 1;
                }
                Some(index)
            }
        }
    };
    let mut at = whitespace(0);
    let mut found = at;
    for token in pointer.split('/').skip(1) {
        let token = token.replace("~1", "/").replace("~0", "~");
        match bytes.get(at) {
            Some(b'{') => {
                let mut index = whitespace(at + 1);
                let mut matched = None;
                while bytes.get(index) == Some(&b'"') {
                    let end = string_end(index)?;
                    let key: String = serde_json::from_str(raw.get(index..end)?).ok()?;
                    let colon = whitespace(end);
                    if bytes.get(colon) != Some(&b':') {
                        return None;
                    }
                    let value = whitespace(colon + 1);
                    if key == token {
                        matched = Some((index, value));
                        break;
                    }
                    index = whitespace(value_end(value)?);
                    if bytes.get(index) == Some(&b',') {
                        index = whitespace(index + 1);
                    }
                }
                let Some((key, value)) = matched else { break };
                found = key;
                at = value;
            }
            Some(b'[') => {
                let wanted: usize = token.parse().ok()?;
                let mut index = whitespace(at + 1);
                let mut position = 0;
                while position < wanted && !matches!(bytes.get(index), Some(b']') | None) {
                    index = whitespace(value_end(index)?);
                    if bytes.get(index) == Some(&b',') {
                        index = whitespace(index + 1);
                    }
                    position += 1;
                }
                if matches!(bytes.get(index), Some(b']') | None) {
                    break;
                }
                found = index;
                at = index;
            }
            _ => break,
        }
    }
    let before = raw.get(..found)?;
    let line = before.matches('\n').count() + 1;
    let column = before.rsplit('\n').next().unwrap_or("").chars().count() + 1;
    Some((line, column))
}

fn js_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'..='\u{000d}'
            | '\u{0020}'
            | '\u{00a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

pub(crate) fn text<'a>(value: &'a Value, label: &str) -> Result<&'a str> {
    let value = value
        .as_str()
        .with_context(|| format!("{label} must be a nonempty Unicode string without NUL"))?;
    ensure!(
        !value.trim_matches(js_whitespace).is_empty() && !value.contains('\0'),
        "{label} must be a nonempty Unicode string without NUL"
    );
    Ok(value)
}

fn filename_safe(value: &str, maximum: usize, dots: bool) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || (dots && matches!(byte, b'.' | b'_')))
}

pub(crate) fn identifier<'a>(value: &'a Value, label: &str) -> Result<&'a str> {
    let value = text(value, label)?;
    ensure!(
        filename_safe(value, 100, true),
        "{label} must be 1-100 filename-safe ASCII characters"
    );
    Ok(value)
}

pub(super) fn strings(value: &Value, label: &str) -> Result<Value> {
    let values = value.as_array().with_context(|| format!("{label} must be an array"))?;
    let mut seen = HashSet::new();
    for (index, value) in values.iter().enumerate() {
        let value = text(value, &format!("{label}[{index}]"))?;
        ensure!(seen.insert(value), "{label} contains duplicates");
    }
    Ok(value.clone())
}

pub(super) fn hex(value: &str, lengths: &[usize]) -> bool {
    lengths.contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(super) fn reproducibility<'a>(value: &'a Value, label: &str) -> Result<&'a str> {
    let value = value.as_str().with_context(|| format!("{label} must be a string"))?;
    ensure!(
        matches!(value, "hermetic" | "pinned-toolchain" | "local" | "unknown" | "external"),
        "Unsupported {label}"
    );
    Ok(value)
}

pub(super) fn safe_positive_integer(value: &Value, maximum: f64, label: &str) -> Result<f64> {
    let number = value
        .as_f64()
        .with_context(|| format!("{label} must be a positive safe integer <= {maximum}"))?;
    ensure!(
        number >= 1.0 && number <= maximum && number.fract() == 0.0,
        "{label} must be a positive safe integer <= {maximum}"
    );
    Ok(number)
}

/// A plain POSIX path relative to the definition's project, as the definition
/// schema requires: it may start with `../` segments, to name something
/// outside a nested project, but has no other `.` or `..` segments.
pub(super) fn repository_path<'a>(value: &'a Value, label: &str) -> Result<&'a str> {
    let path = text(value, label)?;
    ensure!(
        path.len() <= 1024
            && !path.starts_with('/')
            && !path.chars().any(|character| character.is_control() || "\\?#:".contains(character))
            && project_relative(path),
        "{label} must be a plain path relative to the project (it may start with `../`)"
    );
    Ok(path)
}

/// Whether `path` is plain segments after optional leading `..` segments (or only `..` segments).
pub(super) fn project_relative(path: &str) -> bool {
    let mut parts = path.split('/').skip_while(|part| *part == "..").peekable();
    let climbs = path.split('/').take_while(|part| *part == "..").count();
    (climbs > 0 && parts.peek().is_none()) || parts.all(|part| !part.is_empty() && part != "." && part != "..")
}

#[cfg(test)]
mod tests;
