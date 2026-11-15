//! A running headless browser: launching it, calling DevTools commands, and
//! stopping it with every process it started.

use std::{
    io::Read,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};

use super::{
    LaunchOptions, STDERR_TAIL_BYTES, Transport,
    connection::{Commands, Dispatch, EventHook, Writer},
    switches::arguments,
    websocket::{connect_socket, read_socket},
};
#[cfg(unix)]
use super::{connection::read_pipe, unix};
use crate::supervision::Group;

/// A running headless browser and its DevTools connection.
pub struct Browser {
    child: Child,
    group: Group,
    writer: Arc<Mutex<Option<Writer>>>,
    messages: mpsc::Receiver<Result<Value, String>>,
    next_id: Arc<AtomicU64>,
    hook: Arc<Mutex<Option<EventHook>>>,
    stderr: Arc<Mutex<Vec<u8>>>,
    cancel: Arc<AtomicBool>,
    stopped: bool,
    // Dropped after the browser is stopped, so the profile can be removed.
    profile: tempfile::TempDir,
}

impl Browser {
    /// Starts the browser with a fresh private profile and connects to it.
    pub fn launch(options: LaunchOptions<'_>) -> Result<Self> {
        if cfg!(not(unix)) && options.transport == Transport::Pipe {
            bail!("The DevTools pipe transport is only available on Unix");
        }
        let profile = tempfile::Builder::new()
            .prefix("projections-browser-")
            .tempdir()
            .context("Cannot create a temporary browser profile")?;
        let mut command = Command::new(options.executable);
        command
            .args(arguments(
                profile.path(),
                options.transport,
                options.width,
                options.height,
                options.scale,
            ))
            .env("TZ", "UTC")
            .env("LANG", "en_US.UTF-8")
            .env("LANGUAGE", "en_US")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        let mut group = Group::new()?;
        group.prepare(&mut command);
        #[cfg(unix)]
        let pipes = if options.transport == Transport::Pipe {
            Some(unix::attach(&mut command)?)
        } else {
            None
        };
        let mut child = command
            .spawn()
            .with_context(|| format!("Could not start the browser {}", options.executable.display()))?;
        if let Err(error) = group.adopt(&mut child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        let stderr = Arc::new(Mutex::new(Vec::new()));
        if let Some(mut pipe) = child.stderr.take() {
            let tail = stderr.clone();
            thread::spawn(move || {
                let mut buffer = [0; 4096];
                while let Ok(count) = pipe.read(&mut buffer) {
                    if count == 0 {
                        break;
                    }
                    let mut tail = tail.lock().unwrap_or_else(|error| error.into_inner());
                    tail.extend_from_slice(&buffer[..count]);
                    let excess = tail.len().saturating_sub(STDERR_TAIL_BYTES);
                    tail.drain(..excess);
                }
            });
        }
        let (sender, messages) = mpsc::channel();
        let hook: Arc<Mutex<Option<EventHook>>> = Arc::default();
        let dispatch = Dispatch {
            sender,
            hook: hook.clone(),
        };
        let mut browser = Browser {
            child,
            group,
            writer: Arc::default(),
            messages,
            next_id: Arc::new(AtomicU64::new(1)),
            hook,
            stderr,
            cancel: options.cancel,
            stopped: false,
            profile,
        };
        let deadline = Instant::now() + Duration::from_secs(30);
        let writer = match options.transport {
            #[cfg(unix)]
            Transport::Pipe => {
                let (writer, reader) = pipes.context("Missing DevTools pipes")?.connect();
                thread::spawn(move || read_pipe(reader, dispatch));
                Writer::Pipe(writer)
            }
            #[cfg(not(unix))]
            Transport::Pipe => unreachable!(),
            Transport::Port => {
                let endpoint = browser.active_port(deadline)?;
                let (stream, reader) = connect_socket(&endpoint)?;
                let writer = Arc::new(Mutex::new(stream));
                let pong = writer.clone();
                thread::spawn(move || read_socket(reader, pong, dispatch));
                Writer::Socket(writer)
            }
        };
        *browser.writer.lock().unwrap_or_else(|error| error.into_inner()) = Some(writer);
        browser
            .call("Browser.getVersion", json!({}), None, deadline)
            .context("The browser did not answer on its DevTools connection")?;
        Ok(browser)
    }

    /// The `ws://` endpoint the browser writes to `DevToolsActivePort`.
    fn active_port(&mut self, deadline: Instant) -> Result<(u16, String)> {
        let file = self.profile.path().join("DevToolsActivePort");
        loop {
            if let Ok(text) = std::fs::read_to_string(&file) {
                let mut lines = text.lines();
                if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                    let port = port.trim().parse::<u16>().context("Invalid DevToolsActivePort")?;
                    let path = path.trim();
                    ensure!(
                        path.starts_with("/devtools/browser/") && path.bytes().all(|byte| byte.is_ascii_graphic()),
                        "Invalid DevToolsActivePort"
                    );
                    return Ok((port, path.to_owned()));
                }
            }
            self.check_alive()?;
            ensure!(
                Instant::now() < deadline,
                "The browser did not open its DevTools endpoint{}",
                self.diagnostics()
            );
            thread::sleep(Duration::from_millis(50));
        }
    }

