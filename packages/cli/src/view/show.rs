//! `open_projection`: resolves its input against the repository and shows it.

use serde_json::Value;

use super::{
    NamedView, Shared, get,
    state::{self, Chooser, Shown, ViewState},
};
use crate::service::Service;

/// What a shown pair is: its suggestion, before and after, how it's compared, and named revisions' names.
type Pair = (Option<String>, Option<String>, String, String, Option<state::Sides>);

/// Resolves `open_projection`'s input against the repository and shows it in `view`, as `chooser` chose it.
pub(super) async fn show(shared: &Shared, view: &NamedView, input: &Value, chooser: Chooser) -> Result<ViewState, String> {
    shared.touch();
    let service = &shared.service;
    let current = view.state.borrow().clone();
    let definitions = get(service, "/api/definitions?ref=working-tree").await?;
    let listed: Vec<&Value> = definitions["definitions"].as_array().into_iter().flatten().collect();
    let projection = projection(input, &current, &listed)?;
    let definition = listed
        .iter()
        .find(|item| item["id"] == projection.as_str())
        .ok_or_else(|| format!("The working tree defines no projection {projection} (list_projections lists them)"))?;
    let title = definition["title"].as_str().unwrap_or(&projection).to_owned();
    let (choice, before, after, compared, sides) = pair(service, input, &current, &projection).await?;
    if let Some(scenario) = input["scenario"].as_str() {
        check_scenario(service, &projection, scenario).await?;
    }
    let shown = Shown {
        projection,
        title,
        choice,
        before,
        after,
        compared,
        sides,
        mode: input["mode"].as_str().map(str::to_owned),
        selection: input["entity"].as_str().map(str::to_owned),
        scenario: input["scenario"].as_str().map(str::to_owned),
        chosen_by: chooser,
    };
    let previous = current.projection.filter(|id| *id != shown.projection);
    let projection = shown.projection.clone();
    view.state.send_modify(|state| state.show(shown));
    shared.shown.send_modify(|version| *version += 1);
    // Its custom renderer builds while a viewer shows it.
    if let Some(builds) = shared.service.renderer_builds() {
        if let Some(previous) = previous.filter(|previous| !shared.views.shown_elsewhere(previous, &view.name)) {
            builds.stop(&previous);
        }
        let _ = builds.event(&projection, definition, "opened");
    }
    Ok(view.state.borrow().clone())
}

/// The person chose another projection in a page's title menu: the viewer shows it, comparing what it compared.
pub(super) async fn choose(shared: &Shared, view: &NamedView, projection: &str) -> Result<ViewState, String> {
    show(shared, view, &serde_json::json!({"projection": projection}), Chooser::Person).await
}

/// The projection the input names, else the one shown, else the repository's only one.
fn projection(input: &Value, current: &ViewState, listed: &[&Value]) -> Result<String, String> {
    match input["projection"].as_str().or(current.projection.as_deref()) {
        Some(id) => Ok(id.to_owned()),
        None => match listed {
            [only] => Ok(only["id"].as_str().unwrap_or_default().to_owned()),
            [] => Err("This repository defines no projections yet".to_owned()),
            _ => Err(format!(
                "Name a projection: this repository defines {}",
                listed.iter().filter_map(|item| item["id"].as_str()).collect::<Vec<_>>().join(", ")
            )),
        },
    }
}

/// The pair to show: the input's revisions, its choice, the one shown, or the suggested one.
async fn pair(service: &Service, input: &Value, current: &ViewState, projection: &str) -> Result<Pair, String> {
    let (before, after) = (input["before"].as_str(), input["after"].as_str());
    if before.is_some() || after.is_some() {
        let after = after.unwrap_or("working-tree").to_owned();
        let before = before.map(str::to_owned);
        let sides = revision_sides(service, before.clone(), after.clone()).await?;
        return Ok((None, before, after, state::revisions_words(&sides), Some(sides)));
    }
    let pairs = get(service, &format!("/api/pairs?projection={}", encode(projection))).await?;
    Ok(match input["choice"].as_str() {
        Some(choice) => {
            let (before, after, words) = state::choice_pair(choice, &pairs).map_err(|error| format!("{error:#}"))?;
            (Some(choice.to_owned()), before, after, words, None)
        }
        None if current.projection.is_some() && current.after.is_some() => (
            current.choice.clone(),
            current.before.clone(),
            current.after.clone().unwrap_or_default(),
            current.compared.clone(),
            current.sides.clone(),
        ),
        None => {
            let (choice, before, after, words) = state::suggested(&pairs);
            (choice, before, after, words, None)
        }
    })
}

/// Checks that the revisions resolve, and names them.
async fn revision_sides(service: &Service, before: Option<String>, after: String) -> Result<state::Sides, String> {
    let runner = service.runner();
    tokio::task::spawn_blocking(move || {
        let root = runner.repository_root().ok();
        let subject = |reference: &str| {
            let root = root.as_ref()?;
            let log = |format: &str, merges: bool| {
                let mut arguments = vec!["log", "-1", format];
                if !merges {
                    arguments.push("--no-merges");
                }
                arguments.extend(["--end-of-options", reference, "--"]);
                runner.git_text(root, &arguments).ok()
            };
            let commit = log("--format=%h%x09%p%x09%s", true)?;
            let change = log("--format=%s", false);
            Some(state::commit_name(&commit, change.as_deref()))
        };
        for reference in before.iter().chain(std::iter::once(&after)) {
            if reference != "working-tree"
                && let Some(root) = &root
            {
                runner.resolve(root, reference).map_err(|error| format!("{error:#}"))?;
            }
        }
        Ok::<_, String>(state::revision_sides(before.as_deref(), &after, subject))
    })
    .await
    .map_err(|error| error.to_string())?
}

async fn check_scenario(service: &Service, projection: &str, scenario: &str) -> Result<(), String> {
    let scenarios = get(service, &format!("/api/scenarios?projection={}", encode(projection))).await?;
    if scenarios["scenarios"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|item| item["id"] == scenario)
    {
        Ok(())
    } else {
        Err(format!("The projection {projection} has no scenario {scenario}"))
    }
}

/// A query component, percent-encoded.
fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                char::from(byte).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}
