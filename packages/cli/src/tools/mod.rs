//! The agent tools: one catalog of operations a coding agent calls on a
//! repository's projections, answered by the Inspector service. `projections
//! serve --stdio` offers them as `tools/list` and `tools/call` (the VS Code
//! extension registers them as language model tools), and `projections mcp`
//! serves them to other agents. A result is concise text a model reads (names
//! and counts, never raw documents), with the same facts as structured JSON.
//!
//! Writes keep the service's preview flow. A call without `confirm` previews
//! and returns a `confirm` token naming exactly what it would write; a call
//! with that token writes it, or previews again when the files or the change
//! differ. Trust is the service's: writes and repository code need what the
//! service was started with. See `docs/runner/agent-tools.md`.

mod authoring;
mod catalog;
mod checks;
mod onboarding;
mod read;
mod screenshot;
#[cfg(test)]
mod tests;
mod views;

pub use authoring::line_diff;
pub use catalog::{catalog, validate};
pub(crate) use read::part_text;
use views::projection_of;
pub use views::{VIEW_DEFAULTED, ViewDefaults, with_view_defaults};

use std::time::Duration;

use axum::{body::to_bytes, http::Method};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::service::Service;

/// The longest text result, in bytes; longer ones are cut and say so.
pub const MAX_TEXT: usize = 24_000;
const POLL: Duration = Duration::from_millis(150);
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
const TRUST_HINT: &str = "It needs trust: in VS Code, trust the workspace; for `projections mcp`, start it with --trust once the person has reviewed the repository's projection code";

/// Who presents the results: an editor confirms writes itself and offers
/// editor actions; an agent (MCP) confirms writes with a second call.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Host {
    Editor,
    Agent,
}

/// What a tool needs trust for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trust {
    /// Nothing: it runs no repository code and writes nothing.
    None,
    /// Running a projection whose extractor is repository code.
    Extract,
    /// Writing: always.
    Write,
    /// Writing, outside an explore session (a repository with no projections yet).
    Onboarding,
}

impl Trust {
    fn name(self) -> &'static str {
        match self {
            Trust::None => "none",
            Trust::Extract => "extract",
            Trust::Write => "write",
            Trust::Onboarding => "onboarding",
        }
    }
}

pub struct Tool {
    pub name: &'static str,
    pub title: &'static str,
    /// What a model reads to decide when to call it.
    pub description: &'static str,
    /// A JSON Schema (draft 2020-12 subset) for its arguments.
    pub input_schema: Value,
    pub read_only: bool,
    pub destructive: bool,
    pub trust: Trust,
    /// A view action (showing a projection, reading or refreshing what is shown), answered by the surface that shows
    /// the view: VS Code with its projection tabs, `projections mcp` with the viewer (`projections view`).
    pub view: bool,
}

impl Tool {
    pub fn json(&self) -> Value {
        json!({
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": self.input_schema,
            "annotations": {
                "title": self.title,
                "readOnlyHint": self.read_only,
                "destructiveHint": self.destructive,
                "idempotentHint": self.read_only,
                "openWorldHint": false,
            },
            "trust": self.trust.name(),
            "view": self.view,
        })
    }
}

/// The tools, as `tools/list` returns them: `{"tools": [...]}`. Every host
/// offers the same ones; the view tools are answered by the surface that shows
/// the view.
pub fn list() -> Value {
    let tools: Vec<Value> = catalog().iter().map(Tool::json).collect();
    json!({"tools": tools})
}

/// A tool's result: text for the model, the same facts as JSON, and whether it failed.
#[derive(Debug)]
pub struct Outcome {
    pub text: String,
    pub structured: Value,
    pub error: bool,
    /// A PNG the result shows (`screenshot`).
    pub image: Option<Vec<u8>>,
}

impl Outcome {
    pub fn new(text: String, structured: Value) -> Self {
        Self {
            text,
            structured,
            error: false,
            image: None,
        }
    }