    fn check_alive(&mut self) -> Result<()> {
        if self.cancel.load(Ordering::SeqCst) {
            bail!("Cancelled");
        }
        if let Some(status) = self.child.try_wait()? {
            bail!("The browser exited ({status}) before the snapshot was taken{}", self.diagnostics());
        }
        Ok(())
    }

    /// The tail of the browser's standard error, for failure messages.
    fn diagnostics(&self) -> String {
        let tail = self.stderr.lock().unwrap_or_else(|error| error.into_inner());
        let text = String::from_utf8_lossy(&tail);
        let text = text.trim();
        if text.is_empty() {
            String::new()
        } else {
            format!(". Browser output:\n{text}")
        }
    }

    /// Sends one DevTools command (to `session`, or the browser) and waits for its result.
    pub fn call(&mut self, method: &str, params: Value, session: Option<&str>, deadline: Instant) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let mut message = json!({"id": id, "method": method, "params": params});
        if let Some(session) = session {
            message["sessionId"] = json!(session);
        }
        let text = serde_json::to_string(&message)?;
        let sent = match self.writer.lock().unwrap_or_else(|error| error.into_inner()).as_mut() {
            Some(writer) => writer.send(&text),
            None => bail!("Not connected"),
        };
        if let Err(error) = sent {
            bail!("Cannot send {method} to the browser: {error}{}", self.diagnostics());
        }
        loop {
            if self.cancel.load(Ordering::SeqCst) {
                bail!("Cancelled");
            }
            let now = Instant::now();
            if now >= deadline {
                bail!("The browser did not answer {method} in time");
            }
            match self.messages.recv_timeout((deadline - now).min(Duration::from_millis(100))) {
                Ok(Ok(value)) if value["id"] == id => {
                    if let Some(error) = value.get("error") {
                        bail!("{method} failed: {}", error["message"].as_str().unwrap_or("unknown error"));
                    }
                    return Ok(value["result"].clone());
                }
                Ok(Ok(_event)) => {}
                Ok(Err(error)) => bail!("{error}{}", self.diagnostics()),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    let _ = self.child.try_wait();
                    bail!("The browser closed its DevTools connection{}", self.diagnostics());
                }
            }
        }
    }

    /// Handles the browser's events on the connection's reader thread instead
    /// of discarding them; `hook` must not block.
    pub fn on_events(&self, hook: impl Fn(Value) + Send + 'static) {
        *self.hook.lock().unwrap_or_else(|error| error.into_inner()) = Some(Box::new(hook));
    }

    /// A handle that sends commands without waiting, for answering events.
    pub fn commands(&self) -> Commands {
        Commands {
            writer: self.writer.clone(),
            next_id: self.next_id.clone(),
        }
    }

    /// Asks the browser to close, then stops every process it started.
    pub fn close(mut self) -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(2);
        let _ = self.call("Browser.close", json!({}), None, deadline);
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        self.stop()
    }

    fn stop(&mut self) -> Result<()> {
        if self.stopped {
            return Ok(());
        }
        self.stopped = true;
        *self.hook.lock().unwrap_or_else(|error| error.into_inner()) = None;
        *self.writer.lock().unwrap_or_else(|error| error.into_inner()) = None;
        let stopped = self.group.stop(&mut self.child);
        let _ = self.child.kill();
        let _ = self.child.wait();
        stopped.and(self.group.drain())
    }
}

impl Drop for Browser {
    fn drop(&mut self) {
        let _ = self.stop();
        remove_profile(self.profile.path());
    }
}

/// Removes a stopped browser's profile. Windows releases the files of a stopped
/// process tree a moment after it exits, so removal is retried for up to two
/// seconds there; the `TempDir` removes whatever is left on drop.
fn remove_profile(path: &std::path::Path) {
    let attempts = if cfg!(windows) { 40 } else { 1 };
    for attempt in 0..attempts {
        match std::fs::remove_dir_all(path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound && attempt + 1 < attempts => {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            _ => return,
        }
    }
}
