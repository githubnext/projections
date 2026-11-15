//! The viewer as the surface that answers the view tools in `projections mcp`
//! (and the `projections view` subcommands): `open_projection` starts or
//! reuses it and shows a projection there, `current_view` says what it shows,
//! `refresh` extracts again, and the other tools' omitted projections and
//! revisions default to it ([`crate::tools::with_view_defaults`]). A viewer
//! another process runs for the repository is used through its control
//! endpoints, so one viewer serves every agent.

mod current;
mod page;

use std::{fmt::Write as _, sync::Arc, time::Duration};

use serde_json::{Value, json};

use super::{Shared, Viewer, ViewerOptions, client, control_state, registry, show, state::ViewState};
use crate::service::Service;
use crate::tools::{Outcome, ViewDefaults};
use current::current;

/// What `open_projection` says when no page shows the viewer yet (`projections mcp` says otherwise to an MCP Apps host,
/// whose conversation shows it).
pub const NO_PAGE: &str = "No page is open yet: open the URL for the person, in your own browser if you have one, else in the system browser (projections view show --open); give them the link only when you can open neither.";
const NOTHING_SHOWN: &str = "Nothing is shown: no viewer is running for this repository. Show the person a projection with open_projection: it starts the viewer and gives its URL. Ask which projection they mean if it isn't clear (list_projections lists them).";

/// Where the viewer runs.
enum Target {
    Local(Arc<Shared>),
    Remote(String),
}

/// The viewer for one repository's service, started on demand.
pub struct Views {
    service: Arc<Service>,
    attached: Option<Arc<Shared>>,
    local: tokio::sync::Mutex<Option<Viewer>>,
}

impl Views {
    pub fn new(service: Arc<Service>) -> Self {
        Self {
            service,
            attached: None,
            local: tokio::sync::Mutex::new(None),
        }
    }

    /// The viewer this server runs, answering its own control endpoints.
    pub(super) fn attached(shared: Arc<Shared>) -> Self {
        Self {
            service: shared.service.clone(),
            attached: Some(shared),
            local: tokio::sync::Mutex::new(None),
        }
    }

    async fn target(&self, start: bool) -> Result<Option<Target>, String> {
        if let Some(shared) = &self.attached {
            return Ok(Some(Target::Local(shared.clone())));
        }
        let mut local = self.local.lock().await;
        let root = self.service.repository().to_path_buf();
        // A viewer this process started that was asked to stop (`projections view stop`, or one started with
        // --trust replacing it) is gone: another may answer for the repository now.
        if let Some(viewer) = local.take_if(|viewer| viewer.closing()) {
            registry::remove(&root, viewer.url());
            viewer.close().await;
        }
        if let Some(viewer) = local.as_ref() {
            return Ok(Some(Target::Local(viewer.shared.clone())));
        }
        if let Some(record) = registry::live(&root, Duration::from_secs(3)).await
            && record.pid != std::process::id()
        {
            return Ok(Some(Target::Remote(record.url)));
        }
        if !start {
            return Ok(None);
        }
        let viewer = Viewer::start(
            self.service.clone(),
            ViewerOptions {
                port: 0,
                idle: None,
                definition_revision: None,
                token: None,
            },
        )
        .map_err(|error| format!("The viewer didn't start: {error:#}"))?;
        let record = registry::Record {
            url: viewer.url().to_owned(),
            pid: std::process::id(),
            trust: self.service.trusted(),
        };
        if let Err(error) = registry::write(&root, &record) {
            eprintln!("projections: the viewer isn't recorded for other processes: {error:#}");
        }
        let shared = viewer.shared.clone();
        *local = Some(viewer);
        Ok(Some(Target::Local(shared)))
    }

