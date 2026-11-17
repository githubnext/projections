//! History sweeps and their diff thumbnails.

use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use anyhow::Result;
use axum::{
    body::Body,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use uuid::Uuid;

use super::{
    http::{HttpError, query_value},
    state::{ServiceState, WORKING_TREE},
};
use crate::runtime::DefinitionSource;

/// A history sweep the Inspector started.
pub(super) struct SweepRun {
    pub(super) id: String,
    pub(super) status: &'static str,
    pub(super) error: Option<String>,
    pub(super) changes: Vec<Value>,
    /// The same changes, for bookmarking them.
    pub(super) swept: Vec<crate::sweep::Change>,
    rows: Vec<Value>,
    pub(super) cells: Vec<Value>,
    /// Each changed cell's comparison, by `projection|before|after`, for its thumbnail.
    pub(super) comparisons: HashMap<String, Arc<Value>>,
    pub(super) cancel: Arc<AtomicBool>,
}

impl SweepRun {
    pub(super) fn value(&self) -> Value {
        json!({"id": self.id, "status": self.status, "error": self.error, "changes": self.changes,
            "projections": self.rows, "cells": self.cells})
    }
}

/// Thumbnails kept at most.
const MAX_THUMBNAILS: usize = 200;

/// Starts a history sweep, cancelling the one before.
pub(super) fn start_sweep(state: &Arc<ServiceState>, body: &Value) -> Result<Value, HttpError> {
    let invalid = |message: &str| HttpError::new(StatusCode::BAD_REQUEST, message);
    // `{"cancel": true}` stops the running sweep, keeping what it found.
    if body["cancel"] == true {
        let sweep = state.sweep.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(sweep) = sweep.as_ref() {
            sweep.cancel.store(true, Ordering::SeqCst);
        }
        return Ok(json!({"sweep": sweep.as_ref().map(SweepRun::value)}));
    }
    // Pairs to sweep beside the recent changes (bookmarks, say): `[{before, after, title?}]`.
    let pairs: Vec<(String, String, String)> = match &body["pairs"] {
        Value::Null => Vec::new(),
        Value::Array(pairs) if pairs.len() <= 20 => pairs
            .iter()
            .map(|pair| {
                let side = |name: &str| {
                    pair[name]
                        .as_str()
                        .filter(|value| !value.is_empty() && value.len() <= 200)
                        .map(str::to_owned)
                };
                let title = pair["title"].as_str().unwrap_or_default().chars().take(200).collect();
                Some((side("before")?, side("after")?, title))
            })
            .collect::<Option<_>>()
            .ok_or_else(|| invalid("pairs must have before and after revisions"))?,
        _ => return Err(invalid("pairs must be at most 20 pairs")),
    };
    let last = match &body["last"] {
        Value::Null => crate::sweep::DEFAULT_LAST,
        // Only the pairs.
        Value::Number(number) if number.as_u64() == Some(0) && !pairs.is_empty() => 0,
        value => value
            .as_u64()
            .and_then(|last| usize::try_from(last).ok())
            .filter(|last| (1..=crate::sweep::MAX_LAST).contains(last))
            .ok_or_else(|| invalid("last must be 1-100"))?,
    };
    let requested: Option<Vec<String>> = match &body["projections"] {
        Value::Null => None,
        Value::Array(ids) if ids.len() <= 50 => Some(
            ids.iter()
                .map(|id| id.as_str().filter(|id| !id.is_empty() && id.len() <= 100).map(str::to_owned))
                .collect::<Option<_>>()
                .ok_or_else(|| invalid("projections must be projection IDs"))?,
        ),
        _ => return Err(invalid("projections must be at most 50 projection IDs")),
    };
    if state.closing.load(Ordering::SeqCst) {
        return Err(HttpError::new(StatusCode::SERVICE_UNAVAILABLE, "Inspector is closing"));
    }
    let runner = state.runner();
    let cancel = runner.cancel.clone();
    let id = Uuid::new_v4().to_string();
    {
        let mut sweep = state.sweep.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(previous) = sweep.as_ref() {
            previous.cancel.store(true, Ordering::SeqCst);
        }
        *sweep = Some(SweepRun {
            id: id.clone(),
            status: "running",
            error: None,
            changes: Vec::new(),
            swept: Vec::new(),
            rows: Vec::new(),
            cells: Vec::new(),
            comparisons: HashMap::new(),
            cancel: cancel.clone(),
        });
    }
    let weak = Arc::downgrade(state);
    let candidates = state.explore.clone();
    let cache = state.sweep_cache.clone();
    let sweep_id = id.clone();
    tokio::task::spawn_blocking(move || {
        // Updates this sweep's record, unless a newer sweep replaced it.
        let update = |change: &dyn Fn(&mut SweepRun)| {
            if let Some(state) = weak.upgrade() {
                let mut sweep = state.sweep.lock().unwrap_or_else(|error| error.into_inner());
                if let Some(sweep) = sweep.as_mut().filter(|sweep| sweep.id == sweep_id) {
                    change(sweep);
                }
            }
        };
        let result = (|| -> anyhow::Result<()> {
            let root = runner.repository_root()?;
            let projections = match requested {
                Some(ids) => ids,
                None => {
                    let candidates = match &candidates {
                        Some(candidates) => candidates.clone(),
                        None => crate::explore::candidates(&runner, &root)?,
                    };
                    crate::sweep::projections(&runner, &candidates)?
                }
            };
            let mut changes = if last == 0 {
                Vec::new()
            } else {
                crate::sweep::changes(&runner, &root, last)?
            };
            // Each pair at its commits; one that doesn't name commits here is left out.
            for (before, after, title) in &pairs {
                if let (Ok(before), Ok(after)) = (runner.resolve(&root, before), runner.resolve(&root, after))
                    && !changes.iter().any(|change| change.before == before && change.after == after)
                {
                    changes.push(crate::sweep::Change {
                        before,
                        after,
                        title: title.clone(),
                        number: None,
                        kind: "pair",
                        date: String::new(),
                    });
                }
            }
            let listed: Vec<Value> = changes.iter().map(crate::sweep::Change::json).collect();
            update(&|sweep| {
                sweep.changes = listed.clone();
                sweep.swept = changes.clone();
            });
            crate::sweep::run(
                &runner,
                crate::sweep::Request {
                    projections,
                    changes,
                    cache: &cache,
                    concurrency: crate::sweep::DEFAULT_CONCURRENCY,
                },
                &|row| update(&|sweep| sweep.rows.push(row.clone())),
                &|cell| {
                    let key = format!(
                        "{}|{}|{}",
                        cell.value["projection"].as_str().unwrap_or_default(),
                        cell.value["before"].as_str().unwrap_or_default(),
                        cell.value["after"].as_str().unwrap_or_default()
                    );
                    update(&|sweep| {
                        sweep.cells.push(cell.value.clone());
                        if let Some(comparison) = &cell.comparison {
                            sweep.comparisons.insert(key.clone(), comparison.clone());
                        }
                    })
                },
            )
        })();
        let cancelled = cancel.load(Ordering::SeqCst);
        update(&|sweep| {
            sweep.status = match (&result, cancelled) {
                (_, true) => "cancelled",
                (Ok(()), false) => "completed",
                (Err(_), false) => "failed",
            };
            if let Err(error) = &result {
                sweep.error = Some(format!("{error:#}"));
            }
        });
    });
    Ok(json!({"id": id, "status": "running"}))
}

/// A swept change's Diff, as a small PNG; rendered on request, one at a time, and kept.
pub(super) async fn sweep_thumbnail(state: &Arc<ServiceState>, query: Option<&str>) -> Result<Response, HttpError> {
    let parameter = |name: &str| -> Result<String, HttpError> {
        query_value(query, name)?
            .filter(|value| !value.is_empty() && value.len() <= 200)
            .ok_or_else(|| HttpError::new(StatusCode::BAD_REQUEST, format!("{name} is required")))
    };
    // The colour mode to draw in (`light`, the default, or `dark`).
    let theme = match query_value(query, "theme")?.as_deref() {
        None | Some("light") => crate::snapshot::Theme::Light,
        Some("dark") => crate::snapshot::Theme::Dark,
        Some(_) => {
            return Err(HttpError::new(StatusCode::BAD_REQUEST, "theme must be light or dark"));
        }
    };
    let key = format!("{}|{}|{}", parameter("projection")?, parameter("before")?, parameter("after")?);
    let (sweep_id, comparison) = state
        .sweep
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .as_ref()
        .and_then(|sweep| {
            let comparison = sweep.comparisons.get(&key).cloned()?;
            Some((sweep.id.clone(), comparison))
        })
        .ok_or_else(|| HttpError::new(StatusCode::NOT_FOUND, "That change has no comparison in the current sweep"))?;
    // Kept per sweep: a sweep again (after a renderer edit, say) renders its thumbnails again.
    // Kept per theme too: a host shows thumbnails in its own colour mode.
    let key = format!("{sweep_id}|{}|{key}", theme.name());
    let png = |bytes: Arc<Vec<u8>>| {
        let mut response = Body::from(bytes.as_ref().clone()).into_response();
        response.headers_mut().insert("content-type", "image/png".parse().unwrap());
        response.headers_mut().insert("cache-control", "no-store".parse().unwrap());
        response
    };
    let cached = || {
        state
            .thumbnails
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .iter()
            .find(|(cached, _)| *cached == key)
            .map(|(_, bytes)| bytes.clone())
    };
    if let Some(bytes) = cached() {
        return Ok(png(bytes));
    }
    // One render at a time, each a browser; the render keeps the lock even if this request times out.
    let rendering = state.rendering.clone().lock_owned().await;
    if let Some(bytes) = cached() {
        return Ok(png(bytes));
    }
    let failed = |error: anyhow::Error| HttpError::new(StatusCode::BAD_REQUEST, format!("{error:#}"));
    let browser = crate::browser::find(None).map_err(failed)?;
    let assets = state.assets.clone();
    let (repo, trust, cancel) = (state.repo.clone(), state.trust, state.rendering_cancel.clone());
    let stopped = cancel.clone();
    let request = move |mode| crate::snapshot::Request {
        document: comparison.as_ref().clone(),
        repo: repo.clone(),
        trust,
        definition: DefinitionSource::Base,
        definition_revision: Some(WORKING_TREE.to_owned()),
        assets: assets.clone(),
        mode,
        progress: None,
        focus: crate::snapshot::Focus::default(),
        theme,
        // Thumbnails keep the Inspector's own look.
        frame: crate::snapshot::Frame::Page,
        matte: None,
        // A desktop-sized view, scaled down: the whole picture in a small image.
        width: 960,
        height: 600,
        scale: 0.5,
        browser: browser.clone(),
        transport: crate::browser::Transport::default(),
        timeout: Duration::from_secs(25),
        cancel: cancel.clone(),
    };
    // The Diff when the renderer draws one; else its default view. A browser
    // session is driven on its own thread, off the server's workers, and keeps
    // its thumbnail even if this request times out, for the client to ask again.
    let cache = state.clone();
    let browsers = state.browsers.clone();
    let rendered = tokio::task::spawn_blocking(move || {
        let _rendering = rendering;
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
        let rendered = runtime.block_on(async {
            match crate::snapshot::render_with(request(Some(crate::snapshot::Mode::Diff)), &browsers).await {
                Ok(rendered) => Ok(rendered),
                Err(error) if stopped.load(Ordering::SeqCst) => Err(error),
                Err(_) => crate::snapshot::render_with(request(None), &browsers).await,
            }
        })?;
        let bytes = Arc::new(rendered.png);
        let mut thumbnails = cache.thumbnails.lock().unwrap_or_else(|error| error.into_inner());
        thumbnails.push_back((key, bytes.clone()));
        while thumbnails.len() > MAX_THUMBNAILS {
            thumbnails.pop_front();
        }
        Ok::<_, anyhow::Error>(bytes)
    })
    .await
    .map_err(|error| failed(error.into()))?
    .map_err(failed)?;
    Ok(png(rendered))
}
