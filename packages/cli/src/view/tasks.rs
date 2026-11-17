//! The viewer's background tasks: each holds the server weakly and ends with it.

use std::{sync::Arc, time::Duration};

use super::{Shared, get, shown_projections, stop};

/// Tracks each viewer's shown projection's build phase, for its pages' status line.
pub(super) fn track_builds(shared: &Arc<Shared>) {
    let Some(builds) = shared.service.renderer_builds() else {
        return;
    };
    let weak = Arc::downgrade(shared);
    let mut changes = builds.subscribe();
    let mut shown = shared.shown.subscribe();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                changed = changes.changed() => if changed.is_err() { return },
                changed = shown.changed() => if changed.is_err() { return },
            }
            let Some(shared) = weak.upgrade() else { return };
            for view in shared.views.all() {
                let phase = view
                    .projection()
                    .and_then(|projection| builds.state(&projection))
                    .map(|state| state.phase.name());
                view.build.send_if_modified(|(version, current)| {
                    if *current == phase {
                        return false;
                    }
                    *version += 1;
                    *current = phase;
                    true
                });
            }
        }
    });
}

/// Rebuilds the shown projections' custom renderers when a renderer source is saved.
pub(super) fn rebuild_on_save(shared: &Arc<Shared>) {
    let Some(mut changes) = shared.service.changes() else {
        return;
    };
    let weak = Arc::downgrade(shared);
    tokio::spawn(async move {
        while changes.next().await.is_some() {
            let Some(shared) = weak.upgrade() else { return };
            let projections = shown_projections(&shared);
            if projections.is_empty() {
                continue;
            }
            let (Some(builds), Ok(list)) = (
                shared.service.renderer_builds(),
                get(&shared.service, "/api/definitions?ref=working-tree").await,
            ) else {
                continue;
            };
            for definition in list["definitions"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|item| projections.iter().any(|projection| item["id"] == projection.as_str()))
            {
                if let Some(projection) = definition["id"].as_str() {
                    let _ = builds.event(projection, definition, "changed");
                }
            }
        }
    });
}

/// Stops the server after `idle` with no page and no control call.
pub(super) fn stop_when_idle(shared: &Arc<Shared>, idle: Duration) {
    let weak = Arc::downgrade(shared);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5).min(idle)).await;
            let Some(shared) = weak.upgrade() else { return };
            let quiet = shared.activity.lock().unwrap_or_else(|e| e.into_inner()).elapsed();
            if shared.pages() == 0 && quiet >= idle {
                stop(&shared);
                return;
            }
        }
    });
}
