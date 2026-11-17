//! `projections view`: the agent viewer. One page on loopback that a coding
//! agent drives and a person watches (see `docs/design/agent-viewer.md`).
//!
//! The server is a thin listener in front of the CLI service
//! ([`crate::service::Service`]): every path starts with a random session
//! token, requests whose `Host` isn't loopback are refused, and only the
//! service's read routes and extraction jobs are forwarded. The server owns the
//! view state ([`state::ViewState`]) of each of its viewers: the default one
//! and those an agent names ([`named`]), each its own page
//! (`TOKEN/?viewer=NAME`). Pages long-poll their viewer's state
//! (`TOKEN/view/state`), report the person's selection, mode and what they
//! present (`TOKEN/view/report`), and switch it to the projection the person
//! picks from the title (`TOKEN/view/choose`). Agents drive it through
//! `TOKEN/control/…`, which answer as the view tools do.

pub mod client;
mod named;
mod pages;
pub mod registry;
mod routes;
mod show;
pub mod state;
pub mod surface;
mod tasks;

pub use named::{DEFAULT_VIEWER, viewer_name};
pub use surface::Views;

use std::{
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
use named::{NamedView, NamedViews};
use pages::control_state;
use show::show;
use state::{Chooser, ViewState};

/// The page's policy: the Inspector's, except that it may be framed (the
/// Copilot app shows it in a canvas). Framing grants nothing: the page has no
/// writes, and a framer must already know the token.
pub const VIEWER_CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' http://localhost:* http://127.0.0.1:*; base-uri 'self'";
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
    /// Its viewers, by name: the default one, and those an agent named.
    views: NamedViews,
    activity: Mutex<Instant>,
    closing: watch::Sender<bool>,
    /// Bumped whenever a viewer shows another projection, so the renderer build tracker follows every viewer's.
    shown: watch::Sender<u64>,
}

impl Shared {
    fn touch(&self) {
        *self.activity.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
    }

    /// The open pages of every viewer.
    fn pages(&self) -> usize {
        self.views.all().iter().map(|view| view.pages()).sum()
    }

    /// The viewer an input's `viewer` names, the default one without it.
    fn view(&self, input: &Value) -> Result<Arc<NamedView>, String> {
        self.views.get(input["viewer"].as_str())
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
            views: NamedViews::new(options.definition_revision.clone()),
            activity: Mutex::new(Instant::now()),
            closing: watch::Sender::new(false),
            shown: watch::Sender::new(0),
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

    /// The default viewer's state.
    pub fn state(&self) -> ViewState {
        self.shared.views.default_view().state.borrow().clone()
    }

    /// Shows a projection in the viewer the input names, as `open_projection` asks; returns the new state.
    pub async fn show(&self, input: &Value) -> Result<ViewState, String> {
        let view = self.shared.view(input)?;
        show(&self.shared, &view, input, Chooser::Agent).await
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
        if let Some(builds) = self.shared.service.renderer_builds() {
            for projection in shown_projections(&self.shared) {
                builds.stop(&projection);
            }
        }
        if let Some(mut server) = self.server.take()
            && tokio::time::timeout(SHUTDOWN_GRACE, &mut server).await.is_err()
        {
            server.abort();
            let _ = server.await;
        }
    }
}

/// The server's URL, with its token: the default viewer's page.
fn url(shared: &Shared) -> String {
    format!("http://127.0.0.1:{}/{}/", shared.port, shared.token)
}

/// A viewer's page: the server's URL, and the viewer's name unless it is the default one.
fn view_url(shared: &Shared, view: &NamedView) -> String {
    if view.is_default() {
        url(shared)
    } else {
        format!("{}?viewer={}", url(shared), view.name)
    }
}

/// The projections the viewers show, each once.
fn shown_projections(shared: &Shared) -> Vec<String> {
    let mut projections: Vec<String> = shared.views.all().iter().filter_map(|view| view.projection()).collect();
    projections.sort();
    projections.dedup();
    projections
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
