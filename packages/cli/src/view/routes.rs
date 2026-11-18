//! The viewer's HTTP routes: the page and its assets, the page's and the
//! agents' endpoints, and the service's read routes and extraction jobs.

use std::sync::Arc;

use axum::{
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use subtle::ConstantTimeEq;

use super::{
    MAX_RESPONSE_BYTES, Shared, Views,
    pages::{control_state, page_state, query_map, report},
    show::{choose, show},
    state::{Chooser, ViewState},
    stop, surface, url,
};

/// The page, with its response's script nonce (see [`super::viewer_csp`]).
fn page(nonce: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"referrer\" content=\"no-referrer\"><title>Projections</title><link rel=\"stylesheet\" href=\"./mount.css\"></head><body><div id=\"root\"></div><script type=\"module\" nonce=\"{nonce}\" src=\"./viewer.js\"></script></body></html>"
    )
}
const SCRIPT: &str = "import {mountViewer} from './mount.js'\nmountViewer(document.getElementById('root'))\n";
/// What any request without the token gets, the bare port's included: what the viewer is and how to get its link,
/// never the link itself. Only the person's own agent or terminal has the token; a page that redirected the bare port
/// to it would hand it to anything on the machine that can reach the port.
const NEEDS_LINK: &str = include_str!("needs-link.html");
/// The policy of the page above: no script, no requests.
const NEEDS_LINK_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const MAX_BODY_BYTES: usize = 256 * 1024;
/// The service's routes a viewer page reads: never a write.
const READS: &[&str] = &[
    "/api/changes",
    "/api/definitions",
    "/api/revisions",
    "/api/pairs",
    "/api/scenarios",
    "/api/comparator",
    "/api/comparator-tests",
    "/api/renderers",
    "/api/identity",
    "/api/environment",
    "/api/document",
    "/api/explore",
    "/api/renderer-builds",
];

type Failure = (StatusCode, String);

fn text(status: StatusCode, body: &str) -> Response {
    let mut response = (status, body.to_owned()).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    response
}

pub(super) fn json_response(status: StatusCode, value: &Value) -> Response {
    let mut response = text(status, &value.to_string());
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json; charset=utf-8"));
    response
}

fn bytes_response(bytes: Vec<u8>, kind: &str, csp: Option<&str>) -> Response {
    let mut response = Body::from(bytes).into_response();
    let headers = response.headers_mut();
    if let Ok(kind) = HeaderValue::from_str(kind) {
        headers.insert(header::CONTENT_TYPE, kind);
    }
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    if let Some(csp) = csp.and_then(|csp| HeaderValue::from_str(csp).ok()) {
        headers.insert(header::CONTENT_SECURITY_POLICY, csp);
    }
    response
}

/// Whether the request's `Host` is this server on loopback, so a page another
/// site rebinds a name to can't reach it.
pub(super) fn loopback_host(request: &Request, port: u16) -> bool {
    let Some(host) = request.headers().get(header::HOST).and_then(|value| value.to_str().ok()) else {
        return false;
    };
    ["127.0.0.1", "localhost", "[::1]"]
        .iter()
        .any(|name| host.eq_ignore_ascii_case(&format!("{name}:{port}")))
}

pub(super) async fn route(State(shared): State<Arc<Shared>>, request: Request) -> Response {
    if !loopback_host(&request, shared.port) {
        shared.seen.foreign_host();
        return text(StatusCode::FORBIDDEN, "Forbidden");
    }
    let path = request.uri().path().to_owned();
    let rest = path.strip_prefix('/').unwrap_or_default();
    let (token, rest) = rest.split_once('/').unwrap_or((rest, ""));
    if !bool::from(token.as_bytes().ct_eq(shared.token.as_bytes())) {
        shared.seen.without_token();
        if request.method() == Method::GET {
            let mut response = bytes_response(NEEDS_LINK.as_bytes().to_vec(), "text/html; charset=utf-8", Some(NEEDS_LINK_CSP));
            *response.status_mut() = StatusCode::NOT_FOUND;
            return response;
        }
        return text(StatusCode::NOT_FOUND, "Not found");
    }
    let rest = format!("/{rest}");
    match handle(&shared, request, &rest).await {
        Ok(response) => response,
        Err((status, message)) => json_response(status, &json!({"diagnostics": [{"severity": "error", "message": message}]})),
    }
}