    pub fn failure(message: String) -> Self {
        Self {
            structured: json!({"error": message}),
            text: message,
            error: true,
            image: None,
        }
    }

    /// The result as `tools/call` returns it (MCP's `CallToolResult`).
    pub fn json(&self) -> Value {
        let mut content = vec![json!({"type": "text", "text": self.text})];
        if let Some(png) = &self.image {
            content.push(json!({"type": "image", "data": crate::artifact::base64(png), "mimeType": "image/png"}));
        }
        json!({
            "content": content,
            "structuredContent": self.structured,
            "isError": self.error,
        })
    }

    /// A result as `json` wrote it, as a viewer in another process answers.
    pub fn from_json(value: &Value) -> Self {
        let content = value["content"].as_array().cloned().unwrap_or_default();
        let text = content
            .iter()
            .filter(|part| part["type"] == "text")
            .filter_map(|part| part["text"].as_str())
            .collect::<String>();
        let image = content
            .iter()
            .find(|part| part["type"] == "image")
            .and_then(|part| part["data"].as_str())
            .and_then(|data| crate::browser::base64_decode(data).ok());
        Self {
            text,
            structured: value["structuredContent"].clone(),
            error: value["isError"] == true,
            image,
        }
    }
}

/// A tool's failure, reported as a result with `isError`.
#[derive(Debug)]
struct Failure(String);

impl From<anyhow::Error> for Failure {
    fn from(error: anyhow::Error) -> Self {
        Failure(format!("{error:#}"))
    }
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Failure(message)
    }
}

impl From<&str> for Failure {
    fn from(message: &str) -> Self {
        Failure(message.to_owned())
    }
}

type Answer = Result<Outcome, Failure>;

/// Runs a closure when dropped, unless disarmed: cancels the service's work
/// when a call is cancelled (its future dropped).
struct OnDrop<F: FnMut()>(Option<F>);

impl<F: FnMut()> OnDrop<F> {
    fn disarm(&mut self) {
        self.0 = None;
    }
}

impl<F: FnMut()> Drop for OnDrop<F> {
    fn drop(&mut self) {
        if let Some(mut action) = self.0.take() {
            action();
        }
    }
}

