//! A per-user limit on how many browsers start at once, across every process.
//!
//! macOS aborts headless Chrome (SIGABRT in HIServices `_RegisterApplication`)
//! when many register with the window server at the same moment, as parallel
//! tests or several sessions' renders do. Every launch first takes one of
//! [`SLOTS`] lock files in the per-user cache and holds it from spawning the
//! browser until its DevTools connection answers, so launches are staggered
//! while running browsers are not limited. The operating system releases a lock
//! when its file closes, so a process that dies frees its slot. The limit is best
//! effort: when the slots can't be opened or locked, or none frees within
//! [`PATIENCE`], the browser starts anyway.

use std::{
    fs::{File, OpenOptions, TryLockError},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

use anyhow::{Result, ensure};

/// How many browsers may be starting at once.
const SLOTS: usize = 2;
/// How long a launch waits for a slot before starting without one.
const PATIENCE: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_millis(25);

/// A held launch slot, released when dropped; empty when the limit couldn't apply.
pub(super) struct Slot {
    _lock: Option<File>,
}

impl Slot {
    #[cfg(test)]
    pub(super) fn held(&self) -> bool {
        self._lock.is_some()
    }
}

/// Waits for a launch slot, or until `cancel` is set.
pub(super) fn acquire(cancel: &AtomicBool) -> Result<Slot> {
    let directory = match crate::cache::base() {
        Ok(base) => base.join("browser-launches"),
        Err(_) => return Ok(Slot { _lock: None }),
    };
    if crate::cache::private_directory(&directory).is_err() {
        return Ok(Slot { _lock: None });
    }
    acquire_in(&directory, cancel, PATIENCE)
}

pub(super) fn acquire_in(directory: &Path, cancel: &AtomicBool, patience: Duration) -> Result<Slot> {
    let mut files: Vec<File> = match (0..SLOTS)
        .map(|slot| {
            OpenOptions::new()
                .create(true)
                .truncate(false)
                .write(true)
                .open(directory.join(format!("slot-{slot}.lock")))
        })
        .collect()
    {
        Ok(files) => files,
        Err(_) => return Ok(Slot { _lock: None }),
    };
    let deadline = Instant::now() + patience;
    loop {
        for index in 0..files.len() {
            match files[index].try_lock() {
                // The lock belongs to this handle, so the slot keeps it rather than a duplicate.
                Ok(()) => {
                    return Ok(Slot {
                        _lock: Some(files.swap_remove(index)),
                    });
                }
                Err(TryLockError::WouldBlock) => {}
                Err(TryLockError::Error(_)) => return Ok(Slot { _lock: None }),
            }
        }
        ensure!(!cancel.load(Ordering::SeqCst), "Cancelled");
        if Instant::now() >= deadline {
            return Ok(Slot { _lock: None });
        }
        thread::sleep(POLL);
    }
}
