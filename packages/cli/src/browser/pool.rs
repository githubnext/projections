//! A browser kept for the next render, so a command or service that renders
//! several times starts one browser rather than one per render.

use std::{
    sync::{Arc, Mutex, MutexGuard},
    thread,
    time::Duration,
};

use anyhow::Result;

use super::{Browser, LaunchOptions, Page, session::Launched};

/// Where renders take a browser from and give it back to. Clones share it.
#[derive(Clone, Default)]
pub struct Pool {
    shared: Arc<Mutex<Kept>>,
    /// Closes a kept browser that no render takes for this long.
    idle: Option<Duration>,
}

#[derive(Default)]
struct Kept {
    browser: Option<Browser>,
    /// Changes whenever the kept browser does, so an expiry finds whether its browser is still the kept one.
    generation: u64,
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

    /// Also closes a kept browser once no render has taken it for `idle`.
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
        self.shared.lock().unwrap_or_else(|error| error.into_inner())
    }

    /// A browser launched with `options`: the kept one when it was launched the
    /// same way and still runs, else a new one.
    pub fn take(&self, options: LaunchOptions<'_>) -> Result<Browser> {
        let kept = {
            let mut kept = self.lock();
            kept.generation += 1;
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
        let (replaced, generation) = {
            let mut kept = self.lock();
            if kept.closed {
                (Some(browser), None)
            } else {
                kept.generation += 1;
                (kept.browser.replace(browser), Some(kept.generation))
            }
        };
        if let (Some(idle), Some(generation)) = (self.idle, generation) {
            let shared = Arc::downgrade(&self.shared);
            thread::spawn(move || {
                thread::sleep(idle);
                let Some(shared) = shared.upgrade() else { return };
                let expired = {
                    let mut kept = shared.lock().unwrap_or_else(|error| error.into_inner());
                    if kept.generation == generation { kept.browser.take() } else { None }
                };
                if let Some(browser) = expired {
                    let _ = browser.close();
                }
            });
        }
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
            kept.browser.take()
        };
        if let Some(browser) = browser {
            let _ = browser.close();
        }
    }
}
