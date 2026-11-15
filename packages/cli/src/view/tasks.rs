//! The viewer's background tasks: each holds the server weakly and ends with it.

use std::{sync::Arc, time::Duration};

use super::{Shared, get, stop};

/// Tracks the shown projection's build phase, for the pages' status line.
pub(super) fn track_builds(shared: &Arc<Shared>) {
    let Some(builds) = shared.service.renderer_builds() else {
        return;
    };
    let weak = Arc::downgrade(shared);
    let mut changes = builds.subscribe();
    let mut shown = shared.state.subscribe();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                changed = changes.changed() => if changed.is_err() { return },
                changed = shown.changed() => if changed.is_err() { return },
            }
            let Some(shared) = weak.upgrade() else { return };
            let projection = shared.state.borrow().projection.clone();
            let phase = projection
                .and_then(|projection| builds.state(&projection))
                .map(|state| state.phase.name());
            shared.build.send_if_modified(|(version, current)| {
                if *current == phase {
                    return false;
                }
                *version += 1;
                *current = phase;
                true
            });
        }
    });
}

/// Rebuilds the shown projection's custom renderer when a renderer source is saved.
pub(super) fn rebuild_on_save(shared: &Arc<Shared>) {
    let Some(mut changes) = shared.service.changes() else {
        return;
    };
    let weak = Arc::downgrade(shared);
    tokio::spawn(async move {
        while changes.next().await.is_some() {
            let Some(shared) = weak.upgrade() else { return };
            let Some(projection) = shared.state.borrow().projection.clone() else {
                continue;
            };
            let (Some(builds), Ok(list)) = (
                shared.service.renderer_builds(),
                get(&shared.service, "/api/definitions?ref=working-tree").await,
            ) else {
                continue;
            };
            if let Some(definition) = list["definitions"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|item| item["id"] == projection.as_str())
            {
                let _ = builds.event(&projection, definition, "changed");
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
