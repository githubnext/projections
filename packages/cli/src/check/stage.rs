//! The renderer checks every renderer is held to, run by the Inspector's
//! stage in the real host frame of a headless browser.

use crate::{
    assets, browser,
    headless::{self, Host},
    service::{FixturesOptions, InspectorOptions},
};
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool},
    thread,
    time::{Duration, Instant},
};

/// Runs the host's renderer checks on `scenarios` in a headless browser.
pub(super) async fn renderer_checks(
    scenarios: &[PathBuf],
    bundle: Option<PathBuf>,
    trust: bool,
    keys: &[String],
    executable: &Path,
    browsers: &browser::Pool,
    timeout: Duration,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<(String, Value)>> {
    let client = assets::inspector_assets()?;
    let host = Arc::new(
        Host::new(InspectorOptions {
            repo: std::env::current_dir()?,
            trust: false,
            document: None,
            custom_renderers: false,
            assets: client.path.clone(),
            fixtures: Some(FixturesOptions {
                sources: scenarios.to_vec(),
                renderers: bundle.into_iter().collect(),
                trust,
            }),
            executable: None,
            explore: None,
            candidates: Vec::new(),
            execution: Default::default(),
        })
        .await?,
    );
    let url = format!("{}/?view=stage", headless::ORIGIN);
    let (served, handle) = (host.clone(), tokio::runtime::Handle::current());
    let executable = executable.to_path_buf();
    let keys = keys.to_vec();
    let browsers = browsers.clone();
    let results = tokio::task::spawn_blocking(move || -> Result<Vec<(String, Value)>> {
        let mut browser = browsers.take(browser::LaunchOptions {
            executable: &executable,
            transport: browser::Transport::default(),
            width: 1280,
            height: 800,
            scale: 1.0,
            cancel,
        })?;
        // Opening the stage has its own budget, from after any wait for a launch slot; each scenario then gets the
        // whole timeout.
        let deadline = Instant::now() + timeout;
        let page = browser.open_page(deadline)?;
        let results = served
            .attach(&mut browser, &page.session, handle, deadline)
            .and_then(|()| run_stage(&mut browser, &page.session, &url, keys, timeout, deadline));
        browsers.give(browser, page)?;
        results
    })
    .await;
    host.close().await;
    let results = results.context("The renderer checks task failed")??;
    Ok(results)
}

/// Opens the stage at `url` on `session` and runs the checks of every scenario in `keys`.
fn run_stage(
    browser: &mut browser::Browser,
    session: &str,
    url: &str,
    keys: Vec<String>,
    timeout: Duration,
    deadline: Instant,
) -> Result<Vec<(String, Value)>> {
    let navigated = browser.call("Page.navigate", json!({"url": url}), Some(session), deadline)?;
    if let Some(error) = navigated["errorText"].as_str() {
        bail!("The browser could not open the Inspector: {error}");
    }
    wait_for_stage(browser, session, deadline)?;
    let mut results = Vec::new();
    for key in keys {
        let deadline = Instant::now() + timeout;
        let value = evaluate(
            browser,
            session,
            deadline,
            &format!(
                "window.projectionsStage.runChecks({}, {{}}).then(results => JSON.stringify(results))",
                serde_json::to_string(&key)?
            ),
        )
        .map_err(|error| {
            if Instant::now() >= deadline {
                anyhow::anyhow!(
                    "The renderer checks on scenario {key} did not finish within {} s (--timeout); raise --timeout, or check a smaller extraction with --from",
                    timeout.as_secs()
                )
            } else {
                error
            }
        })?;
        let checks: Value = serde_json::from_str(value.as_str().unwrap_or("[]"))?;
        results.push((key, checks));
    }
    Ok(results)
}

fn evaluate(browser: &mut browser::Browser, session: &str, deadline: Instant, expression: &str) -> Result<Value> {
    let result = browser.call(
        "Runtime.evaluate",
        json!({"expression": expression, "awaitPromise": true, "returnByValue": true}),
        Some(session),
        deadline,
    )?;
    if let Some(exception) = result.get("exceptionDetails") {
        bail!(
            "{}",
            exception["exception"]["description"]
                .as_str()
                .or(exception["text"].as_str())
                .unwrap_or("The page threw")
        );
    }
    Ok(result["result"]["value"].clone())
}

/// Waits until the Inspector's stage reports it is ready.
fn wait_for_stage(browser: &mut browser::Browser, session: &str, deadline: Instant) -> Result<()> {
    loop {
        ensure!(Instant::now() < deadline, "The Inspector's stage did not start in time");
        let state = evaluate(
            browser,
            session,
            deadline,
            // Polled while the navigation replaces about:blank, when there may be no document element yet.
            "document.documentElement?.dataset.projectionsStage ?? ''",
        )?;
        match state.as_str() {
            Some("ready") => return Ok(()),
            Some("failed") => bail!(
                "{}",
                evaluate(browser, session, deadline, "document.body.innerText")?
                    .as_str()
                    .unwrap_or("The stage failed")
            ),
            _ => thread::sleep(Duration::from_millis(100)),
        }
    }
}
