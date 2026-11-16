//! What the pages see and report: a viewer's long-polled state, its pages'
//! reports, and its state with what they show, for the agents.

use std::{collections::HashMap, sync::Arc, time::Duration, time::Instant};

use axum::{http::StatusCode, response::Response};
use serde_json::{Value, json};

use super::{NamedView, Shared, routes::json_response, view_url};

/// How long a page's state request waits for a change.
const LONG_POLL: Duration = Duration::from_secs(20);

/// A request's query, as names and values.
pub(super) fn query_map(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect()
}

/// `GET view/state?since=N&page=ID&viewer=NAME`: the viewer's state once its generation passes `since`, or after the
/// long poll.
pub(super) async fn page_state(shared: &Arc<Shared>, view: &NamedView, query: &HashMap<String, String>) -> Response {
    let since = query.get("since").and_then(|value| value.parse::<u64>().ok());
    let page = query
        .get("page")
        .filter(|page| page.len() <= 64 && page.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-'))
        .cloned();
    let seen = |shared: &Shared| {
        if let Some(page) = &page {
            let mut pages = view.pages.lock().unwrap_or_else(|e| e.into_inner());
            pages
                .entry(page.clone())
                .and_modify(|(seen, _)| *seen = Instant::now())
                .or_insert((Instant::now(), Value::Null));
        }
        shared.touch();
    };
    seen(shared);
    let build_since = query.get("build").and_then(|value| value.parse::<u64>().ok());
    if let Some(since) = since {
        let mut receiver = view.state.subscribe();
        let mut builds = view.build.subscribe();
        let mut closing = shared.closing.subscribe();
        tokio::select! {
            _ = tokio::time::timeout(LONG_POLL, receiver.wait_for(|state| state.generation != since)) => {}
            _ = builds.wait_for(|(version, _)| build_since.is_some_and(|since| *version != since)) => {}
            _ = closing.wait_for(|closing| *closing) => {}
        }
        seen(shared);
    }
    let mut value = view.state.borrow().json();
    let (version, phase) = *view.build.borrow();
    value["build"] = json!({"version": version, "phase": phase});
    value["instance"] = json!(shared.instance);
    value["viewer"] = json!(view.name);
    json_response(StatusCode::OK, &value)
}

/// `POST view/report`: what a page of `view` presents and the person's interactions.
pub(super) fn report(shared: &Shared, view: &NamedView, body: Value) {
    let Some(page) = body["page"].as_str().filter(|page| page.len() <= 64).map(str::to_owned) else {
        return;
    };
    let generation = body["generation"].as_u64().unwrap_or(u64::MAX);
    let selection = body["selection"].as_str();
    let mode = body["mode"].as_str();
    view.state.send_if_modified(|state| state.report(generation, selection, mode));
    shared.touch();
    let brief = json!({"page": page, "generation": body["generation"], "selection": body["selection"], "mode": body["mode"]});
    view.pages
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(page, (Instant::now(), brief));
    *view.shown.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), body));
}

/// A viewer's state with what its pages show: `{state, viewer, url, pid, pages, views, page, viewers}`, `viewers`
/// every viewer the server has, each with its name, URL, pages and what it shows.
pub(super) fn control_state(shared: &Shared, view: &NamedView) -> Value {
    let shown = view.shown.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|(at, report)| {
        let mut report = report.clone();
        report["age"] = json!(at.elapsed().as_secs());
        report
    });
    let count = view.pages();
    let mut views: Vec<Value> = view
        .pages
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .filter(|(_, brief)| !brief.is_null())
        .map(|(_, brief)| brief.clone())
        .collect();
    views.sort_by(|a, b| a["page"].as_str().cmp(&b["page"].as_str()));
    let viewers: Vec<Value> = shared
        .views
        .all()
        .iter()
        .map(|other| {
            let state = other.state.borrow();
            json!({"name": other.name, "url": view_url(shared, other), "pages": other.pages(), "projection": state.projection, "title": state.title, "compared": state.compared})
        })
        .collect();
    json!({
        "state": view.state.borrow().json(),
        "viewer": view.name,
        "url": view_url(shared, view),
        "pid": std::process::id(),
        "pages": count,
        "views": views,
        "page": shown,
        "viewers": viewers,
    })
}
