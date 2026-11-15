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
    keys: &[String],
    executable: &Path,
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
            }),
            executable: None,
            explore: None,
            candidates: Vec::new(),
            execution: Default::default(),
        })
        .await?,
    );
    let url = format!("{}/?view=stage", headless::ORIGIN);
    let (page, handle) = (host.clone(), tokio::runtime::Handle::current());
    let executable = executable.to_path_buf();
    let keys = keys.to_vec();
    let results = tokio::task::spawn_blocking(move || -> Result<Vec<(String, Value)>> {
        // Starting the browser and the stage has its own budget; each scenario then gets the whole timeout.
        let deadline = Instant::now() + timeout;
        let mut browser = browser::Browser::launch(browser::LaunchOptions {
            executable: &executable,
            transport: browser::Transport::default(),
            width: 1280,
            height: 800,
            scale: 1.0,
            cancel,
        })?;
        let session = open_session(&mut browser, deadline)?;
        page.attach(&mut browser, &session, handle, deadline)?;
        let navigated = browser.call("Page.navigate", json!({"url": url}), Some(&session), deadline)?;
        if let Some(error) = navigated["errorText"].as_str() {
            bail!("The browser could not open the Inspector: {error}");
        }
        wait_for_stage(&mut browser, &session, deadline)?;
        let mut results = Vec::new();
        for key in keys {
            let deadline = Instant::now() + timeout;
            let value = evaluate(
                &mut browser,
                &session,
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
        browser.close()?;
        Ok(results)
    })
    .await;
    host.close().await;
    let results = results.context("The renderer checks task failed")??;
    Ok(results)
}

/// A blank page's flattened session.
fn open_session(browser: &mut browser::Browser, deadline: Instant) -> Result<String> {
    let target = browser.call("Target.createTarget", json!({"url": "about:blank"}), None, deadline)?;
    let target = target["targetId"].as_str().context("The browser created no page")?.to_owned();
    let attached = browser.call(
        "Target.attachToTarget",
        json!({"targetId": target, "flatten": true}),
        None,
        deadline,
    )?;
    Ok(attached["sessionId"]
        .as_str()
        .context("The browser attached no session")?
        .to_owned())
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
