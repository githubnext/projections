//! Headless pages without a listener: `--png` snapshots and `check`'s renderer
//! checks open the Inspector's mountable bundle in a headless browser, at the
//! reserved origin [`ORIGIN`]. Every request the page, its Workers and its
//! sandboxed renderer frames make there is paused by the DevTools Fetch domain
//! and answered in-process: the page and its script by this module, the
//! Inspector's assets from the asset directory, and `/api/`, `/renderers/` and
//! `/custom-renderers/` by the Inspector service's router, with its content
//! security policies. Nothing listens on a port, and nothing outside the page
//! can reach the service.

use std::{path::Path, sync::Arc, time::Instant};

use anyhow::Result;
use axum::{
    body::to_bytes,
    http::{Method, header},
};
use serde_json::{Value, json};

use crate::browser::{Browser, Commands};
use crate::service::{InspectorOptions, Service};

/// The origin headless pages load from; `.invalid` never resolves, so only the
/// interception answers it.
pub const ORIGIN: &str = "https://projections.invalid";
/// The page's policy.
const CSP: &str = crate::service::INSPECTOR_CSP;
const PAGE: &str = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Projections</title><link rel=\"stylesheet\" href=\"./mount.css\"></head><body><div id=\"root\"></div><script type=\"module\" src=\"./headless.js\"></script></body></html>";
const SCRIPT: &str = include_str!("headless.js");
/// The largest response answered, as the service's assets allow.
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

/// The Inspector service a headless page reads.
pub struct Host {
    service: Arc<Service>,
}

impl Host {
    pub async fn new(options: InspectorOptions) -> Result<Self> {
        Ok(Self {
            service: Arc::new(Service::new(options).await?),
        })
    }

    /// Answers every request of `session`'s page under [`ORIGIN`]. Call it
    /// before navigating; `handle` runs the answers.
    pub fn attach(&self, browser: &mut Browser, session: &str, handle: tokio::runtime::Handle, deadline: Instant) -> Result<()> {
        let commands = browser.commands();
        let service = self.service.clone();
        browser.on_events(move |event| {
            if event["method"] != "Fetch.requestPaused" {
                return;
            }
            let (service, commands) = (service.clone(), commands.clone());
            // Each request is answered on its own, so a long poll never holds up the page.
            handle.spawn(async move { answer(&service, &commands, &event).await });
        });
        browser.call(
            "Fetch.enable",
            json!({"patterns": [{"urlPattern": format!("{ORIGIN}/*")}]}),
            Some(session),
            deadline,
        )?;
        Ok(())
    }

    /// Stops the service's jobs and watchers.
    pub async fn close(&self) {
        self.service.close().await;
    }
}

/// The response to one paused request: `(status, headers, body)`.
async fn respond(service: &Service, method: &str, path: &str, body: Option<Vec<u8>>) -> (u16, Vec<(String, String)>, Vec<u8>) {
    let route = path.split('?').next().unwrap_or_default();
    let text = |status: u16, kind: &str, body: &str| {
        (
            status,
            vec![
                ("content-type".to_owned(), kind.to_owned()),
                ("cache-control".to_owned(), "no-store".to_owned()),
                ("x-content-type-options".to_owned(), "nosniff".to_owned()),
            ],
            body.as_bytes().to_vec(),
        )
    };
    match route {
        "/" | "/index.html" => {
            let mut response = text(200, "text/html; charset=utf-8", PAGE);
            response.1.push(("content-security-policy".to_owned(), CSP.to_owned()));
            return response;
        }
        "/headless.js" => return text(200, "text/javascript; charset=utf-8", SCRIPT),
        _ => {}
    }
    if !["/api/", "/renderers/", "/custom-renderers/"]
        .iter()
        .any(|prefix| route.starts_with(prefix))
    {
        if method != "GET" {
            return text(405, "text/plain; charset=utf-8", "Method not allowed");
        }
        return match service.asset(route.trim_start_matches('/')) {
            Some((bytes, kind)) => {
                let mut response = text(200, kind, "");
                response.2 = bytes;
                response
            }
            None => text(404, "text/plain; charset=utf-8", "Not found"),
        };
    }
    let method = if method == "POST" { Method::POST } else { Method::GET };
    match service.call(method, path, body).await {
        Ok(response) => {
            let status = response.status().as_u16();
            let headers = response
                .headers()
                .iter()
                .filter(|(name, _)| *name != header::CONNECTION)
                .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_owned())))
                .collect();
            match to_bytes(response.into_body(), MAX_RESPONSE_BYTES).await {
                Ok(bytes) => (status, headers, bytes.to_vec()),
                Err(_) => text(500, "text/plain; charset=utf-8", "The response is too large"),
            }
        }
        Err(error) => text(500, "text/plain; charset=utf-8", &format!("{error:#}")),
    }
}

/// Answers one `Fetch.requestPaused` event.
async fn answer(service: &Service, commands: &Commands, event: &Value) {
    let params = &event["params"];
    let session = event["sessionId"].as_str();
    let request_id = params["requestId"].clone();
    let url = params["request"]["url"].as_str().unwrap_or_default();
    let Some(path) = url.strip_prefix(ORIGIN).filter(|path| path.starts_with('/')) else {
        let _ = commands.send(
            "Fetch.failRequest",
            json!({"requestId": request_id, "errorReason": "BlockedByClient"}),
            session,
        );
        return;
    };
    let method = params["request"]["method"].as_str().unwrap_or("GET");
    let body = params["request"]["postData"].as_str().map(|text| text.as_bytes().to_vec());
    let (status, headers, bytes) = respond(service, method, path, body).await;
    let headers: Vec<Value> = headers
        .into_iter()
        .map(|(name, value)| json!({"name": name, "value": value}))
        .collect();
    let _ = commands.send(
        "Fetch.fulfillRequest",
        json!({
            "requestId": request_id,
            "responseCode": status,
            "responseHeaders": headers,
            "body": crate::artifact::base64(&bytes),
        }),
        session,
    );
}

/// Whether `path` is a file under the Inspector's assets a headless page may load.
pub fn asset_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains(['\\', '\0'])
        && !path.split('/').any(|part| part.is_empty() || part == "." || part == "..")
        && !Path::new(path).is_absolute()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_paths_stay_inside() {
        assert!(asset_path("mount.js"));
        assert!(asset_path("engine/engine.wasm"));
        for path in ["", "../x", "a/../b", "/etc/passwd", "a//b", "a\\b", "./a"] {
            assert!(!asset_path(path), "{path}");
        }
    }
}
