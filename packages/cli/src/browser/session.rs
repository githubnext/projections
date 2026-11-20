//! A running headless browser: launching it, calling DevTools commands, and
//! stopping it with every process it started.

use std::{
    io::Read,
    path::PathBuf,
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
    gate,
    switches::arguments,
    websocket::{connect_socket, read_socket},
};
#[cfg(unix)]
use super::{connection::read_pipe, unix};
use crate::supervision::Group;

/// The DevTools pipes the browser was started with (Unix only).
#[cfg(unix)]
type Pipes = Option<unix::Pipes>;
#[cfg(not(unix))]
type Pipes = ();

/// What connecting to a started browser needs.
struct Pending {
    pipes: Pipes,
    sender: mpsc::Sender<Result<Value, String>>,
}

/// How a browser was launched: a reused one must have been launched the same way.
#[derive(Clone, PartialEq, Debug)]
pub(super) struct Launched {
    executable: PathBuf,
    transport: Transport,
    width: u32,
    height: u32,
    scale: f64,
}

impl Launched {
    pub(super) fn of(options: &LaunchOptions<'_>) -> Self {
        Self {
            executable: options.executable.to_path_buf(),
            transport: options.transport,
            width: options.width,
            height: options.height,
            scale: options.scale,
        }
    }
}

#[cfg(unix)]
fn signalled(status: std::process::ExitStatus) -> bool {
    use std::os::unix::process::ExitStatusExt;
    status.signal().is_some()
}

#[cfg(not(unix))]
fn signalled(_: std::process::ExitStatus) -> bool {
    false
}

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
    pub(super) launched: Launched,
    stopped: bool,
    // Dropped after the browser is stopped, so the profile can be removed.
    profile: tempfile::TempDir,
}

impl Browser {
    /// Starts the browser with a fresh private profile and connects to it. At
    /// most a few browsers start at once on this machine (see `gate`), and one
    /// that aborts before its DevTools connection answers is started once more.
    pub fn launch(options: LaunchOptions<'_>) -> Result<Self> {
        if cfg!(not(unix)) && options.transport == Transport::Pipe {
            bail!("The DevTools pipe transport is only available on Unix");
        }
        let _slot = gate::acquire(&options.cancel)?;
        let mut retried = false;
        loop {
            let (mut browser, pending) = Self::spawn(&options)?;
            match browser.connect(pending, options.transport, options.startup) {
                Ok(()) => return Ok(browser),
                Err(_) if !retried && browser.aborted() => retried = true,
                Err(error) if retried => return Err(error.context("The browser was started again after it aborted while starting")),
                Err(error) => return Err(error),
            }
        }
    }

    /// Starts the browser process; [`Browser::connect`] then reaches it.
    fn spawn(options: &LaunchOptions<'_>) -> Result<(Self, Pending)> {
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
        #[cfg(not(unix))]
        let pipes = ();
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
        let browser = Browser {
            child,
            group,
            writer: Arc::default(),
            messages,
            next_id: Arc::new(AtomicU64::new(1)),
            hook: Arc::default(),
            stderr,
            cancel: options.cancel.clone(),
            launched: Launched::of(options),
            stopped: false,
            profile,
        };
        Ok((browser, Pending { pipes, sender }))
    }

    /// Connects to the started browser and waits, at most `startup`, until it answers.
    fn connect(&mut self, pending: Pending, transport: Transport, startup: Duration) -> Result<()> {
        let deadline = Instant::now() + startup;
        let Pending { pipes, sender } = pending;
        #[cfg(not(unix))]
        let () = pipes;
        let dispatch = Dispatch {
            sender,
            hook: self.hook.clone(),
        };
        let writer = match transport {
            #[cfg(unix)]
            Transport::Pipe => {
                let (writer, reader) = pipes.context("Missing DevTools pipes")?.connect();
                thread::spawn(move || read_pipe(reader, dispatch));
                Writer::Pipe(writer)
            }
            #[cfg(not(unix))]
            Transport::Pipe => unreachable!(),
            Transport::Port => {
                let endpoint = self.active_port(deadline, startup)?;
                let (stream, reader) = connect_socket(&endpoint)?;
                let writer = Arc::new(Mutex::new(stream));
                let pong = writer.clone();
                thread::spawn(move || read_socket(reader, pong, dispatch));
                Writer::Socket(writer)
            }
        };
        *self.writer.lock().unwrap_or_else(|error| error.into_inner()) = Some(writer);
        self.call("Browser.getVersion", json!({}), None, deadline).with_context(|| {
            format!(
                "The browser did not answer on its DevTools connection within {} s",
                startup.as_secs()
            )
        })?;
        Ok(())
    }

    /// Whether the browser, its connection having failed, was ended by a signal
    /// (on macOS, an abort while registering with the window server) rather
    /// than exiting, being cancelled or still running.
    fn aborted(&mut self) -> bool {
        if self.cancel.load(Ordering::SeqCst) {
            return false;
        }
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            match self.child.try_wait() {
                Ok(Some(status)) => return signalled(status),
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
                _ => return false,
            }
        }
    }

    /// The `ws://` endpoint the browser writes to `DevToolsActivePort`.
    fn active_port(&mut self, deadline: Instant, startup: Duration) -> Result<(u16, String)> {
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
                "The browser did not open its DevTools endpoint within {} s{}",
                startup.as_secs(),
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
                bail!("The browser did not answer {method} in time{}", self.diagnostics());
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

    /// Whether the browser is still running.
    pub(super) fn running(&mut self) -> bool {
        !self.stopped && matches!(self.child.try_wait(), Ok(None))
    }

    /// Cancels waits with `cancel` from now on, for a reused browser's next render.
    pub(super) fn set_cancel(&mut self, cancel: Arc<AtomicBool>) {
        self.cancel = cancel;
    }

    /// Discards the browser's events again.
    pub(super) fn clear_events(&self) {
        *self.hook.lock().unwrap_or_else(|error| error.into_inner()) = None;
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
