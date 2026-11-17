//! `current_view` for the viewer: what it shows, in the shape VS Code's
//! projection tabs say it (`packages/integrations/vscode/src/current-view/types.ts`).

use serde_json::{Value, json};

use super::{definition, page, viewer_words};
use crate::renderer_builds::{BuildState, Phase};
use crate::tools::Outcome;
use crate::view::{NamedView, Shared, control_state};

/// Answers `current_view` for a viewer this process runs; with `why`, says why no page counts as open when none does.
pub(super) async fn current(shared: &Shared, view_of: &NamedView, why: bool) -> Outcome {
    let control = control_state(shared, view_of);
    let state = &control["state"];
    let others = others_line(&control);
    let Some(projection) = state["projection"].as_str() else {
        let mut text = format!(
            "{} is running ({}) but shows nothing yet. Show the person a projection with open_projection{}.\n",
            capitalized(&viewer_words(view_of)),
            control["url"].as_str().unwrap_or_default(),
            if view_of.is_default() {
                String::new()
            } else {
                format!(" and viewer {}", view_of.name)
            },
        );
        if let Some(others) = &others {
            text.push_str(others);
            text.push('\n');
        }
        return Outcome::new(
            text,
            json!({"shown": false, "viewer": control["viewer"], "url": control["url"], "viewers": control["viewers"]}),
        );
    };
    let definition = definition(shared, projection).await;
    let title = state["title"].as_str().unwrap_or(projection);
    let pages = control["pages"].as_u64().unwrap_or(0);
    let page = &control["page"];
    let view = &page["view"];
    let summary = &page["summary"];
    let mut lines = vec![heading(shared, view_of, &control, title, projection, pages)];
    if pages == 0 && why {
        lines.extend(crate::view::seen::explain(&control["seen"]));
    }
    if state["chosenBy"] == "person" {
        lines.push(
            "The person chose this projection themselves, from the page's title menu; it replaces the one you showed there.".to_owned(),
        );
    }
    if let Some(description) = definition["description"].as_str() {
        lines.push(format!("What it shows: {description}"));
    }
    lines.push(definition_line(shared, projection, &definition));
    let compared = state["compared"].as_str().unwrap_or_default();
    let (before, after) = (state["before"].as_str(), state["after"].as_str().unwrap_or("working-tree"));
    let runner = shared.service.runner();
    let root = shared.service.repository().to_path_buf();
    let commit = |reference: &str| {
        (reference != "working-tree")
            .then(|| runner.resolve(&root, reference).ok())
            .flatten()
    };
    revisions(&mut lines, state, compared, (before, after), &commit);
    let current_page = !page.is_null() && summary["projection"]["id"] == projection;
    if current_page {
        page::describe(&mut lines, view, summary);
    } else {
        lines.push(
            "No page shows it yet, so its mode, selection and counts aren't known: open the URL for the person, or screenshot renders it."
                .to_owned(),
        );
    }
    let build = shared.service.renderer_builds().and_then(|builds| builds.state(projection));
    if let Some(build) = &build {
        lines.push(build_line(build));
    }
    lines.push(if view_of.is_default() {
        "compare, check, screenshot and set_part default to this projection, and compare without before and after compares exactly these revisions."
            .to_owned()
    } else {
        format!("screenshot with viewer {} renders this view; compare, check and set_part default to the default viewer's projection.", view_of.name)
    });
    if let Some(others) = others {
        lines.push(others);
    }
    Outcome::new(
        format!("{}\n", lines.join("\n")),
        json!({
            "shown": true,
            "surface": "viewer",
            "viewer": control["viewer"],
            "url": control["url"],
            "chosenBy": state["chosenBy"],
            "viewers": control["viewers"],
            "pages": pages,
            "seen": control["seen"],
            "projection": projection,
            "title": title,
            "choice": state["choice"],
            "compared": compared,
            "before": before.map(|before| json!({"ref": before, "commit": commit(before)})),
            "after": json!({"ref": after, "commit": commit(after)}),
            "scenario": state["scenario"],
            "mode": if current_page { view["mode"].clone() } else { state["mode"].clone() },
            "selection": if current_page { view["selection"].clone() } else { Value::Null },
            "page": if current_page { view.clone() } else { Value::Null },
            "failures": if current_page { summary["failures"].clone() } else { Value::Null },
            "rendererBuild": build.map(|build| json!({"phase": build.phase.name(), "error": build.error, "script": build.script, "package": build.package})),
        }),
    )
}

