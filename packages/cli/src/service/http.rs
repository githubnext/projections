//! Requests and responses: errors, JSON bodies and query parameters.

use anyhow::Result;
use axum::{
    body::to_bytes,
    extract::Request,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

const MAX_REQUEST_BYTES: usize = 4096;
pub(super) struct HttpError(pub(super) StatusCode, pub(super) String);

impl HttpError {
    pub(super) fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self(status, message.into())
    }
}

pub(super) fn diagnostic(message: impl Into<String>) -> Value {
    json!({"severity": "error", "code": "RUNNER_ERROR", "path": "", "message": message.into()})
}

pub(super) fn error_diagnostics(error: &anyhow::Error) -> Vec<Value> {
    crate::diagnostics::error_diagnostics(error)
}

impl IntoResponse for HttpError {
    fn into_response(self) -> Response {
        json_response(self.0, json!({"diagnostics": [diagnostic(self.1)]}))
    }
}

pub(super) fn json_response(status: StatusCode, value: Value) -> Response {
    let mut response = (status, axum::Json(value)).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, "application/json; charset=utf-8".parse().unwrap());
    response.headers_mut().insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    response
}

fn single_header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a [u8]> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    Some(value.as_bytes())
}

pub(super) fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

pub(super) async fn request_body(request: Request) -> Result<Value, HttpError> {
    let content_type = single_header(request.headers(), "content-type").and_then(|value| std::str::from_utf8(value).ok());
    if content_type.and_then(|value| value.split(';').next()) != Some("application/json") {
        return Err(HttpError::new(StatusCode::UNSUPPORTED_MEDIA_TYPE, "Expected application/json"));
    }
    let bytes = to_bytes(request.into_body(), MAX_REQUEST_BYTES).await.map_err(|error| {
        let mut cause: &dyn std::error::Error = &error;
        loop {
            if cause.to_string() == "length limit exceeded" {
                return HttpError::new(StatusCode::PAYLOAD_TOO_LARGE, "Inspector request exceeds 4096 bytes");
            }
            match cause.source() {
                Some(source) => cause = source,
                None => {
                    return HttpError::new(StatusCode::BAD_REQUEST, "Invalid JSON request");
                }
            }
        }
    })?;
    let text = std::str::from_utf8(&bytes).map_err(|_| HttpError::new(StatusCode::BAD_REQUEST, "Invalid JSON request"))?;
    crate::artifact::parse(text).map_err(|_| HttpError::new(StatusCode::BAD_REQUEST, "Invalid JSON request"))
}

pub(super) fn decode_url(value: &str, query: bool) -> Result<String, HttpError> {
    let mut decoded = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let digits = bytes
                    .get(index + 1..index + 3)
                    .ok_or_else(|| HttpError::new(StatusCode::BAD_REQUEST, "Invalid URL encoding"))?;
                let hex = |byte: u8| match byte {
                    b'0'..=b'9' => Some(byte - b'0'),
                    b'a'..=b'f' => Some(byte - b'a' + 10),
                    b'A'..=b'F' => Some(byte - b'A' + 10),
                    _ => None,
                };
                let byte = hex(digits[0])
                    .zip(hex(digits[1]))
                    .map(|(a, b)| a * 16 + b)
                    .ok_or_else(|| HttpError::new(StatusCode::BAD_REQUEST, "Invalid URL encoding"))?;
                decoded.push(byte);
                index += 3;
            }
            b'+' if query => {
                decoded.push(b' ');
                index += 1;
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(decoded).map_err(|_| HttpError::new(StatusCode::BAD_REQUEST, "Invalid URL encoding"))
}

pub(super) fn query_value(query: Option<&str>, name: &str) -> Result<Option<String>, HttpError> {
    for field in query.unwrap_or_default().split('&') {
        let (key, value) = field.split_once('=').unwrap_or((field, ""));
        if decode_url(key, true)? == name {
            let value = decode_url(value, true)?;
            if utf16_len(&value) > 1024 {
                return Err(HttpError::new(
                    StatusCode::BAD_REQUEST,
                    format!("Query parameter {name} is too long"),
                ));
            }
            return Ok(Some(value));
        }
    }
    Ok(None)
}

pub(super) fn query_reference(query: Option<&str>) -> Result<String, HttpError> {
    Ok(query_value(query, "ref")?.unwrap_or_else(|| "working-tree".to_owned()))
}

pub(super) fn projection_parameter(query: Option<&str>) -> Result<String, HttpError> {
    let id = query_value(query, "projection")?.unwrap_or_default();
    if id.is_empty()
        || id.len() > 100
        || !id.as_bytes()[0].is_ascii_alphanumeric()
        || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
    {
        return Err(HttpError::new(
            StatusCode::BAD_REQUEST,
            "A valid projection query parameter is required",
        ));
    }
    Ok(id)
}
