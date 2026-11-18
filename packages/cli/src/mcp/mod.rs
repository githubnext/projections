//! `projections mcp`: the agent tools ([`crate::tools`]) as a Model Context
//! Protocol server over standard input and output, for coding agents other
//! than VS Code's (which gets the same tools from the extension): GitHub
//! Copilot CLI, Claude Code and any other MCP client. JSON-RPC 2.0, one
//! message per line, as `serve --stdio` frames it. Writes preview first and
//! write on a second call with the preview's `confirm` token. See
//! `docs/runner/agent-tools.md`.

use std::{future::Future, sync::Arc};

use anyhow::{Context, Result};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::service::{InspectorOptions, Service};
use crate::stdio::{
    Frame, INVALID_PARAMS, INVALID_REQUEST, Inflight, MAX_LINE_BYTES, METHOD_NOT_FOUND, PARSE_ERROR, error, reply, spawn_tracked,
    tool_params,
};
use crate::tools::{self, Host};

/// The protocol version answered when the client asks for one this server doesn't know.
pub const PROTOCOL_VERSION: &str = "2025-06-18";
/// The protocol versions it speaks, newest first; the tools use nothing newer than the first.
const VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

/// What an MCP session answers from: the tools and what `initialize` says.
trait ToolHost: Send + Sync + 'static {
    fn instructions(&self) -> String;
    fn tools(&self) -> Value;
    fn call(&self, name: String, arguments: Value) -> impl Future<Output = Result<Value, String>> + Send;
}

/// The agent tools over the service, with the viewer as the surface that shows the view.
struct Agent {
    service: Arc<Service>,
    views: crate::view::Views,
}

impl ToolHost for Agent {
    fn instructions(&self) -> String {
        format!(
            "Projections shows the systems in this repository ({}) without lines of code: services, schemas, dependencies, public APIs, workflows, and how a change reshapes them. \
            Start with list_projections, or explore when the repository defines none yet. compare tells a change as steps with each change's meaning; sweep shows which recent changes each projection catches. \
            Show the person the projections you set up or change, then discuss them: open_projection starts the viewer, a page on this machine they watch while you drive it (what they mean by \"open it in the inspector\" or \"show me\"), and gives its URL. \
            Open it for them yourself, in your own browser if you have one, else in the system browser (projections view show --open, run in the repository); give them the link only when you can open neither. \
            current_view says what it shows and what they selected, and screenshot renders it as an image. \
            Writes (adopt, set_part, update_snapshots) preview first and write only when called again with the preview's confirm token: show the person the preview, and confirm only when they agree. \
            Never adopt on your own; a request to set projections up is the go-ahead to adopt the few worth having so you can show them. \
            Adding them to CI is the person's decision: when they ask, read the repository's workflows and propose where the Projections step goes, as `projections help agents ci` explains (usually a step in the job that already installs and builds), show the diff, and write it only once they agree. \
            Repository code {}.",
            self.service.repository().display(),
            if self.service.trusted() {
                "runs (started with --trust)"
            } else {
                "doesn't run: projections whose extractor is repository code, and writes outside an explore session, need projections mcp --trust"
            }
        )
    }

    fn tools(&self) -> Value {
        tools::list()
    }

    async fn call(&self, name: String, arguments: Value) -> Result<Value, String> {
        let outcome = tools::call_with_views(&self.service, Host::Agent, Some(&self.views), &name, &arguments).await?;
        Ok(outcome.json())
    }
}

/// The answer to `initialize`.
fn initialize(host: &impl ToolHost, params: &Value) -> Value {
    let requested = params["protocolVersion"].as_str().unwrap_or_default();
    let version = VERSIONS
        .into_iter()
        .find(|version| *version == requested)
        .unwrap_or(PROTOCOL_VERSION);
    json!({
        "protocolVersion": version,
        "capabilities": {"tools": {"listChanged": false}},
        "serverInfo": {"name": "projections", "title": "Projections", "version": env!("CARGO_PKG_VERSION")},
        "instructions": host.instructions(),
    })
}

