//! The DevTools connection: sending commands, and delivering the messages a
//! reader thread receives.

#[cfg(unix)]
use std::io::{BufRead, BufReader, Read, Write};
use std::{
    io,
    net::TcpStream,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
};

use anyhow::{Context, Result};
use serde_json::{Value, json};

#[cfg(unix)]
use super::MAX_MESSAGE_BYTES;
use super::websocket::write_frame;

pub(super) enum Writer {
    #[cfg(unix)]
    Pipe(std::fs::File),
    Socket(Arc<Mutex<TcpStream>>),
}

impl Writer {
    pub(super) fn send(&mut self, text: &str) -> io::Result<()> {
        match self {
            #[cfg(unix)]
            Writer::Pipe(file) => {
                let mut bytes = Vec::with_capacity(text.len() + 1);
                bytes.extend_from_slice(text.as_bytes());
                bytes.push(0);
                file.write_all(&bytes)
            }
            Writer::Socket(stream) => {
                let mut stream = stream.lock().unwrap_or_else(|error| error.into_inner());
                write_frame(&mut *stream, 0x1, text.as_bytes())
            }
        }
    }
}

/// Handles DevTools events on the connection's reader thread (see `Browser::on_events`).
pub(super) type EventHook = Box<dyn Fn(Value) + Send>;

/// Where the reader threads deliver messages: command results to `call`, and
/// events to the hook when one is installed.
#[derive(Clone)]
pub(super) struct Dispatch {
    pub(super) sender: mpsc::Sender<Result<Value, String>>,
    pub(super) hook: Arc<Mutex<Option<EventHook>>>,
}

impl Dispatch {
    /// Delivers one message; false once nothing receives them.
    pub(super) fn deliver(&self, message: Result<Value, String>) -> bool {
        if let Ok(event) = &message
            && event.get("method").is_some()
        {
            let hook = self.hook.lock().unwrap_or_else(|error| error.into_inner());
            if let Some(hook) = hook.as_ref() {
                hook(event.clone());
                return true;
            }
        }
        self.sender.send(message).is_ok()
    }
}

/// Sends DevTools commands without waiting for their results, from any thread
/// (for example in answer to events).
#[derive(Clone)]
pub struct Commands {
    pub(super) writer: Arc<Mutex<Option<Writer>>>,
    pub(super) next_id: Arc<AtomicU64>,
}

impl Commands {
    pub fn send(&self, method: &str, params: Value, session: Option<&str>) -> Result<()> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let mut message = json!({"id": id, "method": method, "params": params});
        if let Some(session) = session {
            message["sessionId"] = json!(session);
        }
        let text = serde_json::to_string(&message)?;
        let mut writer = self.writer.lock().unwrap_or_else(|error| error.into_inner());
        writer
            .as_mut()
            .context("Not connected")?
            .send(&text)
            .with_context(|| format!("Cannot send {method} to the browser"))
    }
}

pub(super) fn parse_message(bytes: &[u8]) -> Result<Value, String> {
    serde_json::from_slice(bytes).map_err(|_| "The browser sent an invalid DevTools message".to_owned())
}

#[cfg(unix)]
pub(super) fn read_pipe(reader: std::fs::File, dispatch: Dispatch) {
    let mut reader = BufReader::with_capacity(1 << 16, reader);
    loop {
        let mut message = Vec::new();
        match (&mut reader).take(MAX_MESSAGE_BYTES as u64 + 1).read_until(0, &mut message) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if message.last() != Some(&0) {
            let _ = dispatch
                .sender
                .send(Err("The browser sent an oversized DevTools message".to_owned()));
            return;
        }
        message.pop();
        if !dispatch.deliver(parse_message(&message)) {
            return;
        }
    }
}
