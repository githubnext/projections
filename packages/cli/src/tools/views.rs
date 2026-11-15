//! The current view's defaults for the tools.

use super::*;

/// What the current view shows, for the tools' defaults: the viewer's state
/// and, when a page is open, what it reports.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ViewDefaults {
    pub projection: String,
    pub title: String,
    /// What it compares, in words: "Branch changes", or the revisions' subjects.
    pub compared: String,
    /// `(before, after)`; none while it shows a scenario.
    pub pair: Option<(Option<String>, String)>,
    /// The definition's `extractor`, `comparator` and `renderer`.
    pub parts: Value,
    pub mode: Option<String>,
    pub progress: Option<f64>,
    pub theme: Option<String>,
    pub width: Option<u64>,
    pub height: Option<u64>,
    /// The revision whose definition extracts every side; the working tree's when none.
    pub definition_revision: Option<String>,
}

/// The tools whose omitted projection (and revisions) default to the current view.
pub const VIEW_DEFAULTED: [&str; 5] = ["compare", "check", "set_part", "describe_part", "screenshot"];

pub(super) fn short_revision(reference: &str) -> &str {
    if reference.len() == 40 && reference.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        &reference[..8]
    } else {
        reference
    }
}

/// A tool's input with what it omitted taken from what the viewer shows, and
/// a note saying where its projection and revisions came from, as VS Code's
/// `withTabDefaults` does for its projection tab: compare without revisions
/// compares the viewer's pair and says so; given revisions are said to be the
/// viewer's or not. Fails when a projection is needed and neither given nor shown.
pub fn with_view_defaults(tool: &str, mut input: Value, shown: Option<&ViewDefaults>) -> Result<(Value, Option<String>), String> {
    let mut notes: Vec<String> = Vec::new();
    default_projection(tool, &mut input, shown, &mut notes)?;
    // Its revisions apply to any projection; its view and theme to the one it shows.
    let same = shown.filter(|view| input["projection"].as_str() == Some(view.projection.as_str()));
    if tool == "compare" || tool == "screenshot" {
        default_revisions(tool, &mut input, shown, &mut notes);
    }
    if tool == "screenshot"
        && input.get("definitionRevision").is_none()
        && let Some(definition) = shown.and_then(|view| view.definition_revision.as_deref())
    {
        input["definitionRevision"] = json!(definition);
    }
    if tool == "screenshot"
        && let Some(view) = same
    {
        default_screenshot(&mut input, view);
    }

    if tool == "describe_part"
        && let Some(view) = shown
        && !input["id"].is_string()
        && let Some(part) = input["part"].as_str()
    {
        notes.push(shown_part(view, part));
    }
    Ok((input, (!notes.is_empty()).then(|| notes.join(" "))))
}

/// The projection the viewer shows, for a tool that names none.
fn default_projection(tool: &str, input: &mut Value, shown: Option<&ViewDefaults>, notes: &mut Vec<String>) -> Result<(), String> {
    match shown {
        Some(view) if tool == "check" => {
            if !input["projections"].is_array() {
                input["projections"] = json!([view.projection]);
                notes.push(format!(
                    "Checked the projection the viewer shows ({}); name projections to check others.",
                    view.projection
                ));
            }
        }
        Some(view) if tool != "describe_part" => {
            if !input["projection"].is_string() {
                input["projection"] = json!(view.projection);
                notes.push(format!("Projection: {}, the one the viewer shows.", view.projection));
            }
        }
        None if matches!(tool, "compare" | "set_part" | "screenshot") && !input["projection"].is_string() => {
            return Err("Name a projection: the viewer shows nothing to take it from (list_projections lists them)".to_owned());
        }
        _ => {}
    }
    Ok(())
}

/// The revisions the viewer shows for `compare` and `screenshot` when none
/// are given, and a note saying whether the revisions are the viewer's.
fn default_revisions(tool: &str, input: &mut Value, shown: Option<&ViewDefaults>, notes: &mut Vec<String>) {
    let pair = shown.and_then(|view| view.pair.clone());
    let shown_text = pair.as_ref().and_then(|(before, after)| {
        before
            .as_deref()
            .map(|before| format!("{} → {}", short_revision(before), short_revision(after)))
    });
    let choice = shown.map(|view| view.compared.clone()).unwrap_or_default();
    let given = input["before"].is_string() || input["after"].is_string();
    match (&pair, given) {
        (Some((Some(before), after)), false) => {
            input["before"] = json!(before);
            input["after"] = json!(after);
            notes.push(format!(
                "Revisions: {}, the ones the viewer shows ({choice}). This is the comparison on the person's screen.",
                shown_text.unwrap_or_default()
            ));
        }
        (Some((None, after)), false) if tool == "screenshot" => {
            input["after"] = json!(after);
            notes.push(format!(
                "Revision: {}, the one the viewer shows ({choice}).",
                short_revision(after)
            ));
        }
        (Some((None, after)), false) => notes.push(format!(
            "The viewer shows one revision ({choice}: {}) and compares nothing, so these are the revisions Projections suggests: not what is on the person's screen.",
            short_revision(after)
        )),
        (None, false) => notes.push(format!(
            "Revisions: the ones Projections suggests ({}).",
            if shown.is_some() {
                "the viewer shows a scenario"
            } else {
                "nothing is shown in the viewer"
            }
        )),
        (pair, true) => {
            if let Some((Some(before), after)) = pair {
                let asked = (
                    input["before"].as_str(),
                    input["after"].as_str().unwrap_or("working-tree"),
                );
                let matches = (asked.0 == Some(before.as_str())
                    || asked.0 == Some(short_revision(before)))
                    && (asked.1 == after || asked.1 == short_revision(after));
                notes.push(if matches {
                    format!(
                        "Revisions: {}, the ones the viewer shows.",
                        shown_text.unwrap_or_default()
                    )
                } else {
                    format!(
                        "Revisions: as asked. Not the comparison the viewer shows ({choice}: {}): don't present it as the one on screen.",
                        shown_text.unwrap_or_default()
                    )
                });
            }
        }
    }
}

/// The viewer's mode, progress, theme and size, for a screenshot of the
/// projection it shows.
fn default_screenshot(input: &mut Value, view: &ViewDefaults) {
    let mut fill = |key: &str, value: Value| {
        if input.get(key).is_none() && !value.is_null() {
            input[key] = value;
        }
    };
    fill("mode", json!(view.mode.as_deref().filter(|mode| *mode != "swipe")));
    fill("progress", json!(view.progress));
    fill("theme", json!(view.theme));
    fill("width", json!(view.width.map(|width| width.clamp(320, 2560))));
    fill("height", json!(view.height.map(|height| height.clamp(240, 1600))));
}

/// A note naming the part the shown projection uses, for `describe_part`
/// without an ID.
fn shown_part(view: &ViewDefaults, part: &str) -> String {
    let value = &view.parts[part];
    format!(
        "The projection the viewer shows ({}) uses {}; pass its ID to describe it.",
        view.projection,
        if value.is_null() {
            format!("the default {part}")
        } else {
            format!("the {part} {}", part_text(part, value))
        }
    )
}

/// The projection a tool was given; tools that default it to the current view
/// have it by now, unless nothing is shown.
pub(super) fn projection_of(input: &Value) -> Result<&str, Failure> {
    input["projection"]
        .as_str()
        .ok_or_else(|| Failure::from("Name a projection: nothing is shown to take it from (list_projections lists them)"))
}
