//! Pages in their own browser contexts, so one browser can serve several
//! renders: a page leaves no cookies, storage, cache or workers to the next.

use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use serde_json::json;

use super::Browser;

/// A blank page in its own browser context, and its flattened DevTools session.
pub struct Page {
    pub session: String,
    context: String,
}

impl Browser {
    /// Opens a blank page in a new browser context.
    pub fn open_page(&mut self, deadline: Instant) -> Result<Page> {
        let context = self.call("Target.createBrowserContext", json!({}), None, deadline)?;
        let context = context["browserContextId"]
            .as_str()
            .context("The browser created no context")?
            .to_owned();
        let target = self.call(
            "Target.createTarget",
            json!({"url": "about:blank", "browserContextId": context}),
            None,
            deadline,
        )?;
        let target = target["targetId"].as_str().context("The browser created no page")?;
        let attached = self.call(
            "Target.attachToTarget",
            json!({"targetId": target, "flatten": true}),
            None,
            deadline,
        )?;
        let session = attached["sessionId"]
            .as_str()
            .context("The browser attached no session")?
            .to_owned();
        Ok(Page { session, context })
    }

    /// Closes `page` with its context and stops handling events, so the browser
    /// can serve another page.
    pub fn close_page(&mut self, page: Page) -> Result<()> {
        self.clear_events();
        let deadline = Instant::now() + Duration::from_secs(5);
        self.call(
            "Target.disposeBrowserContext",
            json!({"browserContextId": page.context}),
            None,
            deadline,
        )?;
        Ok(())
    }
}