/// The other viewers the server has, and what each shows; none when it has only this one.
fn others_line(control: &Value) -> Option<String> {
    let others: Vec<String> = control["viewers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|other| other["name"] != control["viewer"])
        .filter(|other| other["name"] != crate::view::DEFAULT_VIEWER || !other["projection"].is_null())
        .map(|other| {
            let name = other["name"].as_str().unwrap_or_default();
            let shows = match other["projection"].as_str() {
                Some(projection) => format!("{projection} ({})", other["compared"].as_str().unwrap_or_default()),
                None => "nothing".to_owned(),
            };
            let pages = match other["pages"].as_u64().unwrap_or(0) {
                0 => "no page open".to_owned(),
                1 => "one page open".to_owned(),
                count => format!("{count} pages open"),
            };
            format!("{name} shows {shows} at {}, {pages}", other["url"].as_str().unwrap_or_default())
        })
        .collect();
    (!others.is_empty()).then(|| format!("Other viewers (current_view with viewer reads one): {}.", others.join("; ")))
}

fn capitalized(words: &str) -> String {
    let mut characters = words.chars();
    characters
        .next()
        .map(|first| first.to_uppercase().chain(characters).collect())
        .unwrap_or_default()
}

/// Where the viewer shows what, and how many pages are open.
fn heading(shared: &Shared, view_of: &NamedView, control: &Value, title: &str, projection: &str, pages: u64) -> String {
    let folder = shared
        .service
        .repository()
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    format!(
        "{} shows \"{title}\" (projection {projection}) in {folder}, at {}; {}.",
        capitalized(&viewer_words(view_of)),
        control["url"].as_str().unwrap_or_default(),
        match pages {
            0 => "no page is open".to_owned(),
            1 => "one page is open".to_owned(),
            count => format!("{count} pages are open, mirroring one another"),
        }
    )
}

/// The file that defines the projection and its parts.
fn definition_line(shared: &Shared, projection: &str, definition: &Value) -> String {
    let parts: Vec<String> = [("extractor", &definition["extractor"]), ("renderer", &definition["renderer"])]
        .iter()
        .filter(|(_, value)| !value.is_null())
        .map(|(name, value)| format!("{name} {}", crate::tools::part_text(name, value)))
        .chain(std::iter::once(match &definition["comparator"] {
            Value::Null => "the default comparator".to_owned(),
            value => format!("comparator {}", crate::tools::part_text("comparator", value)),
        }))
        .collect();
    let file = definition_file(shared.service.repository(), projection);
    format!(
        "Definition: {}; {}.",
        file.as_deref().unwrap_or("a built-in default"),
        parts.join(", ")
    )
}

/// The repository-relative file that defines `projection`, as VS Code finds it.
fn definition_file(root: &std::path::Path, projection: &str) -> Option<String> {
    crate::project::directories().into_iter().find_map(|directory| {
        let mut files: Vec<_> = std::fs::read_dir(root.join(&directory))
            .ok()?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "json"))
            .collect();
        files.sort();
        files.into_iter().find_map(|path| {
            let value: Value = serde_json::from_slice(&std::fs::read(&path).ok()?).ok()?;
            (value["id"] == projection).then(|| format!("{directory}/{}", path.file_name().unwrap_or_default().to_string_lossy()))
        })
    })
}

/// What is shown: a renderer scenario, a pair of revisions, or one revision.
fn revisions(
    lines: &mut Vec<String>,
    state: &Value,
    compared: &str,
    (before, after): (Option<&str>, &str),
    commit: &dyn Fn(&str) -> Option<String>,
) {
    let side = |reference: &str| match commit(reference) {
        Some(commit) if commit.starts_with(reference) || reference.len() >= 40 => commit[..8].to_owned(),
        Some(commit) => format!("{reference} ({})", &commit[..8]),
        None => reference.to_owned(),
    };
    if let Some(scenario) = state["scenario"].as_str() {
        lines.push(format!("Showing: the renderer scenario {scenario}, not revisions."));
    } else if let Some(before) = before {
        lines.push(format!("Showing: {compared}. Before {} → After {}.", side(before), side(after)));
        lines.push(format!(
            "Revisions: before {}, after {}.",
            commit(before).unwrap_or_else(|| before.to_owned()),
            commit(after).unwrap_or_else(|| after.to_owned())
        ));
    } else {
        lines.push(format!("Showing: {compared}. One revision, {}: nothing is compared.", side(after)));
    }
}

/// The shown projection's custom renderer build.
fn build_line(build: &BuildState) -> String {
    let how = format!(
        "npm run {}{}",
        build.script.as_deref().unwrap_or("build"),
        build.package.as_deref().map(|package| format!(" in {package}")).unwrap_or_default()
    );
    match build.phase {
        Phase::Building => format!("Renderer build: building ({how})."),
        Phase::Built => format!("Renderer build: built ({how}); the page reloads the renderer when its bundle changes."),
        Phase::Failed => format!(
            "Renderer build: failed ({how}): {}. The page says only that the renderer didn't build.",
            build.error.as_deref().unwrap_or("see its output")
        ),
        Phase::Untrusted => format!(
            "Renderer build: saving its sources would rebuild it ({how}), which runs repository code: the viewer runs without --trust. {}",
            page::RESTART_WITH_TRUST
        ),
    }
}
