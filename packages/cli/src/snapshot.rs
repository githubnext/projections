//! `--png` on `projections show` and `compare`: renders a projection's real renderer bundle in a
//! headless browser and returns a PNG.
//!
//! The document (an extraction or comparison the CLI computed, or a saved one)
//! is read by a headless page (`headless`) from the in-process Inspector
//! service in document mode, with the Inspector's page and renderer policies
//! (CSP, sandboxed frames), and no listener. Its chrome-free
//! `?view=snapshot` page presents the document through the host's stage and marks
//! `<html data-projections-snapshot="ready">` once every pane has acknowledged
//! painting the requested progress and fonts are loaded. The capture waits for
//! that marker, then for two identical consecutive screenshots.
//!
//! By default the page frames everything in one rounded card (`Frame::Card`) on
//! no background, captured with alpha so the image drops onto any page; a matte
//! fills the corners instead for formats without alpha.

use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};

use crate::browser::{self, Browser, LaunchOptions, Page, Transport};
use crate::headless::{self, Host};
use crate::runtime::{DefinitionSource, Runner};
use crate::service::InspectorOptions;

mod hugging;
mod page;
mod recording;
mod settings;

pub use page::{PageRequest, page};
pub use recording::{PlaybackFrame, Recording, record};

pub use settings::{Focus, FocusOn, Frame, MAX_PIXELS, Mode, Theme, matte, validate_settings};

/// What to render and how.
pub struct Request {
    /// A `projections.extraction` or `projections.comparison` document.
    pub document: Value,
    /// The repository a custom renderer bundle is read from.
    pub repo: PathBuf,
    /// Whether custom renderers from outside the checkout's history may run.
    pub trust: bool,
    /// Which revision's definition explains a comparison; it supplies the custom renderer.
    pub definition: DefinitionSource,
    /// The revision whose definition supplies the custom renderer, when it is not the document's own: one side of a
    /// comparison keeps the comparison's definition revision (see `side`).
    pub definition_revision: Option<String>,
    /// The Inspector's browser assets.
    pub assets: PathBuf,
    /// The comparison mode; omitted, animated when the renderer supports it, else its default.
    pub mode: Option<Mode>,
    /// The animated transition's progress, 0 (before) to 1 (after, the default).
    pub progress: Option<f64>,
    /// Where the renderers open their view.
    pub focus: Focus,
    pub theme: Theme,
    pub frame: Frame,
    /// A card frame's corners in this colour (see `matte`) instead of transparent.
    pub matte: Option<String>,
    /// The viewport, in CSS pixels.
    pub width: u32,
    pub height: u32,
    /// Device pixels per CSS pixel.
    pub scale: f64,
    pub browser: PathBuf,
    pub transport: Transport,
    /// The longest the page may take to become ready.
    pub timeout: Duration,
    pub cancel: Arc<AtomicBool>,
}

pub struct Snapshot {
    pub png: Vec<u8>,
    /// For example that a custom renderer was withheld.
    pub notices: Vec<String>,
}

/// The default time to paint `document`: a minute, and a second more for every
/// five entities it holds (both sides of a comparison), at most ten minutes.
pub fn paint_timeout(document: &Value) -> Duration {
    let count = |extraction: &Value| extraction["entities"].as_array().map_or(0, Vec::len) as u64;
    let entities = if document["format"] == "projections.comparison" {
        count(&document["before"]["extraction"]) + count(&document["after"]["extraction"])
    } else {
        count(&document["extraction"])
    };
    Duration::from_secs((60 + entities / 5).min(600))
}

/// Rejects settings that can't apply to the document, before any work.
pub fn validate(request: &Request) -> Result<()> {
    validate_settings(request.width, request.height, request.scale, request.progress, request.timeout)?;
    if let Some(color) = &request.matte {
        matte(color)?;
        ensure!(request.frame == Frame::Card, "--matte fills the corners of --frame card");
    }
    match request.document["format"].as_str() {
        Some("projections.comparison") => {
            if request.progress.is_some() {
                ensure!(
                    matches!(request.mode, None | Some(Mode::Animated)),
                    "--progress applies to animated comparisons, not --mode {}",
                    request.mode.map(Mode::name).unwrap_or_default()
                );
            }
        }
        Some("projections.extraction") => {
            ensure!(
                request.mode.is_none() && request.progress.is_none(),
                "--mode and --progress apply to comparisons (<BASE>..<HEAD>), not one revision"
            );
            ensure!(
                request.focus.on != Some(FocusOn::Changes),
                "--focus changes applies to comparisons (<BASE>..<HEAD>), not one revision"
            );
        }
        _ => bail!("Snapshots present a projections.extraction or projections.comparison document"),
    }
    Ok(())
}

