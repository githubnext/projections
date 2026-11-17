//! Named viewers: one server shows several independent views, each with its
//! own state, pages and URL (`TOKEN/?viewer=NAME`), so an agent can show the
//! person several projections side by side. The default viewer, unnamed,
//! is the one a page without `?viewer=` and a call without `viewer` show.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde_json::Value;
use tokio::sync::watch;

use super::state::ViewState;

/// The default viewer's name: the unnamed one.
pub const DEFAULT_VIEWER: &str = "default";
/// The most viewers one server keeps.
const MAX_VIEWERS: usize = 32;
/// A page that hasn't asked for the state for this long is gone.
pub(super) const PAGE_GONE: Duration = Duration::from_secs(45);

/// One viewer: what its pages show, and what they report.
pub(super) struct NamedView {
    pub name: String,
    pub state: watch::Sender<ViewState>,
    /// Each open page's last request, and what it last reported: its generation, selection and mode.
    pub pages: Mutex<HashMap<String, (Instant, Value)>>,
    /// The latest report from any of its pages: what the person sees.
    pub shown: Mutex<Option<(Instant, Value)>>,
    /// The shown projection's custom renderer build phase, and a version bumped when it changes: the page's status
    /// line, sent with the state so a page holds one long poll, not one per subject.
    pub build: watch::Sender<(u64, Option<&'static str>)>,
}

impl NamedView {
    fn new(name: &str, definition_revision: Option<String>) -> Self {
        Self {
            name: name.to_owned(),
            state: watch::Sender::new(ViewState {
                definition_revision,
                ..ViewState::default()
            }),
            pages: Mutex::new(HashMap::new()),
            shown: Mutex::new(None),
            build: watch::Sender::new((0, None)),
        }
    }

    /// Its open pages: those that asked within [`PAGE_GONE`]. Those gone are kept a while, so `current_view` can say
    /// when one stopped asking.
    pub fn pages(&self) -> usize {
        let mut pages = self.pages.lock().unwrap_or_else(|e| e.into_inner());
        pages.retain(|_, (seen, _)| seen.elapsed() < super::seen::RECENT);
        pages.values().filter(|(seen, _)| seen.elapsed() < PAGE_GONE).count()
    }

    /// When a page of it last asked for its state or reported, open or gone.
    pub fn last_asked(&self) -> Option<Instant> {
        self.pages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .map(|(seen, _)| *seen)
            .max()
    }

    /// The projection it shows.
    pub fn projection(&self) -> Option<String> {
        self.state.borrow().projection.clone()
    }

    pub fn is_default(&self) -> bool {
        self.name == DEFAULT_VIEWER
    }
}

/// A server's viewers, by name; each is made when first asked for.
pub(super) struct NamedViews {
    views: Mutex<HashMap<String, Arc<NamedView>>>,
    definition_revision: Option<String>,
}

impl NamedViews {
    pub fn new(definition_revision: Option<String>) -> Self {
        let views = HashMap::from([(
            DEFAULT_VIEWER.to_owned(),
            Arc::new(NamedView::new(DEFAULT_VIEWER, definition_revision.clone())),
        )]);
        Self {
            views: Mutex::new(views),
            definition_revision,
        }
    }

    /// The viewer `name` names (the default one for none), made when it is new.
    pub fn get(&self, name: Option<&str>) -> Result<Arc<NamedView>, String> {
        let name = viewer_name(name)?;
        let mut views = self.views.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(view) = views.get(&name) {
            return Ok(view.clone());
        }
        if views.len() >= MAX_VIEWERS {
            return Err(format!("The viewer already shows {MAX_VIEWERS} named viewers: reuse one of them"));
        }
        let view = Arc::new(NamedView::new(&name, self.definition_revision.clone()));
        views.insert(name, view.clone());
        Ok(view)
    }

    pub fn default_view(&self) -> Arc<NamedView> {
        self.views.lock().unwrap_or_else(|e| e.into_inner())[DEFAULT_VIEWER].clone()
    }

    /// Every viewer, the default one first, then by name.
    pub fn all(&self) -> Vec<Arc<NamedView>> {
        let mut views: Vec<_> = self.views.lock().unwrap_or_else(|e| e.into_inner()).values().cloned().collect();
        views.sort_by(|a, b| (!a.is_default(), &a.name).cmp(&(!b.is_default(), &b.name)));
        views
    }

    /// Whether a viewer other than `except` shows `projection`.
    pub fn shown_elsewhere(&self, projection: &str, except: &str) -> bool {
        self.all()
            .iter()
            .any(|view| view.name != except && view.projection().as_deref() == Some(projection))
    }
}

/// A viewer's name: lowercase letters, digits and hyphens, starting with a letter or digit, at most 40; none, or
/// `default`, for the default viewer.
pub fn viewer_name(name: Option<&str>) -> Result<String, String> {
    let Some(name) = name.filter(|name| !name.is_empty()) else {
        return Ok(DEFAULT_VIEWER.to_owned());
    };
    let valid = name.len() <= 40
        && name
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    if valid {
        Ok(name.to_owned())
    } else {
        Err(format!(
            "A viewer's name is lowercase letters, digits and hyphens, at most 40 (not {name:?})"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn viewers_are_named_plainly_and_made_on_demand() {
        assert_eq!(viewer_name(None).unwrap(), DEFAULT_VIEWER);
        assert_eq!(viewer_name(Some("")).unwrap(), DEFAULT_VIEWER);
        assert_eq!(viewer_name(Some("api-2")).unwrap(), "api-2");
        for bad in ["API", "-a", "a b", "a/b", &"a".repeat(41)] {
            assert!(viewer_name(Some(bad)).is_err(), "{bad}");
        }
        let views = NamedViews::new(None);
        assert!(Arc::ptr_eq(&views.get(Some("default")).unwrap(), &views.default_view()));
        let api = views.get(Some("api")).unwrap();
        assert!(Arc::ptr_eq(&api, &views.get(Some("api")).unwrap()));
        assert_eq!(
            views.all().iter().map(|view| view.name.as_str()).collect::<Vec<_>>(),
            ["default", "api"]
        );
        api.state.send_modify(|state| state.projection = Some("map".to_owned()));
        assert!(views.shown_elsewhere("map", "default"));
        assert!(!views.shown_elsewhere("map", "api"));
        for index in 0..MAX_VIEWERS - 2 {
            views.get(Some(format!("v{index}").as_str())).unwrap();
        }
        assert!(views.get(Some("one-more")).is_err());
    }
}