async fn handle(shared: &Arc<Shared>, request: Request, path: &str) -> Result<Response, Failure> {
    let method = request.method().clone();
    if let Some(name) = path.strip_prefix("/control/tool/")
        && method == Method::POST
    {
        return tool(shared, request, name).await;
    }
    let request = match endpoint(shared, request, &method, path).await? {
        Ok(response) => return Ok(response),
        Err(request) => request,
    };
    if path.starts_with("/api/") {
        let read = method == Method::GET && (READS.contains(&path) || path.starts_with("/api/jobs/"));
        let job = method == Method::POST && (path == "/api/jobs" || (path.starts_with("/api/jobs/") && path.ends_with("/cancel")));
        if !read && !job {
            discard(request).await;
            return Err((StatusCode::FORBIDDEN, "The viewer only reads".to_owned()));
        }
        return forward(shared, request, path).await;
    }
    if path.starts_with("/renderers/") || path.starts_with("/custom-renderers/") {
        return forward(shared, request, path).await;
    }
    let asset = path.trim_start_matches('/');
    if method != Method::GET || asset.ends_with(".html") || asset.starts_with("renderers/") {
        discard(request).await;
        return Err((StatusCode::NOT_FOUND, "Not found".to_owned()));
    }
    match shared.service.asset(asset) {
        Some((bytes, kind)) => Ok(bytes_response(bytes, kind, None)),
        None => Err((StatusCode::NOT_FOUND, "Not found".to_owned())),
    }
}

/// The viewer's own endpoints: the page, its script, and the page's and the
/// agents' state and controls. Hands back any other request.
async fn endpoint(shared: &Arc<Shared>, request: Request, method: &Method, path: &str) -> Result<Result<Response, Request>, Failure> {
    Ok(Ok(match (method.clone(), path) {
        (Method::GET, "/") => {
            shared.touch();
            let query = query_map(request.uri().query().unwrap_or_default());
            if let Ok(name) = super::viewer_name(query.get("viewer").map(String::as_str)) {
                shared.seen.loaded(&name);
            }
            let nonce = super::script_nonce();
            bytes_response(
                page(&nonce).into_bytes(),
                "text/html; charset=utf-8",
                Some(&super::viewer_csp(&nonce)),
            )
        }
        (Method::GET, "/viewer.js") => {
            shared.seen.script();
            bytes_response(SCRIPT.as_bytes().to_vec(), "text/javascript; charset=utf-8", None)
        }
        (Method::GET, "/view/state") => {
            let query = query_map(request.uri().query().unwrap_or_default());
            let view = shared.views.get(query.get("viewer").map(String::as_str)).map_err(refused)?;
            page_state(shared, &view, &query).await
        }
        (Method::POST, "/view/report") => {
            let body = body(request).await?;
            let view = shared.view(&body).map_err(refused)?;
            report(shared, &view, body);
            json_response(StatusCode::OK, &json!({"ok": true}))
        }
        (Method::POST, "/view/choose") => {
            let input = body(request).await?;
            let view = shared.view(&input).map_err(refused)?;
            let projection = input["projection"]
                .as_str()
                .ok_or_else(|| refused("Name the projection to show".to_owned()))?;
            let state = choose(shared, &view, projection).await.map_err(refused)?;
            json_response(StatusCode::OK, &json!({"state": state.json()}))
        }
        (Method::POST, "/control/show") => {
            let input = body(request).await?;
            let view = shared.view(&input).map_err(refused)?;
            let state = show(shared, &view, &input, Chooser::Agent).await.map_err(refused)?;
            json_response(
                StatusCode::OK,
                &json!({"state": state.json(), "url": super::view_url(shared, &view)}),
            )
        }
        (Method::GET, "/control/defaults") => {
            let view = query_view(shared, &request)?;
            let defaults = surface::defaults(shared, &view).await;
            json_response(StatusCode::OK, &defaults.as_ref().map_or(Value::Null, surface::defaults_json))
        }
        (Method::GET, "/control/state") => {
            shared.touch();
            let view = query_view(shared, &request)?;
            json_response(StatusCode::OK, &control_state(shared, &view))
        }
        (Method::POST, "/control/stop") => {
            stop(shared);
            json_response(StatusCode::OK, &json!({"stopped": true, "url": url(shared)}))
        }
        (Method::POST, "/control/refresh") => {
            shared.touch();
            let view = shared.view(&body(request).await?).map_err(refused)?;
            view.state.send_modify(ViewState::refresh);
            json_response(StatusCode::OK, &control_state(shared, &view))
        }
        _ => return Ok(Err(request)),
    }))
}

