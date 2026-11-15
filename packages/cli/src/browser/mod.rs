//! An installed Chrome, Chromium or Microsoft Edge, driven headless over the
//! Chrome DevTools Protocol with a minimal client. Nothing is downloaded or
//! bundled: the browser is the person's own, found with `--browser`,
//! `PROJECTIONS_BROWSER` or the usual install locations.
//!
//! On Unix the protocol runs over `--remote-debugging-pipe` (NUL-delimited JSON
//! on file descriptors 3 and 4), so no port is opened that another local user
//! could connect to. Windows can't pass extra descriptors with the standard
//! library, so there the browser listens on an ephemeral loopback port that it
//! writes to the private profile's `DevToolsActivePort`, and the client speaks
//! WebSocket to it. The browser runs in its own process group (Unix) or Job
//! Object (Windows) and is stopped with every process it started, and its
//! temporary profile removed, on every exit path.

mod base64;
mod connection;
mod locate;
mod session;
mod switches;
#[cfg(unix)]
mod unix;
mod websocket;

use std::{
    path::Path,
    sync::{Arc, atomic::AtomicBool},
};

pub use base64::{base64_decode, base64_encode};
pub use connection::Commands;
pub use locate::find;
pub use session::Browser;

/// The largest protocol message accepted, enough for a full-size screenshot.
const MAX_MESSAGE_BYTES: usize = 256 * 1024 * 1024;
const STDERR_TAIL_BYTES: usize = 4096;

/// How the client reaches the browser's DevTools endpoint.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Transport {
    /// `--remote-debugging-pipe` on descriptors 3 and 4 (Unix only).
    Pipe,
    /// `--remote-debugging-port=0` on loopback, discovered from the private profile.
    Port,
}

impl Default for Transport {
    fn default() -> Self {
        if cfg!(unix) { Transport::Pipe } else { Transport::Port }
    }
}

/// What the browser is launched with.
pub struct LaunchOptions<'a> {
    pub executable: &'a Path,
    pub transport: Transport,
    /// The window size, in CSS pixels.
    pub width: u32,
    pub height: u32,
    /// Device pixels per CSS pixel in every frame, including out-of-process ones (sandboxed renderer frames).
    pub scale: f64,
    /// Cancels waits (for example on Ctrl+C), so the browser is still stopped.
    pub cancel: Arc<AtomicBool>,
}

#[cfg(test)]
mod tests;
