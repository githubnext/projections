//! Watching the working tree and fixture files, and long polls for their changes.

use std::{
    sync::{Arc, Weak, atomic::Ordering},
    time::Duration,
};

use serde_json::{Value, json};
use tokio::{
    sync::watch,
    time::{sleep, timeout},
};

use super::state::{FixturesState, ServiceState, Snapshot, WorkspaceChanges};
use crate::{fixtures, runtime::Runner};

const FIXTURES_POLL: Duration = Duration::from_millis(250);
const FIXTURES_LONG_POLL: Duration = Duration::from_secs(20);

/// Generations of working-tree changes kept for `GET /api/changes`.
const CHANGE_LOG: usize = 64;
const WORKSPACE_POLL: Duration = Duration::from_millis(500);
pub(super) fn fixtures_response(snapshot: &Snapshot) -> Value {
    let mut value = snapshot.fixtures.value.clone();
    value["generation"] = json!(snapshot.generation);
    value
}

/// Waits up to 20 s for the fixtures generation to differ from `since`.
pub(super) async fn fixtures_changes(state: &ServiceState, fixtures: &FixturesState, since: u64) -> u64 {
    let mut receiver = fixtures.current.subscribe();
    let _ = timeout(FIXTURES_LONG_POLL, async {
        loop {
            if receiver.borrow_and_update().generation != since || state.closing.load(Ordering::SeqCst) || receiver.changed().await.is_err()
            {
                return;
            }
        }
    })
    .await;
    receiver.borrow().generation
}

/// Waits up to the long-poll period for a working-tree generation after
/// `since`, and returns the current generation and the kinds changed since
/// `since`; `complete` is false when `since` is older than the change log.
pub(super) async fn workspace_changes(state: &ServiceState, workspace: &watch::Sender<WorkspaceChanges>, since: u64) -> Value {
    let mut receiver = workspace.subscribe();
    let _ = timeout(FIXTURES_LONG_POLL, async {
        loop {
            if receiver.borrow_and_update().generation != since || state.closing.load(Ordering::SeqCst) || receiver.changed().await.is_err()
            {
                return;
            }
        }
    })
    .await;
    changes_since(&receiver.borrow(), since)
}

/// `{"generation", "changes", "complete"}`: the current working-tree
/// generation and the kinds changed since `since`; `complete` is false when
/// `since` is older than the change log.
pub(super) fn changes_since(current: &WorkspaceChanges, since: u64) -> Value {
    let mut changes: Vec<&str> = current
        .log
        .iter()
        .filter(|(generation, _)| *generation > since)
        .flat_map(|(_, kinds)| kinds.iter().map(String::as_str))
        .collect();
    changes.sort_unstable();
    changes.dedup();
    let complete = since >= current.generation || current.log.front().is_some_and(|(oldest, _)| *oldest <= since + 1);
    let mut value = json!({"generation": current.generation, "changes": changes, "complete": complete});
    if let Some(tree) = &current.tree {
        value["tree"] = json!(tree);
    }
    value
}

/// Polls the working tree and records which projection parts changed.
pub(super) async fn watch_workspace(state: Weak<ServiceState>, mut previous: crate::workspace::State) {
    loop {
        sleep(WORKSPACE_POLL).await;
        let Some(state) = state.upgrade() else {
            return;
        };
        if state.closing.load(Ordering::SeqCst) {
            return;
        }
        let Some(workspace) = &state.workspace else {
            return;
        };
        let root = state.repo.clone();
        let unchanged = previous.clone();
        // A change is reported once the files are quiet, so a save that truncates
        // and then writes, or writes in chunks, is one change, read whole.
        let Ok(current) = tokio::task::spawn_blocking(move || {
            let runner = Runner::new(root.clone(), false);
            let current = crate::workspace::state(&runner, &root);
            if current == unchanged {
                return current;
            }
            crate::workspace::settle(|| crate::workspace::state(&runner, &root), current)
        })
        .await
        else {
            continue;
        };
        let changes = crate::workspace::changes(&previous, &current);
        previous = current;
        if changes.is_empty() {
            continue;
        }
        // The new identity, so a client can tell which results are out of date.
        let root = state.repo.clone();
        let tree = tokio::task::spawn_blocking(move || Runner::new(root, false).working_tree().ok())
            .await
            .ok()
            .flatten();
        workspace.send_modify(|log| {
            log.tree = tree;
            log.generation += 1;
            log.log.push_back((log.generation, changes));
            while log.log.len() > CHANGE_LOG {
                log.log.pop_front();
            }
        });
    }
}

/// Polls every watched fixture file and reloads when any changes.
pub(super) async fn watch_fixtures(state: Weak<ServiceState>, mut previous: fixtures::Fingerprint) {
    loop {
        sleep(FIXTURES_POLL).await;
        let Some(state) = state.upgrade() else {
            return;
        };
        if state.closing.load(Ordering::SeqCst) {
            return;
        }
        let Some(fixtures) = &state.fixtures else {
            return;
        };
        let watched = fixtures.current.borrow().fixtures.watched.clone();
        let paths = watched.clone();
        let Ok(current) = tokio::task::spawn_blocking(move || fixtures::fingerprint(&paths)).await else {
            continue;
        };
        if current == previous {
            continue;
        }
        let (sources, renderers, base) = (fixtures.sources.clone(), fixtures.renderers.clone(), fixtures.base.clone());
        let Ok((loaded, fingerprint)) = tokio::task::spawn_blocking(move || {
            let loaded = fixtures::load(&sources, &renderers, &base, false);
            // The fingerprint taken before reading, so a file written while
            // loading still differs at the next poll and is loaded again. Only
            // paths the load newly watches are fingerprinted after it.
            let fingerprint = if loaded.watched == watched {
                current
            } else {
                fixtures::fingerprint(&loaded.watched)
            };
            (loaded, fingerprint)
        })
        .await
        else {
            continue;
        };
        previous = fingerprint;
        fixtures.current.send_modify(|snapshot| {
            *snapshot = Arc::new(Snapshot {
                generation: snapshot.generation + 1,
                fixtures: loaded,
            });
        });
    }
}
