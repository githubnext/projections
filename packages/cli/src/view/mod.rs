//! `projections view`: the agent viewer. One page on loopback that a coding
//! agent drives and a person watches (see `docs/design/agent-viewer.md`).
//!
//! The server is a thin listener in front of the CLI service
//! ([`crate::service::Service`]): every path starts with a random session
//! token, requests whose `Host` isn't loopback are refused, and only the
//! service's read routes and extraction jobs are forwarded. The server owns the
//! view state ([`state::ViewState`]); pages long-poll it (`TOKEN/view/state`)
//! and report the person's selection, mode and what they present
//! (`TOKEN/view/report`). Agents drive it through `TOKEN/control/…`, which
//! answer as the view tools do.

pub mod client;
mod pages;
pub mod registry;
mod routes;
mod show;
pub mod state;
pub mod surface;
mod tasks;

pub use surface::Views;

use std::{
    collections::HashMap,
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::{Context as _, Result};
use axum::{Router, body::to_bytes, http::Method};
use rand::RngCore;
use serde_json::Value;
use tokio::sync::watch;

use crate::service::Service;
use pages::control_state;
use show::show;
use state::ViewState;

/// The page's policy: the Inspector's, except that it may be framed (the
/// Copilot app shows it in a canvas). Framing grants nothing: the page has no
/// writes, and a framer must already know the token.
pub const VIEWER_CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' http://localhost:* http://127.0.0.1:*; base-uri 'self'";
/// A page that hasn't asked for the state for this long is gone.
const PAGE_GONE: Duration = Duration::from_secs(45);
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
/// How long a stopping viewer lets its open requests finish: a page's event streams never do on their own.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);

pub struct ViewerOptions {
    /// 0 for any free port.
    pub port: u16,
    /// Stop after this long with no page and no control call.
    pub idle: Option<Duration>,
    /// The revision whose definition extracts every side; the working tree's by default.
    pub definition_revision: Option<String>,
    /// The session token, to keep a replaced viewer's URL (see `Record::address`); a new random one by default.
    pub token: Option<String>,
}

struct Shared {
    service: Arc<Service>,
    token: String,
    port: u16,
    /// This server's own random name: a page that reconnects to another server at the same URL (one started with
    /// --trust replacing it) loads afresh, rather than keep what it learned from the last one.
    instance: String,
    state: watch::Sender<ViewState>,
    /// Each open page's last request, and what it last reported: its generation, selection and mode.
    pages: Mutex<HashMap<String, (Instant, Value)>>,
    /// The latest report from any page: what the person sees.
    shown: Mutex<Option<(Instant, Value)>>,
    activity: Mutex<Instant>,
    closing: watch::Sender<bool>,
    /// The shown projection's custom renderer build phase, and a version bumped when it changes: the page's status
    /// line, sent with the state so a page holds one long poll, not one per subject.
    build: watch::Sender<(u64, Option<&'static str>)>,
}

impl Shared {
    fn touch(&self) {
        *self.activity.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
    }

    fn pages(&self) -> usize {
        let mut pages = self.pages.lock().unwrap_or_else(|e| e.into_inner());
        pages.retain(|_, (seen, _)| seen.elapsed() < PAGE_GONE);
        pages.len()
    }
}

/// A running viewer.
pub struct Viewer {
    shared: Arc<Shared>,
    url: String,
    server: Option<tokio::task::JoinHandle<()>>,
}

impl Viewer {
    /// Serves the viewer for `service` on loopback, from within a Tokio runtime.
    pub fn start(service: Arc<Service>, options: ViewerOptions) -> Result<Self> {
        let listener = std::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, options.port)))
            .with_context(|| format!("Cannot listen on 127.0.0.1:{}", options.port))?;
        listener.set_nonblocking(true)?;
        let listener = tokio::net::TcpListener::from_std(listener)?;
        let port = listener.local_addr()?.port();
        let token = options.token.clone().unwrap_or_else(|| {
            let mut bytes = [0u8; 32];
            rand::rng().fill_bytes(&mut bytes);
            bytes.iter().map(|byte| format!("{byte:02x}")).collect()
        });
        let mut instance = [0u8; 8];
        rand::rng().fill_bytes(&mut instance);
        let shared = Arc::new(Shared {
            service,
            token: token.clone(),
            port,
            instance: instance.iter().map(|byte| format!("{byte:02x}")).collect(),
            state: watch::Sender::new(ViewState {
                definition_revision: options.definition_revision.clone(),
                ..ViewState::default()
            }),
            pages: Mutex::new(HashMap::new()),
            shown: Mutex::new(None),
            activity: Mutex::new(Instant::now()),
            closing: watch::Sender::new(false),
            build: watch::Sender::new((0, None)),
        });
        let router = Router::new().fallback(routes::route).with_state(shared.clone());
        let mut closing = shared.closing.subscribe();
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = closing.wait_for(|closing| *closing).await;
                })
                .await;
        });
        tasks::track_builds(&shared);
        tasks::rebuild_on_save(&shared);
        if let Some(idle) = options.idle {
            tasks::stop_when_idle(&shared, idle);
        }
        Ok(Self {
            url: format!("http://127.0.0.1:{port}/{token}/"),
            shared,
            server: Some(server),
        })
    }

    /// The page's URL, with its token.
    pub fn url(&self) -> &str {
        &self.url
    }

    /// The repository it shows.
    pub fn repository(&self) -> PathBuf {
        self.shared.service.repository().to_path_buf()
    }

    pub fn state(&self) -> ViewState {
        self.shared.state.borrow().clone()
    }

    /// Shows a projection, as `open_projection` asks; returns the new state.
    pub async fn show(&self, input: &Value) -> Result<ViewState, String> {
        show(&self.shared, input).await
    }

    /// Waits until it is asked to stop (when idle, by `control/stop`, or on [`Viewer::close`]) or its server ends.
    pub async fn stopped(&mut self) {
        let mut closing = self.shared.closing.subscribe();
        let ended = match &mut self.server {
            Some(server) => tokio::select! {
                _ = closing.wait_for(|closing| *closing) => false,
                _ = server => true,
            },
            None => false,
        };
        if ended {
            self.server = None;
        }
    }

    /// Whether it has been asked to stop.
    pub fn closing(&self) -> bool {
        *self.shared.closing.borrow()
    }

    /// Stops it: open requests get a moment to finish, then the server ends, so the port is free when this returns.
    pub async fn close(mut self) {
        stop(&self.shared);
        if let (Some(builds), Some(projection)) = (self.shared.service.renderer_builds(), self.shared.state.borrow().projection.clone()) {
            builds.stop(&projection);
        }
        if let Some(mut server) = self.server.take()
            && tokio::time::timeout(SHUTDOWN_GRACE, &mut server).await.is_err()
        {
            server.abort();
            let _ = server.await;
        }
    }
}

/// The page's URL, with its token.
fn url(shared: &Shared) -> String {
    format!("http://127.0.0.1:{}/{}/", shared.port, shared.token)
}

/// Stops the server, whether or not its shutdown is being awaited yet.
fn stop(shared: &Shared) {
    shared.closing.send_replace(true);
}

/// A service route's JSON answer, or the message it refused with.
async fn get(service: &Service, path: &str) -> Result<Value, String> {
    let response = service.call(Method::GET, path, None).await.map_err(|error| format!("{error:#}"))?;
    let status = response.status();
    let bytes = to_bytes(response.into_body(), MAX_RESPONSE_BYTES)
        .await
        .map_err(|_| "The Projections service's answer is too large".to_owned())?;
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    if status.is_success() {
        Ok(body)
    } else {
        Err(body["diagnostics"][0]["message"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| format!("The Projections service refused ({status})")))
    }
}

#[cfg(test)]
mod tests;
