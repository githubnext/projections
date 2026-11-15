//! The Inspector's prebuilt assets and renderer bundles, served under their
//! content security policies.

pub(super) mod bundles;
pub(super) mod files;

use std::sync::Arc;

use axum::{http::StatusCode, response::Response};
use serde_json::{Value, json};

use super::{
    http::{HttpError, decode_url, json_response},
    state::ServiceState,
};
use bundles::{inject_probe, renderer_path};
use files::{read_static, static_response};

/// Renderer bundles run sandboxed with an opaque origin and no network access.
/// The policy of a page that mounts the Inspector, and of its assets (the
/// engine and comparator Workers): its own scripts, styles and Workers;
/// renderer frames from its origin (sandboxed, with their own policy) or a
/// renderer development server on loopback.
pub const INSPECTOR_CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'";
pub const RENDERER_CSP: &str = "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";
pub(super) const CUSTOM_RENDERERS: &str = "custom-renderers/";

/// `GET /api/renderers`: the built-in renderers the Inspector build lists, and
/// where custom renderer bundles are served.
pub(super) async fn renderers(state: &ServiceState) -> Result<Response, HttpError> {
    // The Inspector build lists its built-in renderers itself.
    let renderers = match read_static(state.assets.clone(), "renderers/index.json".to_owned()).await {
        Ok(bytes) => serde_json::from_slice::<Value>(&bytes)
            .ok()
            .filter(|catalog| catalog["format"] == "projections.renderers")
            .map(|catalog| catalog["renderers"].clone())
            .ok_or_else(|| HttpError::new(StatusCode::INTERNAL_SERVER_ERROR, "Inspector renderers/index.json is invalid"))?,
        Err(_) => json!([]),
    };
    Ok(json_response(
        StatusCode::OK,
        json!({
            "renderers": renderers,
            "customRendererBase": if (state.document.is_some() && !state.custom_renderers) || state.fixtures.is_some() {
                Value::Null
            } else {
                json!(format!("/{CUSTOM_RENDERERS}{}/", state.capability))
            },
        }),
    ))
}

/// A file outside the API: a custom renderer bundle, a built-in renderer or
/// one of the Inspector's own assets.
pub(super) async fn serve(state: &Arc<ServiceState>, path: &str) -> Result<Response, HttpError> {
    let decoded = decode_url(path, false)?;
    if let Some(rest) = decoded.strip_prefix('/').and_then(|path| path.strip_prefix(CUSTOM_RENDERERS)) {
        return bundles::custom(state, rest).await;
    }
    if let Some(rest) = decoded.strip_prefix("/renderers/") {
        renderer_path(rest)?;
        let filename = format!("renderers/{rest}");
        let mut bytes = read_static(state.assets.clone(), filename.clone()).await?;
        if let Some(fixtures) = &state.fixtures
            && rest.rsplit('/').next() == Some("index.html")
        {
            bytes = inject_probe(bytes, &fixtures.probe);
        }
        return Ok(static_response(bytes, &filename, RENDERER_CSP));
    }
    // The Inspector's own assets, for a host that doesn't ship the UI
    // (the renderer testing package): never a renderer bundle or a
    // document, which are served only with the renderer policy.
    if let Some(rest) = decoded.strip_prefix("/inspector/") {
        if !crate::headless::asset_path(rest) || rest.starts_with("renderers/") || rest.ends_with(".html") {
            return Err(HttpError::new(StatusCode::NOT_FOUND, "Not found"));
        }
        let bytes = read_static(state.assets.clone(), rest.to_owned()).await?;
        return Ok(static_response(bytes, rest, INSPECTOR_CSP));
    }
    Err(HttpError::new(StatusCode::NOT_FOUND, "Not found"))
}
