//! A browser kept for the next render, so a command or service that renders
//! several times starts one browser rather than one per render.

use std::{
    sync::{Arc, Condvar, Mutex, MutexGuard},
    thread,
    time::{Duration, Instant},
};

use anyhow::Result;

use super::{Browser, LaunchOptions, Page, session::Launched};

/// Where renders take a browser from and give it back to. Clones share it.
#[derive(Clone, Default)]
pub struct Pool {
    shared: Arc<Shared>,
    /// Closes a kept browser that no render takes for this long.
    idle: Option<Duration>,
}

#[derive(Default)]
struct Shared {
    kept: Mutex<Kept>,
    /// Wakes the expiry worker when the kept browser or its expiry changes.
    changed: Condvar,
}

#[derive(Default)]
struct Kept {
    browser: Option<Browser>,
    /// When the kept browser closes unless a render takes it first.
    expires: Option<Instant>,
    /// Whether the one expiry worker is running; it runs only while a browser is kept.
    worker: bool,
    /// Expiry workers started, for tests.
    workers_started: usize,
    /// Keeps nothing: every browser given back is closed.
    closed: bool,
}

impl Drop for Kept {
    fn drop(&mut self) {
        if let Some(browser) = self.browser.take() {
            let _ = browser.close();
        }
    }
}

impl Pool {
    /// Keeps a browser until [`Pool::close`], or the last clone is dropped.
    pub fn new() -> Self {
        Self::default()
    }

    /// Also closes a kept browser once no render has taken it for `idle`. One
    /// worker thread waits out the expiry while a browser is kept, and each
    /// render that gives a browser back moves the expiry later.
    pub fn expiring(idle: Duration) -> Self {
        Self {
            idle: Some(idle),
            ..Self::default()
        }
    }

    /// Keeps nothing: each render starts its own browser and closes it.
    pub fn single_use() -> Self {
        let pool = Self::default();
        pool.lock().closed = true;
        pool
    }

    fn lock(&self) -> MutexGuard<'_, Kept> {
        self.shared.kept.lock().unwrap_or_else(|error| error.into_inner())
    }

    /// A browser launched with `options`: the kept one when it was launched the
    /// same way and still runs, else a new one.
    pub fn take(&self, options: LaunchOptions<'_>) -> Result<Browser> {
        let kept = {
            let mut kept = self.lock();
            kept.expires = None;
            kept.browser.take()
        };
        if let Some(mut browser) = kept {
            if browser.launched == Launched::of(&options) && browser.running() {
                browser.set_cancel(options.cancel);
                return Ok(browser);
            }
            let _ = browser.close();
        }
        Browser::launch(options)
    }

    /// Gives back `browser` after a render on `page`: kept for the next render
    /// when it is still running and the page closes, otherwise closed. A
    /// browser kept before is closed. Fails when a browser closed here could not be stopped.
    pub fn give(&self, mut browser: Browser, page: Page) -> Result<()> {
        let reusable = !self.lock().closed && browser.running() && browser.close_page(page).is_ok();
        if !reusable {
            return browser.close();
        }
        let replaced = {
            let mut kept = self.lock();
            if kept.closed {
                Some(browser)
            } else {
                let replaced = kept.browser.replace(browser);
                if let Some(idle) = self.idle {
                    kept.expires = Some(Instant::now() + idle);
                    if !kept.worker {
                        kept.worker = true;
                        kept.workers_started += 1;
                        let shared = self.shared.clone();
                        thread::spawn(move || expire(&shared));
                    }
                    self.shared.changed.notify_all();
                }
                replaced
            }
        };
        match replaced {
            Some(replaced) => replaced.close(),
            None => Ok(()),
        }
    }

    /// Closes the kept browser, and every browser given back after.
    pub fn close(&self) {
        let browser = {
            let mut kept = self.lock();
            kept.closed = true;
            kept.expires = None;
            kept.browser.take()
        };
        self.shared.changed.notify_all();
        if let Some(browser) = browser {
            let _ = browser.close();
        }
    }

    #[cfg(test)]
    pub(super) fn kept(&self) -> bool {
        self.lock().browser.is_some()
    }

    #[cfg(test)]
    pub(super) fn workers_started(&self) -> usize {
        self.lock().workers_started
    }
}

/// The expiry worker: closes the kept browser once its expiry passes, and
/// stops when no browser is kept.
fn expire(shared: &Shared) {
    let mut kept = shared.kept.lock().unwrap_or_else(|error| error.into_inner());
    loop {
        let Some(expires) = kept.expires.filter(|_| kept.browser.is_some() && !kept.closed) else {
            kept.worker = false;
            return;
        };
        let now = Instant::now();
        if now >= expires {
            let browser = kept.browser.take();
            kept.expires = None;
            kept.worker = false;
            drop(kept);
            if let Some(browser) = browser {
                let _ = browser.close();
            }
            return;
        }
        kept = shared
            .changed
            .wait_timeout(kept, expires - now)
            .unwrap_or_else(|error| error.into_inner())
            .0;
    }
}
