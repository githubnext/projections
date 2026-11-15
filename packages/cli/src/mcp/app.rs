//! The viewer as an MCP App (the MCP Apps extension, `io.modelcontextprotocol/ui`,
//! SEP-1865), for hosts such as Claude Desktop that show an MCP server's HTML
//! views in the conversation, a side panel or full screen. A host that says so
//! in `initialize` gets:
//!
//! - the view, `ui://projections/viewer` (`resources/list`, `resources/read`): one
//!   self-contained page, the viewer's own (`packages/integrations/mcp-apps`),
//!   embedded at build time, with its scripts, the shared engine and the
//!   built-in renderers inline;
//! - `open_projection` linked to it (`_meta.ui.resourceUri`), so the host shows
//!   the view for each call;
//! - `viewer_request`, a tool only the view may call (`visibility: ["app"]`),
//!   which relays the page's requests to the viewer (`projections view`) as a
//!   browser's would go: its state's long poll and reports, the service's read
//!   routes and extraction jobs, and renderer bundles. The host's sandbox lets
//!   the view reach no network, loopback included, so this is its only way to
//!   the viewer, and the viewer stays the one source of the view state.
//!
//! The view never sees the viewer's token, and can't reach its control
//! endpoints: it reads and reports as a page does, and drives nothing.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use rand::RngCore;
use serde_json::{Value, json};

use crate::view::{Views, client};

/// The extension's identifier in `capabilities.extensions`.
pub const EXTENSION: &str = "io.modelcontextprotocol/ui";
/// The view's content type.
pub const MIME_TYPE: &str = "text/html;profile=mcp-app";
/// The view.
pub const RESOURCE_URI: &str = "ui://projections/viewer";
/// The tool the view relays its requests through.
pub const RELAY_TOOL: &str = "viewer_request";
/// The longest answer one result carries, in bytes; a longer one comes in parts, as hosts may cut long results.
pub(super) const PART_BYTES: usize = 96 * 1024;
/// How long the rest of a long answer waits for the view to ask for it.
const PARTS_KEPT: Duration = Duration::from_secs(120);
/// The most bytes of long answers kept at once.
const PARTS_LIMIT: usize = 64 * 1024 * 1024;
/// MCP's error code for a resource that doesn't exist.
pub const RESOURCE_NOT_FOUND: i64 = -32002;

/// Whether a client's `initialize` says it shows MCP Apps' HTML views.
pub fn negotiated(params: &Value) -> bool {
    params["capabilities"]["extensions"][EXTENSION]["mimeTypes"]
        .as_array()
        .is_some_and(|types| types.iter().any(|kind| kind == MIME_TYPE))
}

/// `tools/list` for a host that shows the view: `open_projection` linked to it, and the view's relay.
pub fn tools(mut list: Value) -> Value {
    let Some(tools) = list["tools"].as_array_mut() else {
        return list;
    };
    for tool in tools.iter_mut().filter(|tool| tool["name"] == "open_projection") {
        // The flat key is the extension's earlier form, which hosts may still read.
        tool["_meta"] = json!({"ui": {"resourceUri": RESOURCE_URI}, "ui/resourceUri": RESOURCE_URI});
    }
    tools.push(json!({
        "name": RELAY_TOOL,
        "title": "Viewer request",
        "description": "For the Projections viewer's view only: relays one of its page's requests to the viewer.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "method": {"type": "string", "enum": ["GET", "POST"]},
                "path": {"type": "string", "minLength": 1, "maxLength": 4096},
                "body": {"type": "object"},
                "continuation": {"type": "string", "minLength": 1, "maxLength": 64},
                "part": {"type": "integer", "minimum": 1},
            },
            "additionalProperties": false,
        },
        "annotations": {"title": "Viewer request", "readOnlyHint": true, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false},
        "_meta": {"ui": {"resourceUri": RESOURCE_URI, "visibility": ["app"]}},
    }));
    list
}

/// `resources/list`: the view.
pub fn resources() -> Value {
    json!({"resources": [{
        "uri": RESOURCE_URI,
        "name": "projections-viewer",
        "title": "Projections viewer",
        "description": "The projection the agent shows: its stage, comparison modes, playback and zoom.",
        "mimeType": MIME_TYPE,
    }]})
}

/// `resources/read` of the view: `page`, with what the host should know to show it. It needs no network (`csp`
/// declares no origins); it would rather open beside the conversation (`preferredDisplayMode`, Claude's), and draws
/// no border of its own.
pub fn read(params: &Value, page: &str) -> Result<Value, (i64, String)> {
    let uri = params["uri"].as_str().unwrap_or_default();
    if uri != RESOURCE_URI {
        return Err((RESOURCE_NOT_FOUND, format!("No resource {uri}")));
    }
    Ok(json!({"contents": [{
        "uri": RESOURCE_URI,
        "mimeType": MIME_TYPE,
        "text": page,
        "_meta": {"ui": {"csp": {}, "prefersBorder": false, "preferredDisplayMode": "fullscreen"}},
    }]}))
}

/// The viewer's paths the view may ask for: its state's long poll and its reports, and what the viewer forwards
/// to the service (which answers only reads and extraction jobs) and its renderer bundles. Not its control
/// endpoints, the page or its assets.
pub(super) fn relayed(method: &str, path: &str) -> bool {
    let route = path.split('?').next().unwrap_or_default();
    let allowed = match method {
        "GET" => {
            route == "/view/state"
                || ["/api/", "/renderers/", "/custom-renderers/"]
                    .iter()
                    .any(|prefix| route.starts_with(prefix))
        }
        "POST" => route == "/view/report" || route.starts_with("/api/"),
        _ => false,
    };
    allowed
        && path.len() <= 4096
        && !path.contains(['#', '\\'])
        && !route.split('/').any(|part| part == "." || part == "..")
        && !path.chars().any(|character| character.is_ascii_control())
}

