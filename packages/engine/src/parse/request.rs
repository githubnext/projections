//! The Engine request ABI: one JSON request in, one JSON response out.

use super::api::{canonicalize, normalize, vary};
use super::comparison::check;
use super::extraction::read;
use super::fields::{fields, object, text};
use crate::{ABI_VERSION, Failure, MAX_EXTRACTION_BYTES, MAX_JSON_BYTES, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, fail};
use serde_json::{Value, json};

fn execute(request: &Value) -> Result<Value, Failure> {
    object(request, "")?;
    if request["version"].as_f64() != Some(f64::from(ABI_VERSION)) {
        return Err(fail("unsupported-version", "/version", "Expected engine ABI version 0"));
    }
    let operation = text(&request["operation"], "/operation", true)?;
    match operation {
        "decode" | "parse-json" => {
            fields(request, &["version", "operation", "json"], "")?;
            let raw = text(&request["json"], "/json", false)?;
            if operation == "decode" && raw.len() > MAX_EXTRACTION_BYTES {
                return Err(fail("extraction-size-limit", "/json", "Extractor JSON exceeds 8 MiB"));
            }
            if operation == "parse-json" && raw.len() > MAX_JSON_BYTES {
                return Err(fail("json-size-limit", "/json", "Artifact JSON exceeds 32 MiB"));
            }
            let parsed = super::json::parse(raw)?;
            if operation == "parse-json" {
                Ok(parsed)
            } else {
                normalize(&parsed, "")
            }
        }
        "normalize" | "canonicalize" => {
            fields(request, &["version", "operation", "extraction"], "")?;
            let extraction = normalize(&request["extraction"], "/extraction")?;
            if operation == "normalize" {
                Ok(extraction)
            } else {
                let (canonical, digest) = canonicalize(&extraction)?;
                Ok(json!({"canonical": canonical, "digest": digest}))
            }
        }
        "validate-comparison" => {
            fields(request, &["version", "operation", "before", "after", "comparison"], "")?;
            let before = read(&request["before"], "/before")?;
            let after = read(&request["after"], "/after")?;
            check(&before, &after, &request["comparison"])?;
            Ok(request["comparison"].clone())
        }
        "pair" => {
            fields(request, &["version", "operation", "before", "after"], "")?;
            crate::pairing(&request["before"], &request["after"]).map(|pairing| pairing.to_json())
        }
        "vary" => {
            fields(request, &["version", "operation", "before", "after"], "")?;
            vary(&request["before"], &request["after"]).map(|variation| variation.to_json())
        }
        _ => Err(fail("unsupported-operation", "/operation", "Unsupported engine operation")),
    }
}

pub fn diagnostic_response(code: &str, message: &str) -> Value {
    response(Err(fail(code, "", message)))
}

fn response(result: Result<Value, Failure>) -> Value {
    match result {
        Ok(result) => {
            let mut object = serde_json::Map::new();
            object.insert("ok".to_owned(), Value::Bool(true));
            object.insert("result".to_owned(), result);
            Value::Object(object)
        }
        Err(diagnostics) => json!({"ok": false, "diagnostics": diagnostics.into_iter().map(|d| {
            json!({"severity": "error", "code": d.code, "path": d.path, "message": d.message})
        }).collect::<Vec<_>>()}),
    }
}

/// Handles one engine request: UTF-8 JSON in, a JSON response out.
pub fn handle(input: &[u8]) -> Value {
    if input.len() > MAX_REQUEST_BYTES {
        return diagnostic_response("request-size-limit", "Engine request exceeds 128 MiB");
    }
    let result = std::str::from_utf8(input)
        .map_err(|_| fail("invalid-unicode", "", "Request must be valid UTF-8"))
        .and_then(super::json::parse)
        .and_then(|request| execute(&request));
    let response = response(result);
    if super::fields::length(&response) > MAX_RESPONSE_BYTES {
        diagnostic_response("response-size-limit", "Engine response exceeds 64 MiB")
    } else {
        response
    }
}