    /// Answers a view tool: `open_projection`, `current_view` or `refresh`.
    pub async fn answer(&self, name: &str, input: &Value) -> Outcome {
        let target = match self.target(name == "open_projection").await {
            Ok(Some(target)) => target,
            Ok(None) => return Outcome::new(NOTHING_SHOWN.to_owned(), json!({"shown": false})),
            Err(message) => return Outcome::failure(message),
        };
        match target {
            Target::Local(shared) => answer(&shared, name, input).await,
            Target::Remote(url) => {
                match client::request(&url, "POST", &format!("control/tool/{name}"), Some(input), Duration::from_secs(180)).await {
                    Ok(response) if response.status == 200 => match response.json() {
                        Ok(value) => Outcome::from_json(&value),
                        Err(error) => Outcome::failure(format!("{error:#}")),
                    },
                    Ok(response) => Outcome::failure(format!("The viewer refused ({})", response.status)),
                    Err(error) => Outcome::failure(format!("The viewer didn't answer: {error:#}")),
                }
            }
        }
    }

    /// What the viewer shows, for the other tools' defaults; none when nothing is shown.
    pub async fn defaults(&self) -> Option<ViewDefaults> {
        match self.target(false).await.ok()?? {
            Target::Local(shared) => defaults(&shared).await,
            Target::Remote(url) => {
                let response = client::request(&url, "GET", "control/defaults", None, Duration::from_secs(10))
                    .await
                    .ok()?;
                parse_defaults(&response.json().ok()?)
            }
        }
    }

    /// Relays one request of a page the host shows itself (the viewer as an MCP App, see `crate::mcp`) to the viewer,
    /// starting one when none runs: the viewer's answer, and its URL, whose token the page never sees.
    pub async fn relay(&self, method: &str, path: &str, body: Option<&Value>) -> Result<(client::Response, String), String> {
        let url = match self.target(true).await? {
            Some(Target::Local(shared)) => super::url(&shared),
            Some(Target::Remote(url)) => url,
            None => return Err("The viewer didn't start".to_owned()),
        };
        let response = client::request(&url, method, path.trim_start_matches('/'), body, Duration::from_secs(120))
            .await
            .map_err(|error| format!("The viewer didn't answer: {error:#}"))?;
        Ok((response, url))
    }

    /// Stops the viewer this process started.
    pub async fn close(&self) {
        if let Some(viewer) = self.local.lock().await.take() {
            registry::remove(self.service.repository(), viewer.url());
            viewer.close().await;
        }
    }
}

/// The defaults as `control/defaults` carries them.
pub(super) fn defaults_json(defaults: &ViewDefaults) -> Value {
    json!({
        "projection": defaults.projection, "title": defaults.title, "compared": defaults.compared,
        "pair": defaults.pair.as_ref().map(|(before, after)| json!({"before": before, "after": after})),
        "parts": defaults.parts, "mode": defaults.mode, "progress": defaults.progress, "theme": defaults.theme,
        "width": defaults.width, "height": defaults.height, "definitionRevision": defaults.definition_revision,
    })
}

fn parse_defaults(value: &Value) -> Option<ViewDefaults> {
    Some(ViewDefaults {
        projection: value["projection"].as_str()?.to_owned(),
        title: value["title"].as_str().unwrap_or_default().to_owned(),
        compared: value["compared"].as_str().unwrap_or_default().to_owned(),
        pair: value["pair"]["after"]
            .as_str()
            .map(|after| (value["pair"]["before"].as_str().map(str::to_owned), after.to_owned())),
        parts: value["parts"].clone(),
        mode: value["mode"].as_str().map(str::to_owned),
        progress: value["progress"].as_f64(),
        theme: value["theme"].as_str().map(str::to_owned),
        width: value["width"].as_u64(),
        height: value["height"].as_u64(),
        definition_revision: value["definitionRevision"].as_str().map(str::to_owned),
    })
}

/// The definition the viewer's projection has in the working tree.
async fn definition(shared: &Shared, projection: &str) -> Value {
    super::get(&shared.service, "/api/definitions?ref=working-tree")
        .await
        .ok()
        .and_then(|list| {
            list["definitions"]
                .as_array()?
                .iter()
                .find(|item| item["id"] == projection)
                .cloned()
        })
        .unwrap_or(Value::Null)
}

