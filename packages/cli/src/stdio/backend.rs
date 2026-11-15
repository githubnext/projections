//! What the protocol asks of the Inspector service: the [`Backend`] it
//! answers through, its methods' parameters and responses as JSON.

use std::future::Future;

use anyhow::Result;
use axum::{
    body::to_bytes,
    http::{Method, header},
    response::Response,
};
use serde_json::{Value, json};

use super::{MAX_RESPONSE_BYTES, PROTOCOL, valid_path};
use crate::service::Service;

/// What a backend answers: the stdio protocol's view of the Inspector service.
pub(super) trait Backend: Send + Sync + 'static {
    fn initialize(&self) -> Value;
    fn request(&self, method: Method, path: String, body: Option<Vec<u8>>) -> impl Future<Output = Result<Response>> + Send;
    /// The agent tools (`tools/list`).
    fn tools(&self) -> Value;
    /// Calls a tool (`tools/call`); `Err` for a tool it doesn't offer.
    fn call_tool(&self, name: String, arguments: Value) -> impl Future<Output = Result<Value, String>> + Send;
}

impl Backend for Service {
    fn initialize(&self) -> Value {
        json!({
            "protocol": PROTOCOL,
            "version": env!("CARGO_PKG_VERSION"),
            "repository": self.repository().to_string_lossy(),
            "trusted": self.trusted(),
            "explore": self.explore(),
            "mode": self.mode(),
        })
    }

    async fn request(&self, method: Method, path: String, body: Option<Vec<u8>>) -> Result<Response> {
        self.call(method, &path, body).await
    }

    fn tools(&self) -> Value {
        crate::tools::list()
    }

    async fn call_tool(&self, name: String, arguments: Value) -> Result<Value, String> {
        crate::tools::call(self, crate::tools::Host::Editor, &name, &arguments)
            .await
            .map(|outcome| outcome.json())
    }
}

/// A `tools/call`'s parameters: `{name, arguments?}`.
pub(crate) fn tool_params(params: &Value) -> Result<(String, Value), &'static str> {
    let invalid = "tools/call takes {name, arguments?: {...}}";
    let fields = params.as_object().ok_or(invalid)?;
    let name = fields.get("name").and_then(Value::as_str).ok_or(invalid)?;
    let arguments = match fields.get("arguments") {
        None | Some(Value::Null) => json!({}),
        Some(arguments) if arguments.is_object() => arguments.clone(),
        Some(_) => return Err(invalid),
    };
    Ok((name.to_owned(), arguments))
}

/// `{status, contentType, headers?, body}`: `body` is the parsed JSON of a
/// JSON response, `{"base64"}` for a binary one and text otherwise; `headers`
/// carries the security headers a host presenting the response applies.
pub(super) async fn encode(response: Response) -> Result<Value, String> {
    let status = response.status().as_u16();
    let headers: serde_json::Map<String, Value> = ["content-security-policy", "x-content-type-options"]
        .into_iter()
        .filter_map(|name| {
            let value = response.headers().get(name)?.to_str().ok()?;
            Some((name.to_owned(), Value::String(value.to_owned())))
        })
        .collect();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let bytes = to_bytes(response.into_body(), MAX_RESPONSE_BYTES)
        .await
        .map_err(|_| format!("The response exceeds {MAX_RESPONSE_BYTES} bytes"))?;
    let essence = content_type.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    let text = || std::str::from_utf8(&bytes).ok().map(str::to_owned);
    let body = if bytes.is_empty() {
        Value::Null
    } else if essence == "application/json" || essence.ends_with("+json") {
        serde_json::from_slice(&bytes)
            .ok()
            .or_else(|| text().map(Value::String))
            .unwrap_or_else(|| json!({"base64": crate::artifact::base64(&bytes)}))
    } else if essence.starts_with("text/") || ["application/javascript", "image/svg+xml"].contains(&essence.as_str()) {
        text()
            .map(Value::String)
            .unwrap_or_else(|| json!({"base64": crate::artifact::base64(&bytes)}))
    } else {
        json!({"base64": crate::artifact::base64(&bytes)})
    };
    let mut result = json!({"status": status, "contentType": content_type, "body": body});
    if !headers.is_empty() {
        result["headers"] = Value::Object(headers);
    }
    Ok(result)
}

/// A request's parameters: `{method, path, body?}`.
pub(super) fn request_params(params: &Value) -> Result<(Method, String, Option<Vec<u8>>), &'static str> {
    let invalid = "request takes {method: \"GET\"|\"POST\", path: \"/api/...\", body?}";
    let fields = params.as_object().ok_or(invalid)?;
    if fields.keys().any(|key| !["method", "path", "body"].contains(&key.as_str())) {
        return Err(invalid);
    }
    let method = match fields.get("method").and_then(Value::as_str) {
        Some("GET") => Method::GET,
        Some("POST") => Method::POST,
        _ => return Err(invalid),
    };
    let path = fields
        .get("path")
        .and_then(Value::as_str)
        .filter(|path| valid_path(path))
        .ok_or("path must be a server-relative /api/, /renderers/, /custom-renderers/ or /inspector/ path")?;
    let body = match fields.get("body") {
        None => None,
        Some(_) if method == Method::GET => return Err("A GET request has no body"),
        Some(body) => Some(serde_json::to_vec(body).map_err(|_| invalid)?),
    };
    Ok((method, path.to_owned(), body))
}
