//! Renderer bundles: custom ones from a projection's definition revision or
//! the fixtures, and the path and check probe rules every bundle follows.

use std::sync::Arc;

use anyhow::Context as _;
use axum::{http::StatusCode, response::Response};
use subtle::ConstantTimeEq;

use super::{RENDERER_CSP, files::static_response};
use crate::{
    fixtures,
    service::{
        http::{HttpError, projection_parameter},
        state::{FixturesState, ServiceState, blocking_runner},
    },
};

pub(super) fn renderer_path(path: &str) -> Result<(), HttpError> {
    if path.is_empty() || path.contains(['\\', '\0']) || path.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        return Err(HttpError::new(StatusCode::BAD_REQUEST, "Invalid renderer path"));
    }
    Ok(())
}

/// Serves a custom renderer bundle file from a projection's definition revision.
/// `/custom-renderers/<capability>/<commit|working-tree>/<projection>/<path>`
pub(super) async fn custom(state: &Arc<ServiceState>, rest: &str) -> Result<Response, HttpError> {
    let unknown = || HttpError::new(StatusCode::NOT_FOUND, "Unknown custom renderer");
    let (capability, rest) = rest.split_once('/').ok_or_else(unknown)?;
    if (state.document.is_some() && !state.custom_renderers) || !bool::from(capability.as_bytes().ct_eq(state.capability.as_bytes())) {
        return Err(unknown());
    }
    if let Some(fixtures) = &state.fixtures {
        return fixture_renderer(fixtures, rest).await;
    }
    // Relative subresource URLs keep the revision because it is a path segment.
    let (reference, rest) = rest.split_once('/').ok_or_else(unknown)?;
    if reference != "working-tree"
        && !([40, 64].contains(&reference.len()) && reference.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
    {
        return Err(HttpError::new(
            StatusCode::BAD_REQUEST,
            "Custom renderer revisions are a full commit or working-tree",
        ));
    }
    let reference = reference.to_owned();
    let (id, path) = rest.split_once('/').ok_or_else(unknown)?;
    let id = projection_parameter(Some(&format!("projection={id}")))?;
    renderer_path(path)?;
    let filename = path.to_owned();
    let trusted = state.trust;
    let bytes = blocking_runner(state, move |runner| {
        let definitions = runner.discover(&reference)?;
        let definition = definitions
            .iter()
            .find(|definition| definition["id"] == id.as_str())
            .with_context(|| format!("Projection {id} is not defined at {reference}"))?;
        if !trusted && runner.renderer_requires_trust(definition, &reference)? {
            return Ok(None);
        }
        runner.renderer_file(&id, &reference, &filename).map(Some)
    })
    .await
    .map_err(|error| HttpError::new(StatusCode::NOT_FOUND, error.1))?
    .ok_or_else(|| {
        HttpError::new(
            StatusCode::FORBIDDEN,
            "This custom renderer is repository code that differs from the default branch's, so it runs only with --trust (in VS Code, a trusted workspace)",
        )
    })?;
    Ok(static_response(bytes, path, RENDERER_CSP))
}

/// Serves a fixture renderer bundle file:
/// `/custom-renderers/<capability>/fixtures/<key>/<index.html|renderer.json>`.
async fn fixture_renderer(fixtures: &FixturesState, rest: &str) -> Result<Response, HttpError> {
    let unknown = || HttpError::new(StatusCode::NOT_FOUND, "Unknown custom renderer");
    let (key, filename) = rest
        .strip_prefix("fixtures/")
        .and_then(|rest| rest.split_once('/'))
        .ok_or_else(unknown)?;
    if !fixtures::RENDERER_FILES.contains(&filename) {
        return Err(unknown());
    }
    let directory = fixtures.current.borrow().fixtures.bundles.get(key).cloned().ok_or_else(unknown)?;
    let name = filename.to_owned();
    let bytes = tokio::task::spawn_blocking(move || fixtures::bundle_file(&directory, &name))
        .await
        .map_err(|error| HttpError::new(StatusCode::NOT_FOUND, error.to_string()))?
        .map_err(|error| HttpError::new(StatusCode::NOT_FOUND, format!("{error:#}")))?;
    let bytes = if filename == "index.html" {
        inject_probe(bytes, &fixtures.probe)
    } else {
        bytes
    };
    Ok(static_response(bytes, filename, RENDERER_CSP))
}

/// Inserts the check probe before `</head>`, or at the start without one.
pub(super) fn inject_probe(html: Vec<u8>, probe: &str) -> Vec<u8> {
    let at = html
        .windows(7)
        .position(|window| window.eq_ignore_ascii_case(b"</head>"))
        .unwrap_or(0);
    let mut result = Vec::with_capacity(html.len() + probe.len() + 17);
    result.extend_from_slice(&html[..at]);
    result.extend_from_slice(b"<script>");
    result.extend_from_slice(probe.as_bytes());
    result.extend_from_slice(b"</script>");
    result.extend_from_slice(&html[at..]);
    result
}
