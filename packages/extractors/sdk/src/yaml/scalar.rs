// Adapted from serde_yaml 0.9 (https://github.com/dtolnay/serde-yaml), MIT OR Apache-2.0, Copyright (c) David Tolnay.

//! Scalar resolution, following serde_yaml 0.9 so that repository files read
//! as they did when the extractors used it.
//!
//! An untagged plain scalar is null (empty, `~`, `null`, `Null`, `NULL`), a
//! boolean (`true`, `True`, `TRUE` and the same for false), an integer
//! (decimal without leading zeros, `0x`, `0o`, `0b`, optionally signed) or a
//! float (`.inf`, `.nan` and what Rust parses as a finite `f64`), else a
//! string. Quoted and block scalars are strings. The core tags `!!bool`,
//! `!!int`, `!!float` and `!!null` force their type; other global tags
//! (`!!str`, `!!binary`, `!!timestamp`, ...) read the text as a string.

use std::num::ParseIntError;

const CORE: &str = "tag:yaml.org,2002:";

#[derive(Debug, Clone, PartialEq)]
pub(super) enum Scalar {
    Null,
    Bool(bool),
    /// Within `i64::MIN..=u64::MAX`.
    Int(i128),
    Float(f64),
    String(String),
}

/// Resolves a scalar's text. `tag` is the resolved global tag, if any; local
/// tags are rejected before this.
pub(super) fn resolve(text: String, plain: bool, tag: Option<&str>) -> Result<Scalar, String> {
    let Some(tag) = tag else {
        return Ok(if plain { untagged(text)? } else { Scalar::String(text) });
    };
    let invalid = |expected: &str| format!("invalid value: string {text:?}, expected {expected}");
    match tag.strip_prefix(CORE) {
        Some("bool") => parse_bool(&text).map(Scalar::Bool).ok_or_else(|| invalid("a boolean")),
        Some("int") => integer(&text).unwrap_or_else(|| Err(invalid("an integer"))).map(Scalar::Int),
        Some("float") => parse_f64(&text).map(Scalar::Float).ok_or_else(|| invalid("a float")),
        Some("null") if parse_null(&text) => Ok(Scalar::Null),
        Some("null") => Err(invalid("null")),
        _ => Ok(Scalar::String(text)),
    }
}

fn untagged(text: String) -> Result<Scalar, String> {
    if text.is_empty() || parse_null(&text) {
        return Ok(Scalar::Null);
    }
    if let Some(boolean) = parse_bool(&text) {
        return Ok(Scalar::Bool(boolean));
    }
    if let Some(int) = integer(&text) {
        return int.map(Scalar::Int);
    }
    if !digits_but_not_number(&text)
        && let Some(float) = parse_f64(&text)
    {
        return Ok(Scalar::Float(float));
    }
    Ok(Scalar::String(text))
}

/// An integer that fits `u64` or `i64`; one that only fits 128 bits is an error.
fn integer(text: &str) -> Option<Result<i128, String>> {
    if let Some(int) = parse_unsigned_int(text, u64::from_str_radix) {
        return Some(Ok(int.into()));
    }
    if let Some(int) = parse_negative_int(text, i64::from_str_radix) {
        return Some(Ok(int.into()));
    }
    let wide = parse_unsigned_int(text, u128::from_str_radix)
        .map(|int| int.to_string())
        .or_else(|| parse_negative_int(text, i128::from_str_radix).map(|int| int.to_string()));
    wide.map(|int| Err(format!("integer `{int}` is out of range")))
}

fn parse_null(text: &str) -> bool {
    matches!(text, "null" | "Null" | "NULL" | "~")
}

fn parse_bool(text: &str) -> Option<bool> {
    match text {
        "true" | "True" | "TRUE" => Some(true),
        "false" | "False" | "FALSE" => Some(false),
        _ => None,
    }
}

type Radix<T> = fn(&str, u32) -> Result<T, ParseIntError>;

/// The digits after `prefix`, unless a sign follows the prefix.
fn radix<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    text.strip_prefix(prefix).filter(|rest| !rest.starts_with(['+', '-']))
}

fn parse_unsigned_int<T>(text: &str, from_str_radix: Radix<T>) -> Option<T> {
    let unpositive = text.strip_prefix('+').unwrap_or(text);
    for (prefix, base) in [("0x", 16), ("0o", 8), ("0b", 2)] {
        if let Some(int) = radix(unpositive, prefix).and_then(|rest| from_str_radix(rest, base).ok()) {
            return Some(int);
        }
    }
    if unpositive.starts_with(['+', '-']) || digits_but_not_number(text) {
        return None;
    }
    from_str_radix(unpositive, 10).ok()
}

fn parse_negative_int<T>(text: &str, from_str_radix: Radix<T>) -> Option<T> {
    for (prefix, base) in [("-0x", 16), ("-0o", 8), ("-0b", 2)] {
        if let Some(int) = text
            .strip_prefix(prefix)
            .and_then(|rest| from_str_radix(&format!("-{rest}"), base).ok())
        {
            return Some(int);
        }
    }
    if digits_but_not_number(text) {
        return None;
    }
    from_str_radix(text, 10).ok()
}

fn parse_f64(text: &str) -> Option<f64> {
    let unpositive = match text.strip_prefix('+') {
        Some(rest) if rest.starts_with(['+', '-']) => return None,
        Some(rest) => rest,
        None => text,
    };
    if let ".inf" | ".Inf" | ".INF" = unpositive {
        return Some(f64::INFINITY);
    }
    if let "-.inf" | "-.Inf" | "-.INF" = text {
        return Some(f64::NEG_INFINITY);
    }
    if let ".nan" | ".NaN" | ".NAN" = text {
        return Some(f64::NAN);
    }
    unpositive.parse::<f64>().ok().filter(|float| float.is_finite())
}

/// Leading zeros followed by digits are a string in YAML 1.2.
fn digits_but_not_number(text: &str) -> bool {
    let text = text.strip_prefix(['-', '+']).unwrap_or(text);
    text.len() > 1 && text.starts_with('0') && text[1..].bytes().all(|b| b.is_ascii_digit())
}
