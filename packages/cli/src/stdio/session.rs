//! A protocol session: frames in, one reply line per request out, each
//! request answered in its own task so it can be cancelled.

use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex},
};

use serde_json::Value;
use tokio::{sync::mpsc, task::AbortHandle};

use super::{
    INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, MAX_INFLIGHT, MAX_LINE_BYTES, METHOD_NOT_FOUND, PARSE_ERROR, REQUEST_CANCELLED,
    SERVER_BUSY,
    backend::{Backend, encode, request_params, tool_params},
    error,
    frame::Frame,
    reply,
};

/// Requests being answered, by their ID's JSON text.
pub(crate) type Inflight = Arc<Mutex<HashMap<String, AbortHandle>>>;

/// Runs request `id`'s `work` in its own task, listed in `inflight` so it can
/// be cancelled, and replies with its result unless it was cancelled
/// meanwhile. Returns the error to reply with instead when a request with
/// this `id` is running or too many are.
pub(crate) fn spawn_tracked(
    inflight: &Inflight,
    output: &mpsc::Sender<String>,
    id: &Value,
    work: impl Future<Output = Result<Value, (i64, String)>> + Send + 'static,
) -> Option<(i64, String)> {
    let key = id.to_string();
    let mut tasks = inflight.lock().unwrap_or_else(|error| error.into_inner());
    if tasks.contains_key(&key) {
        return Some((INVALID_REQUEST, "A request with this id is running".to_owned()));
    }
    if tasks.len() >= MAX_INFLIGHT {
        return Some((SERVER_BUSY, format!("At most {MAX_INFLIGHT} requests run at once")));
    }
    let (output, listing, id, task_key) = (output.clone(), inflight.clone(), id.clone(), key.clone());
    // Spawned while the map is locked, so it can't finish before it is listed.
    let task = tokio::spawn(async move {
        let result = work.await;
        let listed = listing
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&task_key)
            .is_some();
        if listed {
            let line = match result {
                Ok(value) => reply(&id, value),
                Err((code, message)) => error(&id, code, &message),
            };
            let _ = output.send(line).await;
        }
    });
    tasks.insert(key, task.abort_handle());
    None
}

/// Why a session ended.
#[derive(Debug, PartialEq)]
pub(super) enum End {
    /// Standard input closed.
    Closed,
    /// `exit`.
    Exit,
    /// A shutdown signal (or `stop` resolved).
    Stopped,
}

/// Answers frames until the input ends, `exit`, or `stop`. Each request runs
/// in its own task; replies go to `output`, one line each.
pub(super) async fn session<B: Backend>(
    backend: Arc<B>,
    mut input: mpsc::Receiver<Frame>,
    output: mpsc::Sender<String>,
    stop: impl Future<Output = ()>,
) -> End {
    let inflight: Inflight = Arc::default();
    let mut shut_down = false;
    tokio::pin!(stop);
    let end = loop {
        let frame = tokio::select! {
            frame = input.recv() => frame,
            () = &mut stop => break End::Stopped,
        };
        let line = match frame {
            None => break End::Closed,
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
        let id = message.get("id").cloned();
        let valid_id = matches!(id, None | Some(Value::Number(_)) | Some(Value::String(_)) | Some(Value::Null));
        let method = message.get("method").and_then(Value::as_str);
        let (Some(method), true, true) = (method, message["jsonrpc"] == "2.0", valid_id) else {
            let id = id.filter(|_| valid_id).unwrap_or(Value::Null);
            let _ = output.send(error(&id, INVALID_REQUEST, "Not a JSON-RPC 2.0 request")).await;
            continue;
        };
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        // A notification: no reply.
        let Some(id) = id else {
            match method {
                "exit" => break End::Exit,
                "$/cancelRequest" => {
                    let key = params["id"].to_string();
                    let cancelled = inflight.lock().unwrap_or_else(|error| error.into_inner()).remove(&key);
                    if let Some(task) = cancelled {
                        task.abort();
                        let _ = output.send(error(&params["id"], REQUEST_CANCELLED, "Request cancelled")).await;
                    }
                }
                _ => {}
            }
            continue;
        };
        match method {
            "initialize" => {
                let _ = output.send(reply(&id, backend.initialize())).await;
            }
            "shutdown" => {
                shut_down = true;
                let _ = output.send(reply(&id, Value::Null)).await;
            }
            "exit" => {
                let _ = output.send(reply(&id, Value::Null)).await;
                break End::Exit;
            }
            "request" if shut_down => {
                let _ = output.send(error(&id, INVALID_REQUEST, "The backend is shutting down")).await;
            }
            "request" => {
                let (method, path, body) = match request_params(&params) {
                    Ok(request) => request,
                    Err(message) => {
                        let _ = output.send(error(&id, INVALID_PARAMS, message)).await;
                        continue;
                    }
                };
                let backend = backend.clone();
                let work = async move {
                    match backend.request(method, path, body).await {
                        Ok(response) => encode(response).await.map_err(|message| (INTERNAL_ERROR, message)),
                        Err(failure) => Err((INTERNAL_ERROR, format!("{failure:#}"))),
                    }
                };
                if let Some((code, message)) = spawn_tracked(&inflight, &output, &id, work) {
                    let _ = output.send(error(&id, code, &message)).await;
                }
            }
            "tools/list" => {
                let _ = output.send(reply(&id, backend.tools())).await;
            }
            "tools/call" if shut_down => {
                let _ = output.send(error(&id, INVALID_REQUEST, "The backend is shutting down")).await;
            }
            "tools/call" => {
                let (name, arguments) = match tool_params(&params) {
                    Ok(call) => call,
                    Err(message) => {
                        let _ = output.send(error(&id, INVALID_PARAMS, message)).await;
                        continue;
                    }
                };
                let backend = backend.clone();
                let work = async move {
                    backend
                        .call_tool(name, arguments)
                        .await
                        .map_err(|message| (INVALID_PARAMS, message))
                };
                if let Some((code, message)) = spawn_tracked(&inflight, &output, &id, work) {
                    let _ = output.send(error(&id, code, &message)).await;
                }
            }
            _ => {
                let _ = output.send(error(&id, METHOD_NOT_FOUND, "Unknown method")).await;
            }
        }
    };
    for (_, task) in inflight.lock().unwrap_or_else(|error| error.into_inner()).drain() {
        task.abort();
    }
    end
}