/// Answers frames until the input ends or `stop` resolves. Tool calls run
/// concurrently, each in its own task; `notifications/cancelled` aborts one,
/// which then gets no reply.
async fn session<H: ToolHost>(
    host: Arc<H>,
    mut input: mpsc::Receiver<Frame>,
    output: mpsc::Sender<String>,
    stop: impl Future<Output = ()>,
) {
    let inflight: Inflight = Arc::default();
    tokio::pin!(stop);
    loop {
        let frame = tokio::select! {
            frame = input.recv() => frame,
            () = &mut stop => break,
        };
        let line = match frame {
            None => break,
            Some(Frame::TooLong) => {
                let message = format!("A message exceeds {MAX_LINE_BYTES} bytes");
                let _ = output.send(error(&Value::Null, INVALID_REQUEST, &message)).await;
                continue;
            }
            Some(Frame::Line(line)) => line,
        };
        let Ok(message) = serde_json::from_slice::<Value>(&line) else {
            let _ = output.send(error(&Value::Null, PARSE_ERROR, "Invalid JSON")).await;
            continue;
        };
        let method = message.get("method").and_then(Value::as_str);
        let id = message.get("id").cloned();
        // A response to a request of ours: there are none, so it is ignored.
        if method.is_none() && message.is_object() && id.is_some() {
            continue;
        }
        let valid_id = matches!(id, None | Some(Value::Number(_)) | Some(Value::String(_)));
        let (Some(method), true, true) = (method, message["jsonrpc"] == "2.0", valid_id) else {
            let id = id.filter(|_| valid_id).unwrap_or(Value::Null);
            let _ = output.send(error(&id, INVALID_REQUEST, "Not a JSON-RPC 2.0 request")).await;
            continue;
        };
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let Some(id) = id else {
            if method == "notifications/cancelled" {
                let cancelled = inflight
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .remove(&params["requestId"].to_string());
                if let Some(task) = cancelled {
                    task.abort();
                }
            }
            continue;
        };
        match method {
            "initialize" => {
                let _ = output.send(reply(&id, initialize(host.as_ref(), &params))).await;
            }
            "ping" => {
                let _ = output.send(reply(&id, json!({}))).await;
            }
            "tools/list" => {
                let _ = output.send(reply(&id, host.tools())).await;
            }
            "tools/call" => {
                let (name, arguments) = match tool_params(&params) {
                    Ok(call) => call,
                    Err(message) => {
                        let _ = output.send(error(&id, INVALID_PARAMS, message)).await;
                        continue;
                    }
                };
                let host = host.clone();
                let work = async move { host.call(name, arguments).await.map_err(|message| (INVALID_PARAMS, message)) };
                if let Some((code, message)) = spawn_tracked(&inflight, &output, &id, work) {
                    let _ = output.send(error(&id, code, &message)).await;
                }
            }
            _ => {
                let _ = output.send(error(&id, METHOD_NOT_FOUND, "Unknown method")).await;
            }
        }
    }
    for (_, task) in inflight.lock().unwrap_or_else(|error| error.into_inner()).drain() {
        task.abort();
    }
}

/// Serves the tools for the repository `options` names over standard input
/// and output until standard input closes or a shutdown signal; then stops
/// the service's jobs.
pub async fn serve(options: InspectorOptions) -> Result<()> {
    let signals = crate::signals::Shutdown::new().context("Failed to register shutdown signals")?;
    let writer = crate::stdio::protocol_output().context("Cannot prepare standard output")?;
    let service = Arc::new(Service::new(options).await?);
    let agent = Arc::new(Agent {
        views: crate::view::Views::new(service.clone()),
        service: service.clone(),
    });
    let (input, output, written) = crate::stdio::channels(writer);
    session(agent.clone(), input, output, async move {
        if let Err(error) = signals.wait().await {
            eprintln!("projections: {error:#}");
        }
    })
    .await;
    agent.views.close().await;
    service.close().await;
    let _ = tokio::task::spawn_blocking(move || written.join()).await;
    Ok(())
}

#[cfg(test)]
mod tests;
