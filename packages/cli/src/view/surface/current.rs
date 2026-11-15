//! `current_view` for the viewer: what it shows, in the shape VS Code's
//! projection tabs say it (`packages/integrations/vscode/src/current-view/types.ts`).

use serde_json::{Value, json};

use super::{definition, page};
use crate::renderer_builds::{BuildState, Phase};
use crate::tools::Outcome;
use crate::view::{Shared, control_state};

/// Answers `current_view` for the viewer this process runs.
pub(super) async fn current(shared: &Shared) -> Outcome {
    let control = control_state(shared);
    let state = &control["state"];
    let Some(projection) = state["projection"].as_str() else {
        return Outcome::new(
            format!(
                "The viewer is running ({}) but shows nothing yet. Show the person a projection with open_projection.\n",
                control["url"].as_str().unwrap_or_default()
            ),
            json!({"shown": false, "url": control["url"]}),
        );
    };
    let definition = definition(shared, projection).await;
    let title = state["title"].as_str().unwrap_or(projection);
    let pages = control["pages"].as_u64().unwrap_or(0);
    let page = &control["page"];
    let view = &page["view"];
    let summary = &page["summary"];
    let mut lines = vec![heading(shared, &control, title, projection, pages)];
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
    lines.push(
        "compare, check, screenshot and set_part default to this projection, and compare without before and after compares exactly these revisions."
            .to_owned(),
    );
    Outcome::new(
        format!("{}\n", lines.join("\n")),
        json!({
            "shown": true,
            "surface": "viewer",
            "url": control["url"],
            "pages": pages,
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

/// Where the viewer shows what, and how many pages are open.
fn heading(shared: &Shared, control: &Value, title: &str, projection: &str, pages: u64) -> String {
    let folder = shared
        .service
        .repository()
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    format!(
        "The viewer shows \"{title}\" (projection {projection}) in {folder}, at {}; {}.",
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
