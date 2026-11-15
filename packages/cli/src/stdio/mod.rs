//! `projections serve --stdio`: the Inspector API as JSON-RPC 2.0 over
//! standard input and output, one JSON message per line, for an editor
//! extension that starts the CLI. It answers through the same router as the
//! HTTP Inspector ([`crate::service::Service`]), so there is no port, token
//! or listener. Standard output carries only protocol messages; diagnostics go
//! to standard error. See `docs/runner/stdio-backend.md`.

mod backend;
mod frame;
mod session;

use std::{
    io::{self, Write},
    sync::Arc,
};

use anyhow::{Context, Result};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::service::{InspectorOptions, Service};
use session::{End, session};

pub(crate) use backend::tool_params;
#[cfg(test)]
use backend::{Backend, encode, request_params};
pub(crate) use frame::{Frame, read_frame};
pub(crate) use session::{Inflight, spawn_tracked};

/// The protocol version `initialize` reports.
pub const PROTOCOL: u64 = 1;
/// The longest request line accepted, in bytes.
pub const MAX_LINE_BYTES: usize = 1024 * 1024;
/// The largest response body relayed, in bytes (before base64).
pub const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
/// Requests answered at once.
const MAX_INFLIGHT: usize = 64;

pub(crate) const PARSE_ERROR: i64 = -32700;
pub(crate) const INVALID_REQUEST: i64 = -32600;
pub(crate) const METHOD_NOT_FOUND: i64 = -32601;
pub(crate) const INVALID_PARAMS: i64 = -32602;
pub(crate) const INTERNAL_ERROR: i64 = -32603;
const SERVER_BUSY: i64 = -32000;
const REQUEST_CANCELLED: i64 = -32800;

/// Whether `path` is a server-relative path the backend answers: under
/// `/api/`, `/renderers/`, `/custom-renderers/` or `/inspector/`, with no fragment,
/// backslash, `.` or `..` segment or control character (as the Inspector's
/// `isApiPath`).
pub fn valid_path(path: &str) -> bool {
    let route = path.split('?').next().unwrap_or_default();
    path.len() <= 4096
        && ["/api/", "/renderers/", "/custom-renderers/", "/inspector/"]
            .iter()
            .any(|prefix| path.starts_with(prefix))
        && !path.contains(['#', '\\'])
        && !route.split('/').any(|part| part == "." || part == "..")
        && !path.chars().any(|character| character.is_ascii_control())
}

pub(crate) fn reply(id: &Value, result: Value) -> String {
    json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string()
}

pub(crate) fn error(id: &Value, code: i64, message: &str) -> String {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}).to_string()
}

/// The original standard output, for protocol messages only. On Unix file
/// descriptor 1 is pointed at standard error, so nothing else written to
/// standard output (by this process or a child) can corrupt the protocol.
pub(crate) fn protocol_output() -> io::Result<Box<dyn Write + Send>> {
    io::stdout().flush()?;
    #[cfg(unix)]
    {
        use std::os::fd::FromRawFd;
        // SAFETY: plain descriptor duplication; the duplicate is owned by the File.
        unsafe {
            let protocol = libc::fcntl(1, libc::F_DUPFD_CLOEXEC, 3);
            if protocol < 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::dup2(2, 1) < 0 {
                let error = io::Error::last_os_error();
                libc::close(protocol);
                return Err(error);
            }
            Ok(Box::new(std::fs::File::from_raw_fd(protocol)))
        }
    }
    #[cfg(not(unix))]
    Ok(Box::new(io::stdout()))
}

/// Standard input as frames and `writer` as lines, each on its own blocking
/// thread, so the runtime never waits for a read of standard input at exit.
/// Join the returned thread once the output sender is dropped, to flush it.
pub(crate) fn channels(mut writer: Box<dyn Write + Send>) -> (mpsc::Receiver<Frame>, mpsc::Sender<String>, std::thread::JoinHandle<()>) {
    let (output, mut lines) = mpsc::channel::<String>(256);
    let written = std::thread::spawn(move || {
        while let Some(line) = lines.blocking_recv() {
            if writer
                .write_all(line.as_bytes())
                .and_then(|()| writer.write_all(b"\n"))
                .and_then(|()| writer.flush())
                .is_err()
            {
                return;
            }
        }
    });
    let (frames, input) = mpsc::channel::<Frame>(64);
    std::thread::spawn(move || {
        let stdin = io::stdin();
        let mut reader = stdin.lock();
        while let Ok(Some(frame)) = read_frame(&mut reader, MAX_LINE_BYTES) {
            if frames.blocking_send(frame).is_err() {
                return;
            }
        }
    });
    (input, output, written)
}

/// Serves `options` (repository mode) over standard input and output until
/// standard input closes, `exit`, or a shutdown signal; then stops its jobs.
pub async fn serve(options: InspectorOptions) -> Result<()> {
    let signals = crate::signals::Shutdown::new().context("Failed to register shutdown signals")?;
    let writer = protocol_output().context("Cannot prepare standard output")?;
    let service = Arc::new(Service::new(options).await?);
    let (input, output, written) = channels(writer);
    let notifications = service.changes().map(|mut changes| {
        let output = output.clone();
        tokio::spawn(async move {
            while let Some(params) = changes.next().await {
                let message = json!({"jsonrpc": "2.0", "method": "changes", "params": params});
                if output.send(message.to_string()).await.is_err() {
                    return;
                }
            }
        })
    });
    // Renderer builds: their state and new output lines, for the editor's task terminals and Problems.
    let builds = service.renderer_builds().map(|builds| {
        let output = output.clone();
        tokio::spawn(async move {
            let mut changes = builds.subscribe();
            let mut since = *changes.borrow_and_update();
            while changes.changed().await.is_ok() {
                // Changes in a burst (a build's output) are sent together.
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                changes.borrow_and_update();
                let params = builds.snapshot(since);
                since = params["sequence"].as_u64().unwrap_or(since);
                let message = json!({"jsonrpc": "2.0", "method": "rendererBuilds", "params": params});
                if output.send(message.to_string()).await.is_err() {
                    return;
                }
            }
        })
    });
    let end = session(service.clone(), input, output, async move {
        if let Err(error) = signals.wait().await {
            eprintln!("projections: {error:#}");
        }
    })
    .await;
    if end == End::Stopped {
        eprintln!("projections: stopping");
    }
    for task in [notifications, builds].into_iter().flatten() {
        task.abort();
        let _ = task.await;
    }
    service.close().await;
    let _ = tokio::task::spawn_blocking(move || written.join()).await;
    Ok(())
}

#[cfg(test)]
mod tests;