pub(super) async fn defaults(shared: &Shared) -> Option<ViewDefaults> {
    let control = control_state(shared);
    let state = &control["state"];
    let projection = state["projection"].as_str()?.to_owned();
    let definition = definition(shared, &projection).await;
    let page = &control["page"];
    let shown = page["summary"]["projection"]["id"] == projection.as_str();
    Some(ViewDefaults {
        title: state["title"].as_str().unwrap_or(&projection).to_owned(),
        compared: state["compared"].as_str().unwrap_or_default().to_owned(),
        pair: state["scenario"]
            .is_null()
            .then(|| state["after"].as_str())
            .flatten()
            .map(|after| (state["before"].as_str().map(str::to_owned), after.to_owned())),
        parts: json!({"extractor": definition["extractor"], "comparator": definition["comparator"], "renderer": definition["renderer"]}),
        mode: state["mode"].as_str().map(str::to_owned),
        progress: page["progress"].as_f64().filter(|_| shown),
        theme: page["colorMode"].as_str().filter(|_| shown).map(str::to_owned),
        width: page["width"].as_u64().filter(|_| shown),
        height: page["height"].as_u64().filter(|_| shown),
        definition_revision: state["definitionRevision"].as_str().map(str::to_owned),
        projection,
    })
}

/// Waits, while a page is open, until one shows the current generation, up to `limit`.
async fn settled(shared: &Shared, limit: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + limit;
    loop {
        let control = control_state(shared);
        if control["pages"] == 0 {
            return false;
        }
        let generation = &control["state"]["generation"];
        let done = control["views"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|view| &view["generation"] == generation);
        let status = control["page"]["summary"]["status"].as_str();
        if done && status != Some("extracting") || tokio::time::Instant::now() >= deadline {
            return done;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// Answers a view tool for the viewer this process runs.
pub(super) async fn answer(shared: &Arc<Shared>, name: &str, input: &Value) -> Outcome {
    shared.touch();
    match name {
        "open_projection" => match show(shared, input).await {
            Err(message) => Outcome::failure(message),
            Ok(state) => opened(shared, input, &state).await,
        },
        "refresh" => refresh(shared).await,
        _ => current(shared).await,
    }
}

/// `open_projection`, once shown: what the person's page shows.
async fn opened(shared: &Shared, input: &Value, state: &ViewState) -> Outcome {
    settled(shared, Duration::from_secs(30)).await;
    let mut outcome = current(shared).await;
    let url = super::url(shared);
    let pages = control_state(shared)["pages"].as_u64().unwrap_or(0);
    let mut lead = format!(
        "Showing {} in the viewer: {url}\n{}\n",
        state.title.as_deref().unwrap_or_default(),
        if pages == 0 { NO_PAGE } else { "The person's page shows it." }
    );
    if let Some(entity) = input["entity"].as_str() {
        let selected = outcome.structured["selection"]["id"] == entity;
        let _ = writeln!(
            lead,
            "{}",
            if pages == 0 {
                format!("{entity} is selected once a page shows it.")
            } else if selected {
                format!("{entity} is selected.")
            } else {
                format!("It doesn't show {entity}, so nothing is selected.")
            }
        );
    }
    outcome.text = format!("{lead}\n{}", outcome.text);
    outcome
}

/// `refresh`: extracts again, and says what the page shows then.
async fn refresh(shared: &Shared) -> Outcome {
    if control_state(shared)["state"]["projection"].is_null() {
        return Outcome::new(NOTHING_SHOWN.to_owned(), json!({"shown": false}));
    }
    shared.state.send_modify(ViewState::refresh);
    let pages = settled(shared, Duration::from_secs(120)).await;
    let mut outcome = current(shared).await;
    outcome.text = format!(
        "{}\n\n{}",
        if pages {
            "Extracted again."
        } else {
            "Asked the viewer to extract again: no page is open, so it does when one opens."
        },
        outcome.text
    );
    outcome
}