/// Cuts `text` to at most `limit` bytes, at a line when it can, saying how much was left out.
pub fn bounded(text: String, limit: usize) -> String {
    if text.len() <= limit {
        return text;
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let end = text[..end].rfind('\n').filter(|at| *at > limit / 2).unwrap_or(end);
    format!(
        "{}\n… (cut: {} more bytes; narrow the request for the rest)\n",
        &text[..end],
        text.len() - end
    )
}

/// Calls a tool. `Err` only for a tool this host doesn't offer (a protocol
/// error); invalid arguments and failures are results with `error` set.
pub async fn call(service: &Service, host: Host, name: &str, arguments: &Value) -> Result<Outcome, String> {
    call_with_views(service, host, None, name, arguments).await
}

/// Calls a tool with the viewer as the surface that shows the view
/// (`projections mcp`): the view tools are answered by it, and omitted
/// projections and revisions default to what it shows.
pub async fn call_with_views(
    service: &Service,
    host: Host,
    views: Option<&crate::view::Views>,
    name: &str,
    arguments: &Value,
) -> Result<Outcome, String> {
    let tool = catalog()
        .into_iter()
        .find(|tool| tool.name == name)
        .ok_or_else(|| format!("Unknown tool: {name}"))?;
    let input = if arguments.is_null() { json!({}) } else { arguments.clone() };
    if let Err(message) = validate(&tool.input_schema, &input, "") {
        return Ok(Outcome::failure(format!("{name}: {message}")));
    }
    if tool.view {
        return Ok(match views {
            Some(views) => views.answer(name, &input).await,
            None => Outcome::failure(format!(
                "{name} is a view action: the surface that shows the view answers it (the Projections VS Code extension, or projections mcp with its viewer)"
            )),
        });
    }
    // Omitted projections and revisions come from what the viewer shows, and the result says so.
    let (input, note) = match views {
        Some(views) if VIEW_DEFAULTED.contains(&name) => {
            let shown = views.defaults().await;
            match with_view_defaults(name, input, shown.as_ref()) {
                Ok(defaulted) => defaulted,
                Err(message) => return Ok(Outcome::failure(message)),
            }
        }
        _ => (input, None),
    };
    let answer = match name {
        "list_projections" => read::list_projections(service, &input).await,
        "compare" => read::compare(service, &input).await,
        "explore" => read::explore(service).await,
        "sweep" => read::sweep(service, &input).await,
        "check" => checks::check(service, &input).await,
        "prepare" => checks::prepare(service, &input).await,
        "run_comparator_tests" => checks::run_comparator_tests(service, &input).await,
        "describe_part" => authoring::describe::describe_part(&input),
        "adopt" => onboarding::onboarding(service, host, name, &input).await,
        "set_part" => authoring::set_part(service, host, &input).await,
        "update_snapshots" => authoring::snapshots::update_snapshots(service, host, &input).await,
        "screenshot" => screenshot::screenshot(service, &input).await,
        _ => Err(Failure(format!("Unknown tool: {name}"))),
    };
    Ok(match answer {
        Ok(mut outcome) => {
            if let Some(note) = note {
                outcome.text = format!("{note}\n\n{}", outcome.text);
                outcome.structured["defaults"] = json!(note);
            }
            outcome.text = bounded(outcome.text, MAX_TEXT);
            outcome
        }
        Err(Failure(message)) => Outcome::failure(bounded(message, MAX_TEXT)),
    })
}

fn text(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

fn plural(count: usize, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

/// A query component, percent-encoded.
fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                char::from(byte).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

/// A request to the service: its status and JSON body.
async fn api(service: &Service, method: Method, path: &str, body: Option<&Value>) -> Result<(u16, Value), Failure> {
    let body = body.map(serde_json::to_vec).transpose().map_err(anyhow::Error::from)?;
    let response = service.call(method, path, body).await?;
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), MAX_RESPONSE_BYTES)
        .await
        .map_err(|_| Failure::from("The Projections service's answer is too large"))?;
    Ok((status, serde_json::from_slice(&bytes).unwrap_or(Value::Null)))
}

/// Why the service refused: its first diagnostic, with what trust would grant.
fn refusal(status: u16, body: &Value) -> Failure {
    let message = body["diagnostics"][0]["message"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| body.to_string());
    Failure(if status == 403 && message.contains("--trust") {
        format!("{message}. {TRUST_HINT}.")
    } else {
        message
    })
}

async fn get(service: &Service, path: &str) -> Result<Value, Failure> {
    match api(service, Method::GET, path, None).await? {
        (200..=299, body) => Ok(body),
        (status, body) => Err(refusal(status, &body)),
    }
}

async fn post(service: &Service, path: &str, body: &Value) -> Result<Value, Failure> {
    match api(service, Method::POST, path, Some(body)).await? {
        (200..=299, body) => Ok(body),
        (status, body) => Err(refusal(status, &body)),
    }
}

/// A short token naming exactly what a write would do: its tool, the files'
/// current digest and the content it would write.
fn token(tool: &str, parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    hash.update(tool.as_bytes());
    for part in parts {
        hash.update([0]);
        hash.update(part.as_bytes());
    }
    format!("{:x}", hash.finalize())[..20].to_owned()
}

/// A preview's closing line: how to write it, for an agent; an editor confirms itself.
fn confirm_hint(host: Host, tool: &str, token: &str) -> String {
    match host {
        Host::Agent => format!(
            "\nNothing was written. Show the person this preview; to write it, call {tool} again with the same arguments and confirm: \"{token}\".\n"
        ),
        Host::Editor => "\nNothing was written.\n".to_owned(),
    }
}
