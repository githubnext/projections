//! `projections view screenshot --page`: the viewer's own page, its header, toolbar and summary bar around the
//! projection, captured in a headless browser from the running viewer. The page opens as a capture (`?capture`), so
//! the viewer neither counts it as the person's nor takes its reports; it marks `data-projections-viewer="ready"`
//! once it shows the view settled. It shows the view as a fresh page does: the viewer's projection, pair, mode and
//! selection, not the person's playback position or zoom.

use std::{
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool},
    time::{Duration, Instant},
};

use anyhow::{Context, Result, ensure};

use super::{Capture, Snapshot, Theme, UNSETTLED, evaluate_string, navigate, open, pause, stable_capture, validate_settings};

/// The viewer page to capture, and how.
pub struct PageRequest {
    /// The viewer page's URL, with its token (and `?viewer=` for a named viewer).
    pub url: String,
    pub theme: Theme,
    pub width: u32,
    pub height: u32,
    pub browser: PathBuf,
    pub timeout: Duration,
}

/// Captures the viewer's page once it shows the view settled.
pub async fn page(request: PageRequest) -> Result<Snapshot> {
    validate_settings(request.width, request.height, 1.0, None, request.timeout)?;
    let separator = if request.url.contains('?') { '&' } else { '?' };
    let options = Capture {
        url: format!("{}{separator}capture", request.url),
        host: None,
        handle: tokio::runtime::Handle::current(),
        browser: request.browser,
        transport: Default::default(),
        theme: request.theme,
        transparent: false,
        width: request.width,
        height: request.height,
        scale: 1.0,
        hug: false,
        timeout: request.timeout,
        cancel: Arc::new(AtomicBool::new(false)),
    };
    let (png, settled) = tokio::task::spawn_blocking(move || {
        let browsers = crate::browser::Pool::single_use();
        let (mut browser, page) = open(&options, &browsers)?;
        let session = page.session.clone();
        let deadline = Instant::now() + options.timeout;
        let shot = navigate(&mut browser, &session, &options.url, deadline)
            .and_then(|()| wait_ready(&mut browser, &session, &options, deadline))
            .and_then(|()| stable_capture(&mut browser, &session, &options, deadline));
        browsers.give(browser, page)?;
        shot
    })
    .await
    .context("Page capture task failed")??;
    Ok(Snapshot {
        png,
        notices: if settled { Vec::new() } else { vec![UNSETTLED.to_owned()] },
    })
}

/// Waits until the page says it shows the view settled.
fn wait_ready(browser: &mut crate::browser::Browser, session: &str, options: &Capture, deadline: Instant) -> Result<()> {
    loop {
        let mark = evaluate_string(
            browser,
            session,
            "document.documentElement.dataset.projectionsViewer ?? ''",
            deadline,
        )?;
        if mark == "ready" {
            return Ok(());
        }
        ensure!(
            Instant::now() < deadline,
            "The viewer's page didn't settle within {} s: it is still extracting, or can't reach the viewer",
            options.timeout.as_secs()
        );
        pause(&options.cancel, Duration::from_millis(100))?;
    }
}