/// The token in a viewer URL, `http://127.0.0.1:PORT/TOKEN/`.
fn token(url: &str) -> &str {
    url.trim_end_matches('/').rsplit('/').next().unwrap_or_default()
}

/// A viewer's answer as the view reads it: `{status, contentType, body}`, `body` the parsed JSON of a JSON answer,
/// text for text, `{"base64"}` otherwise. The renderer list's custom renderer base loses the viewer's token, which
/// the view never sees; the view asks for those bundles through the relay, which adds it back.
pub(super) fn answer(response: &client::Response, url: &str) -> Value {
    let essence = response
        .content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let text = || std::str::from_utf8(&response.body).ok().map(str::to_owned);
    let mut body = if response.body.is_empty() {
        Value::Null
    } else if essence == "application/json" || essence.ends_with("+json") {
        serde_json::from_slice(&response.body)
            .ok()
            .or_else(|| text().map(Value::String))
            .unwrap_or(Value::Null)
    } else if essence.starts_with("text/") || ["application/javascript", "image/svg+xml"].contains(&essence.as_str()) {
        text().map(Value::String).unwrap_or(Value::Null)
    } else {
        json!({"base64": crate::artifact::base64(&response.body)})
    };
    let prefix = format!("/{}/", token(url));
    if let Some(base) = body["customRendererBase"]
        .as_str()
        .and_then(|base| base.strip_prefix(prefix.as_str()))
    {
        body["customRendererBase"] = json!(format!("/{base}"));
    }
    json!({"status": response.status, "contentType": response.content_type, "body": body})
}

/// A relay result: `text` for the view only (the host never gives the model an app-only tool's result).
fn result(text: String) -> Value {
    json!({"content": [{"type": "text", "text": text}], "isError": false})
}

/// The view's relay to the viewer, and the rest of long answers it hasn't asked for yet.
#[derive(Default)]
pub struct Relay {
    parts: Mutex<HashMap<String, (Instant, Vec<String>)>>,
}

impl Relay {
    /// Answers `viewer_request`: a request relayed to the viewer, or the next part of a long answer. A long answer's
    /// first result is `{"continuation", "parts", "text"}`, and `{continuation, part}` asks for each other part's
    /// text; the view joins them.
    pub async fn call(&self, views: &Views, arguments: &Value) -> Result<Value, String> {
        if let Some(continuation) = arguments["continuation"].as_str() {
            let index = arguments["part"].as_u64().ok_or("A continuation takes a part")? as usize;
            return self.part(continuation, index).map(result);
        }
        let method = arguments["method"].as_str().ok_or("viewer_request takes {method, path, body?}")?;
        let path = arguments["path"].as_str().ok_or("viewer_request takes {method, path, body?}")?;
        if !relayed(method, path) {
            return Err(format!(
                "The viewer's view doesn't ask for {method} {}",
                path.chars().take(200).collect::<String>()
            ));
        }
        let body = match arguments.get("body") {
            None | Some(Value::Null) => None,
            Some(_) if method == "GET" => return Err("A GET request has no body".to_owned()),
            Some(body) => Some(body),
        };
        let (response, url) = views.relay(method, path, body).await?;
        Ok(result(self.divide(answer(&response, &url).to_string())))
    }

    /// `text` whole when it is short, else its first part, keeping the rest for the view to ask for.
    pub(super) fn divide(&self, text: String) -> String {
        if text.len() <= PART_BYTES {
            return text;
        }
        let mut parts = Vec::new();
        let mut rest = text.as_str();
        while !rest.is_empty() {
            let mut end = rest.len().min(PART_BYTES);
            while !rest.is_char_boundary(end) {
                end -= 1;
            }
            parts.push(rest[..end].to_owned());
            rest = &rest[end..];
        }
        let mut bytes = [0u8; 16];
        rand::rng().fill_bytes(&mut bytes);
        let continuation: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let first = json!({"continuation": continuation, "parts": parts.len(), "text": parts[0]}).to_string();
        let mut kept = self.parts.lock().unwrap_or_else(|error| error.into_inner());
        kept.retain(|_, (at, _)| at.elapsed() < PARTS_KEPT);
        let mut total: usize = kept.values().flat_map(|(_, parts)| parts.iter()).map(String::len).sum();
        // The oldest answers give way when too much is waiting.
        while total + text.len() > PARTS_LIMIT {
            let Some(oldest) = kept.iter().min_by_key(|(_, (at, _))| *at).map(|(key, _)| key.clone()) else {
                break;
            };
            if let Some((_, parts)) = kept.remove(&oldest) {
                total -= parts.iter().map(String::len).sum::<usize>();
            }
        }
        kept.insert(continuation, (Instant::now(), parts));
        first
    }

    /// A long answer's part `index` (from 1); the answer is forgotten once its last part is asked for.
    pub(super) fn part(&self, continuation: &str, index: usize) -> Result<String, String> {
        let mut kept = self.parts.lock().unwrap_or_else(|error| error.into_inner());
        let (_, parts) = kept
            .get(continuation)
            .filter(|(at, _)| at.elapsed() < PARTS_KEPT)
            .ok_or("That answer is no longer kept: ask again")?;
        let text = parts.get(index).cloned().ok_or("The answer has no such part")?;
        if index + 1 == parts.len() {
            kept.remove(continuation);
        }
        Ok(text)
    }
}
