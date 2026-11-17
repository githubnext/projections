//! What the viewer has seen of pages that never counted as open, so `current_view` can say why none is: a page that
//! loaded but never ran its script or never asked for the state, one that stopped asking (closed, hidden or suspended),
//! requests refused for naming another host, and requests without the token (the bare port, or a rotated link).
//! Only counts and times are kept: nothing a request sent (its `Host`, its path) reaches the agent, so a page can't
//! put words in its tools' answers.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use serde_json::{Value, json};

/// How long something seen is worth saying.
pub(super) const RECENT: Duration = Duration::from_secs(10 * 60);
/// The most viewers whose page loads are remembered.
const MAX_LOADS: usize = 64;

/// How often, and when last, something happened.
#[derive(Clone, Copy, Default)]
struct Tally {
    count: u64,
    last: Option<Instant>,
}

impl Tally {
    fn add(&mut self) {
        self.count += 1;
        self.last = Some(Instant::now());
    }

    fn recent(&self) -> Option<(u64, Duration)> {
        let age = self.last?.elapsed();
        (age < RECENT).then_some((self.count, age))
    }
}

#[derive(Default)]
struct Inner {
    /// Requests refused because their `Host` isn't a loopback name with this port.
    foreign_host: Tally,
    /// Requests without the token: the bare port, another path, or a link from before the token was rotated.
    without_token: Tally,
    /// When each viewer's page was last loaded, by its name.
    loaded: HashMap<String, Instant>,
    /// When a page last loaded its script.
    script: Option<Instant>,
}

/// What the server has seen; see the module.
#[derive(Default)]
pub(super) struct Seen(Mutex<Inner>);

impl Seen {
    fn with<T>(&self, f: impl FnOnce(&mut Inner) -> T) -> T {
        f(&mut self.0.lock().unwrap_or_else(|e| e.into_inner()))
    }

    pub fn foreign_host(&self) {
        self.with(|inner| inner.foreign_host.add());
    }

    pub fn without_token(&self) {
        self.with(|inner| inner.without_token.add());
    }

    /// A viewer's page was loaded.
    pub fn loaded(&self, viewer: &str) {
        self.with(|inner| {
            if inner.loaded.len() < MAX_LOADS || inner.loaded.contains_key(viewer) {
                inner.loaded.insert(viewer.to_owned(), Instant::now());
            }
        });
    }

    /// A page loaded its script.
    pub fn script(&self) {
        self.with(|inner| inner.script = Some(Instant::now()));
    }

    /// What it saw of the viewer `viewer`'s pages, whose last request was `asked` (none if no page ever asked), as
    /// `current_view` carries it: ages in seconds, when recent.
    pub fn json(&self, viewer: &str, asked: Option<Instant>) -> Value {
        self.with(|inner| {
            let age = |at: Option<Instant>| at.map(|at| at.elapsed()).filter(|age| *age < RECENT).map(|age| age.as_secs());
            let tally = |tally: &Tally| tally.recent().map(|(count, age)| json!({"count": count, "age": age.as_secs()}));
            json!({
                "pageLoaded": age(inner.loaded.get(viewer).copied()),
                "scriptLoaded": age(inner.script),
                "lastAsked": age(asked),
                "foreignHost": tally(&inner.foreign_host),
                "withoutToken": tally(&inner.without_token),
            })
        })
    }
}

/// Why no page of a viewer counts as open, in sentences for the agent, from what [`Seen::json`] says.
pub(super) fn explain(seen: &Value) -> Vec<String> {
    let age = |key: &str| seen[key].as_u64();
    let mut lines = Vec::new();
    match (age("pageLoaded"), age("lastAsked")) {
        (_, Some(asked)) => lines.push(format!(
            "A page of it stopped asking for the view {}: a page that is closed, hidden or suspended (a background tab, a minimized window, a collapsed preview pane) stops asking, and counts again once it asks.",
            ago(asked)
        )),
        (Some(loaded), None) if age("scriptLoaded").is_some_and(|script| script <= loaded) => lines.push(format!(
            "A page was loaded {} and loaded its script, but never asked for the view: its script didn't run to the end in what shows it (an old or restricted web view), or its requests don't reach this viewer.",
            ago(loaded)
        )),
        (Some(loaded), None) => lines.push(format!(
            "A page was loaded {} but never loaded its script: what shows it may block scripts.",
            ago(loaded)
        )),
        (None, None) => {}
    }
    if let Some((count, last)) = tally(&seen["foreignHost"]) {
        lines.push(format!(
            "{} {} refused for naming a host other than 127.0.0.1, localhost or [::1], the last {}: a preview pane or proxy that rewrites the address can't show the viewer, which answers only loopback names so that no website can reach it (DNS rebinding). Open the URL exactly as given.",
            requests(count),
            if count == 1 { "was" } else { "were" },
            ago(last)
        ));
    }
    if let Some((count, last)) = tally(&seen["withoutToken"]) {
        lines.push(format!(
            "{} came without the viewer's token, the last {}: the bare port, or a link from before its token was rotated. Open the URL exactly as given.",
            requests(count),
            ago(last)
        ));
    }
    if lines.is_empty() {
        lines.push(
            "Nothing has loaded its page in the last 10 minutes: what should show it hasn't opened this URL (another viewer, at another port, may be answering it), or its browser refused to (Chrome refuses loopback in a frame of a page that isn't a secure context)."
                .to_owned(),
        );
    }
    lines
}

fn tally(value: &Value) -> Option<(u64, u64)> {
    Some((value["count"].as_u64()?, value["age"].as_u64()?))
}

fn requests(count: u64) -> String {
    if count == 1 {
        "One request".to_owned()
    } else {
        format!("{count} requests")
    }
}

/// An age in words: "just now", "40 s ago", "3 min ago".
fn ago(seconds: u64) -> String {
    match seconds {
        0..5 => "just now".to_owned(),
        5..120 => format!("{seconds} s ago"),
        _ => format!("{} min ago", seconds / 60),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_says_why_no_page_counts() {
        let seen = Seen::default();
        assert_eq!(
            explain(&seen.json("default", None)),
            [
                "Nothing has loaded its page in the last 10 minutes: what should show it hasn't opened this URL (another viewer, at another port, may be answering it), or its browser refused to (Chrome refuses loopback in a frame of a page that isn't a secure context)."
            ]
        );
        seen.loaded("default");
        let lines = explain(&seen.json("default", None));
        assert!(
            lines[0].starts_with("A page was loaded just now but never loaded its script"),
            "{lines:?}"
        );
        assert!(
            explain(&seen.json("side", None))[0].starts_with("Nothing has loaded"),
            "another viewer's page"
        );
        seen.script();
        assert!(explain(&seen.json("default", None))[0].contains("loaded its script, but never asked"));
        let asked = explain(&seen.json("default", Some(Instant::now() - Duration::from_secs(50))));
        assert!(
            asked[0].starts_with("A page of it stopped asking for the view 50 s ago"),
            "{asked:?}"
        );
        seen.foreign_host();
        seen.foreign_host();
        seen.without_token();
        let lines = explain(&seen.json("side", None));
        assert!(lines[0].starts_with("2 requests were refused for naming a host"), "{lines:?}");
        assert!(
            lines[1].starts_with("One request came without the viewer's token, the last just now"),
            "{lines:?}"
        );
    }
}
