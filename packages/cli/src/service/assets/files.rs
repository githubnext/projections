//! The Inspector's prebuilt asset files: read safely from its asset
//! directory, checked when the service starts, and served with a policy.

use std::{
    io,
    path::{Path, PathBuf},
};

use anyhow::{Context as _, Result, bail};
use axum::{
    body::Body,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::service::http::HttpError;

const MAX_ASSET_BYTES: usize = 16 * 1024 * 1024;
const PROBE: &str = "fixtures/probe.js";

pub(in crate::service) fn content_type(filename: &str) -> &'static str {
    match Path::new(filename).extension().and_then(|value| value.to_str()).unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "json" | "map" => "application/json",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

pub(in crate::service) fn static_response(bytes: Vec<u8>, filename: &str, csp: &str) -> Response {
    let mut response = Body::from(bytes).into_response();
    for (name, value) in [
        ("content-type", content_type(filename)),
        ("cache-control", "no-store"),
        ("x-content-type-options", "nosniff"),
        ("content-security-policy", csp),
        ("referrer-policy", "no-referrer"),
    ] {
        response
            .headers_mut()
            .insert(axum::http::HeaderName::from_static(name), value.parse().unwrap());
    }
    response
}

pub(in crate::service) fn static_bytes(root: &Path, filename: &str) -> Result<Vec<u8>, HttpError> {
    if filename.contains(['\\', '\0']) || filename.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        return Err(HttpError::new(StatusCode::BAD_REQUEST, "Invalid static path"));
    }
    let mut destination = root.to_path_buf();
    for part in filename.split('/') {
        destination.push(part);
        let metadata = std::fs::symlink_metadata(&destination).map_err(|error| {
            HttpError::new(
                if error.kind() == io::ErrorKind::NotFound {
                    StatusCode::NOT_FOUND
                } else {
                    StatusCode::BAD_REQUEST
                },
                error.to_string(),
            )
        })?;
        if metadata.file_type().is_symlink() {
            return Err(HttpError::new(StatusCode::FORBIDDEN, "Static symlinks are forbidden"));
        }
    }
    let metadata = std::fs::symlink_metadata(&destination).map_err(|error| HttpError::new(StatusCode::BAD_REQUEST, error.to_string()))?;
    if !metadata.is_file() || metadata.len() > MAX_ASSET_BYTES as u64 {
        return Err(HttpError::new(StatusCode::NOT_FOUND, "Static asset unavailable"));
    }
    crate::artifact::read_artifact(&destination, MAX_ASSET_BYTES).map_err(|error| HttpError::new(StatusCode::NOT_FOUND, error.to_string()))
}

pub(in crate::service) async fn read_static(root: PathBuf, filename: String) -> Result<Vec<u8>, HttpError> {
    tokio::task::spawn_blocking(move || static_bytes(&root, &filename))
        .await
        .map_err(|error| HttpError::new(StatusCode::BAD_REQUEST, error.to_string()))?
}

/// Validates the Inspector's prebuilt assets and, in fixtures mode, returns
/// the check probe script.
pub(in crate::service) fn validate_assets(assets: &Path, fixtures: bool) -> Result<(PathBuf, Option<String>)> {
    let root = std::fs::canonicalize(assets).with_context(|| format!("Inspector assets are unavailable at {}", assets.display()))?;
    let read = |filename: &str| -> Result<Vec<u8>> { static_bytes(&root, filename).map_err(|error| anyhow::anyhow!(error.1)) };
    // The mountable bundle hosts load: headless pages (`headless`) mount it.
    let script = read("mount.js")?;
    if script.is_empty() || std::str::from_utf8(&script).is_err() {
        bail!("Inspector assets are incompatible: mount.js is empty or not UTF-8");
    }
    read("mount.css")?;
    for filename in ["engine/worker-entry.js", "engine/wasm-transport.js", "engine/transport.js"] {
        let bytes = read(filename)?;
        if bytes.is_empty() || std::str::from_utf8(&bytes).is_err() {
            bail!("Inspector browser Engine asset is empty or incompatible: {filename}");
        }
    }
    let wasm = read("engine/engine.wasm")?;
    if !wasm.starts_with(b"\0asm\x01\0\0\0") {
        bail!("Inspector browser Engine Wasm is missing or incompatible");
    }
    let probe = if fixtures {
        let probe = read(PROBE)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .filter(|probe| !probe.trim().is_empty())
            .context("Inspector fixtures mode requires the prebuilt check probe fixtures/probe.js")?;
        if probe.to_ascii_lowercase().contains("</script") {
            bail!("Inspector check probe fixtures/probe.js must not contain </script");
        }
        Some(probe)
    } else {
        None
    };
    Ok((root, probe))
}