/// A request that names no viewer, or one that can't be.
fn refused(message: String) -> Failure {
    (StatusCode::BAD_REQUEST, message)
}

/// The viewer a request's `?viewer=` names, the default one without it.
fn query_view(shared: &Shared, request: &Request) -> Result<Arc<super::NamedView>, Failure> {
    let query = query_map(request.uri().query().unwrap_or_default());
    shared.views.get(query.get("viewer").map(String::as_str)).map_err(refused)
}

/// `POST control/tool/NAME`: answers a tool as `projections mcp` does, with this viewer.
async fn tool(shared: &Arc<Shared>, request: Request, name: &str) -> Result<Response, Failure> {
    let input = body(request).await?;
    let views = Views::attached(shared.clone());
    let outcome = crate::tools::call_with_views(&shared.service, crate::tools::Host::Agent, Some(&views), name, &input)
        .await
        .map_err(|message| (StatusCode::NOT_FOUND, message))?;
    Ok(json_response(StatusCode::OK, &outcome.json()))
}

/// Reads and drops a refused request's body (up to the body limit), so the
/// connection closes cleanly instead of resetting under a client still sending.
async fn discard(request: Request) {
    let _ = to_bytes(request.into_body(), MAX_BODY_BYTES).await;
}

async fn body(request: Request) -> Result<Value, Failure> {
    let bytes = to_bytes(request.into_body(), MAX_BODY_BYTES)
        .await
        .map_err(|_| (StatusCode::PAYLOAD_TOO_LARGE, "The request is too large".to_owned()))?;
    if bytes.is_empty() {
        return Ok(json!({}));
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| (StatusCode::BAD_REQUEST, "The request isn't JSON".to_owned()))?;
    if !value.is_object() {
        return Err((StatusCode::BAD_REQUEST, "The request isn't a JSON object".to_owned()));
    }
    Ok(value)
}

/// Forwards a request to the service, without the token; the custom renderer
/// base it returns gets the token back.
async fn forward(shared: &Shared, request: Request, path: &str) -> Result<Response, Failure> {
    let (parts, body) = request.into_parts();
    let uri = match parts.uri.query() {
        Some(query) => format!("{path}?{query}"),
        None => path.to_owned(),
    };
    let mut forwarded = Request::builder().method(parts.method).uri(uri);
    if let Some(kind) = parts.headers.get(header::CONTENT_TYPE) {
        forwarded = forwarded.header(header::CONTENT_TYPE, kind);
    }
    let forwarded = forwarded
        .body(body)
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid request".to_owned()))?;
    let response = shared.service.handle(forwarded).await;
    if path != "/api/renderers" || !response.status().is_success() {
        return Ok(response);
    }
    let bytes = to_bytes(response.into_body(), MAX_RESPONSE_BYTES)
        .await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "The renderer list is too large".to_owned()))?;
    let mut list: Value =
        serde_json::from_slice(&bytes).map_err(|_| (StatusCode::BAD_GATEWAY, "The renderer list isn't JSON".to_owned()))?;
    if let Some(base) = list["customRendererBase"].as_str().filter(|base| base.starts_with('/')) {
        list["customRendererBase"] = json!(format!("/{}{base}", shared.token));
    }
    Ok(json_response(StatusCode::OK, &list))
}