/// The revision whose definition (and custom renderer) applies to a document:
/// a full commit, or `working-tree`.
pub fn definition_revision(document: &Value, source: DefinitionSource) -> Option<String> {
    let extraction = if document["format"] == "projections.comparison" {
        match source {
            DefinitionSource::Base => &document["before"],
            DefinitionSource::Head => &document["after"],
        }
    } else {
        document
    };
    let revision = &extraction["provenance"]["revision"];
    if revision["kind"] == "working-tree" {
        return Some("working-tree".to_owned());
    }
    revision["commit"]
        .as_str()
        .filter(|commit| {
            [40, 64].contains(&commit.len()) && commit.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
        .map(str::to_owned)
}

/// One side of a comparison as an extraction document, with the revision whose definition (and custom renderer)
/// the comparison applied to both sides, so the side is drawn by the renderer that explained the comparison.
pub fn side(comparison: &Value, after: bool, source: DefinitionSource) -> Result<(Value, Option<String>)> {
    ensure!(
        comparison["format"] == "projections.comparison",
        "--side selects one side of a comparison: <BASE>..<HEAD>, or a saved projections.comparison"
    );
    let part = comparison[if after { "after" } else { "before" }].clone();
    ensure!(
        part.is_object(),
        "The comparison has no {} extraction",
        if after { "after" } else { "before" }
    );
    Ok((part, definition_revision(comparison, source)))
}

/// The definition a document records (both sides of a comparison share it).
fn definition(document: &Value) -> &Value {
    if document["format"] == "projections.comparison" {
        &document["after"]["provenance"]["definition"]
    } else {
        &document["provenance"]["definition"]
    }
}

fn query(name: &str, value: &str) -> String {
    let encoded: String = value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect();
    format!("&{name}={encoded}")
}

/// Renders the document and returns the PNG. A card frame hugs the renderer's content: the image is as tall as the
/// card, at most the viewport.
pub async fn render(request: Request) -> Result<Snapshot> {
    render_with(request, &browser::Pool::single_use()).await
}

/// Renders as [`render`] does, in a browser from `browsers`, which keeps it for the next render.
pub async fn render_with(request: Request, browsers: &browser::Pool) -> Result<Snapshot> {
    let hug = request.frame == Frame::Card;
    let mut prepared = prepare(request).await?;
    let host = prepared.host;
    let mut notices = std::mem::take(&mut prepared.notices);
    let mut options = prepared.capture;
    hugging::hug(&mut options, hug);
    let browsers = browsers.clone();
    let captured = tokio::task::spawn_blocking(move || {
        let (mut browser, page) = open(&options, &browsers)?;
        let shot = shoot(&mut browser, &page.session, &options.url, &options);
        browsers.give(browser, page)?;
        shot
    })
    .await;
    host.close().await;
    let (png, settled) = captured.context("Snapshot capture task failed")??;
    if !settled {
        notices.push(UNSETTLED.to_owned());
    }
    Ok(Snapshot { png, notices })
}

const UNSETTLED: &str = "The renderer kept changing after it acknowledged painting; the snapshot shows its last frame";

struct Prepared {
    capture: Capture,
    /// The service the capture's page reads, closed once it is captured.
    host: Arc<Host>,
    notices: Vec<String>,
}

/// Checks the request and serves its document: the snapshot page's URL (without a progress for `record`) and the host.
async fn prepare(request: Request) -> Result<Prepared> {
    validate(&request)?;
    let mut notices = Vec::new();
    let mut parameters = format!(
        "?view=snapshot{}{}",
        query("theme", request.theme.name()),
        query("frame", request.frame.name())
    );
    if let Some(matte) = &request.matte {
        parameters += &query("matte", matte);
    }
    if let Some(mode) = request.mode {
        parameters += &query("mode", mode.name());
    }
    if let Some(progress) = request.progress {
        parameters += &query("progress", &progress.to_string());
    }
    if let Some(on) = request.focus.on {
        parameters += &query("focus", on.name());
    }
    if let Some(entity) = &request.focus.entity {
        ensure!(!entity.is_empty(), "--entity names an item by its ID");
        parameters += &query("entity", entity);
    }
    if request.focus.fit {
        parameters += "&fit=1";
    }
    let bundle = definition(&request.document)["renderer"]["bundle"].as_str().map(str::to_owned);
    if let Some(bundle) = &bundle {
        let revision = request
            .definition_revision
            .clone()
            .or_else(|| definition_revision(&request.document, request.definition))
            .context("The document does not name the revision of its custom renderer")?;
        parameters += &query("definition", &revision);
        let (repo, trust, recorded) = (request.repo.clone(), request.trust, definition(&request.document).clone());
        let withheld = tokio::task::spawn_blocking(move || {
            Ok::<_, anyhow::Error>(!trust && Runner::new(repo, false).renderer_requires_trust(&recorded, &revision)?)
        })
        .await?
        .with_context(|| format!("Cannot check the custom renderer {bundle}"))?;
        if withheld {
            parameters += "&withheld=1";
            notices.push(format!(
                "The custom renderer {bundle} comes from outside this checkout's history and differs from its merge base's, so it needs --trust; the snapshot uses the built-in renderer for its schema instead"
            ));
        }
    }
    let host = Arc::new(
        Host::new(InspectorOptions {
            repo: request.repo.clone(),
            trust: request.trust,
            document: Some(request.document.clone()),
            custom_renderers: bundle.is_some(),
            assets: request.assets.clone(),
            fixtures: None,
            executable: None,
            explore: None,
            candidates: Vec::new(),
            execution: Default::default(),
        })
        .await?,
    );
    let options = Capture {
        url: format!("{}/{parameters}", headless::ORIGIN),
        host: Some(host.clone()),
        handle: tokio::runtime::Handle::current(),
        browser: request.browser,
        transport: request.transport,
        theme: request.theme,
        transparent: request.frame == Frame::Card && request.matte.is_none(),
        width: request.width,
        height: request.height,
        scale: request.scale,
        hug: false,
        timeout: request.timeout,
        cancel: request.cancel,
    };
    Ok(Prepared {
        capture: options,
        host,
        notices,
    })
}

struct Capture {
    url: String,
    /// The in-process host that answers the page's requests; none for a page a server serves (the viewer's).
    host: Option<Arc<Host>>,
    handle: tokio::runtime::Handle,
    browser: PathBuf,
    transport: Transport,
    theme: Theme,
    /// Captures with alpha: the page has no background, so a card frame's corners stay transparent.
    transparent: bool,
    width: u32,
    height: u32,
    scale: f64,
    /// Crops the capture to the card frame's height (the page's `hug`); `--frames` keeps every frame the viewport's size.
    hug: bool,
    timeout: Duration,
    cancel: Arc<AtomicBool>,
}

/// Waits `duration`, or bails when cancelled.
fn pause(cancel: &AtomicBool, duration: Duration) -> Result<()> {
    let end = Instant::now() + duration;
    while Instant::now() < end {
        ensure!(!cancel.load(Ordering::SeqCst), "Cancelled");
        thread::sleep(Duration::from_millis(20).min(end - Instant::now()));
    }
    Ok(())
}

/// The page's snapshot state: `ready`, `failed` (with its message) or empty.
fn page_state(browser: &mut Browser, session: &str, deadline: Instant) -> Result<(String, String)> {
    let result = browser.call(
        "Runtime.evaluate",
        json!({
            "expression": "JSON.stringify([document.documentElement.dataset.projectionsSnapshot ?? '', document.documentElement.dataset.projectionsSnapshotError ?? ''])",
            "returnByValue": true,
        }),
        Some(session),
        deadline,
    )?;
    let text = result["result"]["value"].as_str().unwrap_or("[\"\",\"\"]");
    let value: Value = serde_json::from_str(text).unwrap_or(json!(["", ""]));
    Ok((
        value[0].as_str().unwrap_or_default().to_owned(),
        value[1].as_str().unwrap_or_default().to_owned(),
    ))
}

/// Takes a browser from `browsers` and opens a page set up for capture: its size, density, theme and the served host.
fn open(options: &Capture, browsers: &browser::Pool) -> Result<(Browser, Page)> {
    let mut browser = browsers.take(LaunchOptions {
        executable: &options.browser,
        transport: options.transport,
        width: options.width,
        height: options.height,
        scale: options.scale,
        cancel: options.cancel.clone(),
    })?;
    // From here: waiting for a launch slot doesn't spend the page's budget.
    let deadline = Instant::now() + options.timeout;
    let page = browser.open_page(deadline)?;
    let session = page.session.as_str();
    browser.call(
        "Emulation.setDeviceMetricsOverride",
        json!({
            "width": options.width, "height": options.height,
            "deviceScaleFactor": options.scale, "mobile": false,
            "screenWidth": options.width, "screenHeight": options.height,
        }),
        Some(session),
        deadline,
    )?;
    // Best effort: older browsers may lack some of these; the page applies the theme itself.
    for (method, params) in [
        (
            "Emulation.setEmulatedMedia",
            json!({"media": "screen", "features": [
                {"name": "prefers-color-scheme", "value": options.theme.name()},
                {"name": "prefers-reduced-motion", "value": "reduce"},
            ]}),
        ),
        ("Emulation.setTimezoneOverride", json!({"timezoneId": "UTC"})),
        ("Emulation.setLocaleOverride", json!({"locale": "en-US"})),
        ("Emulation.setScrollbarsHidden", json!({"hidden": true})),
    ] {
        let _ = browser.call(method, params, Some(session), deadline);
    }
    if options.transparent {
        browser
            .call(
                "Emulation.setDefaultBackgroundColorOverride",
                json!({"color": {"r": 0, "g": 0, "b": 0, "a": 0}}),
                Some(session),
                deadline,
            )
            .context("The browser cannot capture a transparent background; pass --matte COLOR")?;
    }
    if let Some(host) = &options.host {
        host.attach(&mut browser, session, options.handle.clone(), deadline)?;
    }
    Ok((browser, page))
}

fn navigate(browser: &mut Browser, session: &str, url: &str, deadline: Instant) -> Result<()> {
    let navigated = browser.call("Page.navigate", json!({"url": url}), Some(session), deadline)?;
    if let Some(error) = navigated["errorText"].as_str() {
        bail!("The browser could not open the snapshot page: {error}");
    }
    Ok(())
}

/// Opens `url` and captures it once it has painted; returns the PNG and whether two consecutive captures matched.
fn shoot(browser: &mut Browser, session: &str, url: &str, options: &Capture) -> Result<(Vec<u8>, bool)> {
    let deadline = Instant::now() + options.timeout;
    navigate(browser, session, url, deadline)?;
    wait_ready(browser, session, options, deadline)?;
    stable_capture(browser, session, options, deadline)
}

/// A string-valued expression evaluated in the page.
fn evaluate_string(browser: &mut Browser, session: &str, expression: &str, deadline: Instant) -> Result<String> {
    let result = browser.call(
        "Runtime.evaluate",
        json!({"expression": expression, "returnByValue": true}),
        Some(session),
        deadline,
    )?;
    Ok(result["result"]["value"].as_str().unwrap_or_default().to_owned())
}

/// Waits until the page reports it painted, failing when it reports a
/// failure or the deadline passes.
fn wait_ready(browser: &mut Browser, session: &str, options: &Capture, deadline: Instant) -> Result<()> {
    loop {
        let now = Instant::now();
        ensure!(
            now < deadline,
            "The renderer did not finish painting within {} s (--timeout)",
            options.timeout.as_secs()
        );
        match page_state(browser, session, deadline)? {
            (state, _) if state == "ready" => break,
            (state, message) if state == "failed" => bail!(
                "{}",
                if message.is_empty() {
                    "The snapshot page failed".to_owned()
                } else {
                    message
                }
            ),
            _ => pause(&options.cancel, Duration::from_millis(100))?,
        }
    }
    Ok(())
}

/// Same input, same image: waits for fonts and two frames, then takes
/// captures until two consecutive ones match. Returns the PNG and whether
/// they matched.
fn stable_capture(browser: &mut Browser, session: &str, options: &Capture, deadline: Instant) -> Result<(Vec<u8>, bool)> {
    let cancel = &options.cancel;
    let mut previous: Option<Vec<u8>> = None;
    for _ in 0..10 {
        browser.call(
            "Runtime.evaluate",
            json!({
                "expression": "document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))",
                "awaitPromise": true,
                "returnByValue": true,
            }),
            Some(session),
            deadline,
        )?;
        let (state, message) = page_state(browser, session, deadline)?;
        if state == "failed" {
            bail!("{message}");
        }
        let parameters = hugging::capture_parameters(browser, session, options, deadline)?;
        let shot = browser.call("Page.captureScreenshot", parameters, Some(session), deadline)?;
        let png = browser::base64_decode(shot["data"].as_str().context("No screenshot data")?)?;
        ensure!(png.starts_with(b"\x89PNG\r\n\x1a\n"), "The browser returned no PNG");
        if previous.as_ref() == Some(&png) {
            return Ok((png, true));
        }
        previous = Some(png);
        pause(cancel, Duration::from_millis(150))?;
    }
    Ok((previous.context("No screenshot")?, false))
}
