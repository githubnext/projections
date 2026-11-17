//! The tool catalog: every tool's description and input schema, and
//! validating a call's arguments against it.

use serde_json::{Value, json};

use super::{Tool, Trust};

pub(super) fn object(properties: Value, required: &[&str]) -> Value {
    json!({"type": "object", "properties": properties, "required": required, "additionalProperties": false})
}

fn projection_id(description: &str) -> Value {
    json!({"type": "string", "minLength": 1, "maxLength": 100, "description": description})
}

pub(super) fn revision(description: &str) -> Value {
    json!({"type": "string", "minLength": 1, "maxLength": 1024, "description": description})
}

fn projection_ids(description: &str) -> Value {
    json!({"type": "array", "items": projection_id("A projection ID"), "minItems": 1, "maxItems": 50, "description": description})
}

pub(super) fn confirm() -> Value {
    json!({"type": "string", "minLength": 1, "maxLength": 100,
        "description": "The confirm token the preview returned. Omit it to preview; with it, writes exactly what that preview showed, or previews again if anything changed since."})
}

/// A named viewer, for showing several projections side by side.
fn viewer() -> Value {
    json!({"type": "string", "minLength": 1, "maxLength": 40,
        "description": "With projections mcp, a named viewer: its own page and URL, independent of the others, so several projections can be shown side by side (lowercase letters, digits and hyphens); default the default viewer. VS Code ignores it"})
}

pub(super) fn part(description: &str) -> Value {
    json!({"type": ["string", "object", "null"], "description": description})
}

/// Every tool, in the order agents see them.
pub fn catalog() -> Vec<Tool> {
    let before = "The Before revision: a branch, tag or commit, or working-tree for the files on disk";
    let after = "The After revision: a branch, tag or commit, or working-tree for the files on disk (uncommitted changes included)";
    vec![
        Tool {
            name: "list_projections",
            title: "List projections",
            description: "List the projections this repository defines (in .github/projections or .projections): each one's ID, title, extractor, renderer and comparator, whether it runs repository code (and so needs trust), and definition files that are invalid, with their errors. Call it first to learn the projection IDs the other tools take. Runs nothing.",
            input_schema: object(
                json!({"ref": revision("The revision whose definitions to list: a branch, tag or commit; default working-tree (the files on disk)")}),
                &[],
            ),
            read_only: true,
            destructive: false,
            trust: Trust::None,
            view: false,
        },
        Tool {
            name: "compare",
            title: "Compare revisions",
            description: "Compare two revisions through one projection and summarize how the change reshapes that system: the steps in the order the change is told, each change (added, removed, modified, renamed, split or merged) with its label and summary, counts by status, and the comparator's classification, such as API compatibility levels (breaking, additive, compatible, unknown). Without before and after it compares the pair Projections suggests (a bookmark, the branch since the default branch, the last tag, the last commit, or uncommitted changes). Extracting runs the projection's extractor; one that is repository code needs trust. An omitted projection, before and after default to what the current view shows (current_view), and the result says which revisions it compared and where they came from: never present another comparison as the one on screen.",
            input_schema: object(
                json!({
                    "projection": projection_id("The projection ID (list_projections lists them); default the current view's (current_view)"),
                    "before": revision(&format!("{before}; with neither before nor after, the revisions the current view shows")),
                    "after": revision(&format!("{after}; default working-tree when before is given")),
                    "definition": {"type": "string", "enum": ["base", "head"], "description": "Which revision's definition explains the comparison: base (default for given revisions) or head"},
                    "definitionRevision": revision("Apply this revision's definition to both revisions instead, for example working-tree to try uncommitted projection code; default for the current view's revisions the definition the view applies, and for a suggested pair working-tree, as the viewer does"),
                    "maxChanges": {"type": "integer", "minimum": 1, "maximum": 500, "description": "The most changes to describe (default 100); the counts always cover every change"},
                }),
                &[],
            ),
            read_only: true,
            destructive: false,
            trust: Trust::Extract,
            view: false,
        },
        Tool {
            name: "explore",
            title: "Explore projections",
            description: "Find the built-in projections that apply to this repository, each with the files that suggested it (its reason), whether it is already adopted, and whether it runs repository code. Runs nothing. Follow with sweep to see what each shows on recent changes; adopt only what the person chooses.",
            input_schema: object(json!({}), &[]),
            read_only: true,
            destructive: false,
            trust: Trust::None,
            view: false,
        },
        Tool {
            name: "sweep",
            title: "Find recent changes",
            description: "Try projections on the repository's recent changes (the last merges into this branch, else its commits) and summarize, per projection, how many changes it showed something on (changed in N of M), the median size of those changes, and the changes it showed most on, plus the changes where several projections changed. Use it to tell signal from noise before adopting or tuning. Defaults to every explore candidate and defined projection over the last 20 changes. Projections that run repository code are skipped without trust. It can take a minute.",
            input_schema: object(
                json!({
                    "projections": projection_ids("The projections to sweep; default every explore candidate and defined projection"),
                    "last": {"type": "integer", "minimum": 1, "maximum": 100, "description": "How many recent changes to sweep (default 20)"},
                    "latest": {"type": "boolean", "description": "Summarize the latest sweep (one the person ran in the Explore view, or an earlier call) instead of running another"},
                }),
                &[],
            ),
            read_only: true,
            destructive: false,
            trust: Trust::Extract,
            view: false,
        },
        Tool {
            name: "check",
            title: "Check projections",
            description: "Verify projections end to end, as `projections check` does: the definition is valid, the working tree extracts, HEAD compares with the working tree, comparator tests pass, and with render, a custom renderer's bundle is current and passes the renderer checks in a headless browser. Reports each check as pass, fail, warn or skip, with why. Run it after every change to a projection, before saying it works. Omitted projections default to the one the current view shows (current_view).",
            input_schema: object(
                json!({
                    "projections": projection_ids("The projections to check; default the current view's (current_view), else every one the working tree defines"),
                    "render": {"type": "boolean", "description": "Also run the renderer checks in a headless browser (slower; default false)"},
                }),
                &[],
            ),
            read_only: true,
            destructive: false,
            trust: Trust::Extract,
            view: false,
        },
        Tool {
            name: "prepare",
            title: "Prepare the environment",
            description: "Run the prepare steps the repository's environment file (.github/projections/environment.json) declares, such as npm ci, as `projections prepare` does: in the working tree by default, or in the workspace Projections keeps for a revision. Each step runs only when its key files (lockfiles) changed since it last ran there, unless force. Steps are repository code and may use the network. Use it when a toolchain extractor needs installed dependencies, after adding or changing the environment file.",
            input_schema: object(
                json!({
                    "revision": revision("Prepare the workspace for this commit instead of the working tree"),
                    "steps": {"type": "array", "items": {"type": "string", "minLength": 1, "maxLength": 100}, "maxItems": 20, "description": "Only these step IDs; default every step"},
                    "force": {"type": "boolean", "description": "Run the steps even when their key files are unchanged"},
                }),
                &[],
            ),
            read_only: false,
            destructive: false,
            trust: Trust::Extract,
            view: false,
        },
        Tool {
            name: "run_comparator_tests",
            title: "Run comparator tests",
            description: "Run custom comparator tests (the X.comparator.test.yaml beside a comparator file X.comparator.yaml), sandboxed, and report each case as pass, fail or skip, with each failure's expectation, message and diff. Defaults to every test file; path selects one, cases some of its cases, projection one projection's run. coverage also reports rule coverage: which of the comparator file's functions, expressions and branches the cases run, and the line of each that none does. Never writes: update_snapshots rewrites snapshots.",
            input_schema: object(
                json!({
                    "path": {"type": "string", "minLength": 1, "maxLength": 1024, "description": "One test file, repository-relative (for example .github/projections/map/map.comparator.test.yaml)"},
                    "cases": {"type": "array", "items": {"type": "string", "minLength": 1}, "maxItems": 200, "description": "Only these cases of that file, by name (needs path)"},
                    "projection": projection_id("Only the run for this projection's options and revisions"),
                    "coverage": {"type": "boolean", "description": "Also report rule coverage, with what the cases leave uncovered by line"},
                }),
                &[],
            ),
            read_only: true,
            destructive: false,
            trust: Trust::None,
            view: false,
        },
        Tool {
            name: "describe_part",
            title: "Describe a built-in part",
            description: "Describe a built-in part a projection definition can use: an extractor (what it reads, its schema, its inputs, its default renderer, whether it runs repository code, and a definition template), a renderer (the schemas it accepts, the names it answers to and its comparison modes) or the comparator (the default one's options, and rules). Without id, lists the built-ins of that part.",
            input_schema: object(
                json!({
                    "part": {"type": "string", "enum": ["extractor", "renderer", "comparator"], "description": "Which part"},
                    "id": {"type": "string", "minLength": 1, "maxLength": 100, "description": "The built-in's ID or name (for a comparator: default or custom); omit to list them"},
                }),
                &["part"],
            ),
            read_only: true,
            destructive: false,
            trust: Trust::None,
            view: false,
        },
        Tool {
            name: "open_projection",
            title: "Open a projection",
            description: "Show a projection to the person: in VS Code, in a projection tab; with projections mcp, in the viewer, a page on this machine that you drive and the person watches. The viewer's URL is in the result: open it for them, in your own browser if you have one, else in the system browser (projections view show --open); give them the link only when you can't. Use it when they ask to see or open a projection (\"in the inspector\" too), and to show them what you set up or changed. Shows a pair of revisions (by default the folder's current pair in VS Code, or the pair the viewer shows, else the one Projections suggests), or a choice such as branch, uncommitted or last-commit, or a renderer scenario; optionally in a comparison mode and selecting an entity (an entity ID from compare). In VS Code, without pin it sets the folder's pair, so every projection tab follows; with pin only this tab shows the pair. An omitted projection defaults to the one the current view shows (current_view).",
            input_schema: object(
                json!({
                    "projection": projection_id("The projection ID; default the current view's (current_view)"),
                    "before": revision(before),
                    "after": revision(after),
                    "choice": {"type": "string", "minLength": 1, "maxLength": 200, "description": "What to compare instead of before and after: branch (this branch's changes), uncommitted, last-commit, now (the working tree alone), release (since the last tag) or bookmark:<id>"},
                    "mode": {"type": "string", "enum": ["side-by-side", "animated", "swipe", "diff"], "description": "The comparison mode, when the renderer offers it"},
                    "scenario": {"type": "string", "minLength": 1, "maxLength": 200, "description": "A scenario from the projection's renderer scenarios (scenarios.json) to show instead of revisions"},
                    "entity": {"type": "string", "minLength": 1, "maxLength": 1024, "description": "An entity ID to select (compare lists each change's entities)"},
                    "pin": {"type": "boolean", "description": "In VS Code, pin the pair to this tab instead of setting the folder's pair (default false); the viewer ignores pin"},
                    "viewer": viewer(),
                }),
                &[],
            ),
            read_only: true,
            destructive: false,
            trust: Trust::None,
            view: true,
        },
        Tool {
            name: "current_view",
            title: "Current projection view",
            description: "What the person is looking at: in VS Code, their projection tab (the one in front, else the one shown last); with projections mcp, the viewer. Says the projection's ID, title and definition file, the choice it shows (Current state, Branch changes, a pull request, a bookmark…) with its resolved Before → After revisions, the comparison mode, the selected item, the summary bar's counts, the changed items with their status (added, removed, modified…), why an extraction failed, and whether the result is out of date or uses the person's uncommitted definition edits. Call it first whenever the person says \"this projection\", \"this view\", \"this tab\", \"what am I looking at\", \"what changed\", \"this one's wrong\" or \"what was removed\", or otherwise asks about what's on screen, rather than asking them which projection they mean. Says so when nothing is shown. With projections mcp, viewer reads a named viewer.",
            input_schema: object(json!({"viewer": viewer()}), &[]),
            read_only: true,
            destructive: false,
            trust: Trust::None,
            view: true,
        },
        Tool {
            name: "refresh",
            title: "Refresh the view",
            description: "Extract what the current view shows again and compare it, as the person's Refresh does: after changing a projection's code, its inputs or its renderer, when the view says it is out of date. Returns what it shows then, as current_view does.",
            input_schema: object(json!({"viewer": viewer()}), &[]),
            read_only: true,
            destructive: false,
            trust: Trust::Extract,
            view: true,
        },
        Tool {
            name: "screenshot",
            title: "Screenshot a projection",
            description: "Render a projection as a PNG image with its real renderer in a headless browser, as projections compare --png does, and return the image: to see what the person sees, or to check a renderer's output. Without arguments it renders what the current view shows (its projection, revisions, comparison mode, playback position, theme and size), whether or not you can see the person's screen. Extracting runs the projection's extractor; one that is repository code needs trust. Needs Chrome, Chromium or Edge.",
            input_schema: object(
                json!({
                    "projection": projection_id("The projection ID; default the current view's (current_view)"),
                    "before": revision(&format!("{before}; with neither before nor after, the revisions the current view shows")),
                    "after": revision(after),
                    "mode": {"type": "string", "enum": ["side-by-side", "animated", "diff"], "description": "How to present a comparison; default the current view's, else the renderer's"},
                    "progress": {"type": "number", "minimum": 0, "maximum": 1, "description": "Animated mode: the transition's progress, 0 (before) to 1 (after); default the current view's playback position"},
                    "theme": {"type": "string", "enum": ["light", "dark"], "description": "Default the current view's, else light"},
                    "width": {"type": "integer", "minimum": 320, "maximum": 2560, "description": "Viewport width in CSS pixels; default the current view's, else 1280"},
                    "height": {"type": "integer", "minimum": 240, "maximum": 1600, "description": "Viewport height in CSS pixels, the most the image is: it is as tall as its card, which hugs the content; default the current view's, else 800"},
                    "definitionRevision": revision("The revision whose definition extracts every side; default the current view's, else working-tree"),
                    "focus": {"type": "string", "enum": ["changes", "all"], "description": "Open the image on a comparison's changes or on everything; default the renderer's choice (a diff opens on its changes when they don't all fit)"},
                    "entity": {"type": "string", "description": "Open the image on one item, by its ID, centred with what it connects to"},
                    "fit": {"type": "boolean", "description": "Fit what the image opens on whole, even when its text is drawn smaller than the renderer would open at"},
                    "viewer": viewer(),
                }),
                &[],
            ),
            read_only: true,
            destructive: false,
            trust: Trust::Extract,
            view: false,
        },
        Tool {
            name: "adopt",
            title: "Adopt projections",
            description: "Adopt explore candidates the person chose: write each one's definition to .github/projections/<id>.json (never over a file) and bookmark the recent changes it showed most on when recent changes were last checked. Never adopt on your own. The first call previews the files; nothing is written until the write is confirmed. Writing needs trust once the repository defines projections of its own.",
            input_schema: object(
                json!({
                    "projections": projection_ids("The candidates to adopt (explore lists them)"),
                    "bookmarks": {"type": "integer", "minimum": 0, "maximum": 20, "description": "Bookmark each projection's N most-changed changes from the latest check of recent changes (default 3; 0 for none)"},
                    "confirm": confirm(),
                }),
                &["projections"],
            ),
            read_only: false,
            destructive: false,
            trust: Trust::Onboarding,
            view: false,
        },
        Tool {
            name: "set_part",
            title: "Set a definition's part",
            description: "Change parts of a projection's definition file, keeping its other fields and their order: the extractor (a built-in ID, or {command, sources?}), the comparator ({options: {order: {by, direction?}}} for the default one, or a comparator file: \"<path>.comparator.yaml\" or {file, sources?, options?}) or the renderer (a built-in name, or {bundle, sources?}); null removes an optional part. The first call validates the new definition and previews the diff; writing needs trust. An omitted projection defaults to the one the current view shows (current_view).",
            input_schema: object(
                json!({
                    "projection": projection_id("The projection ID; default the current view's (current_view)"),
                    "extractor": part("The new extractor: a built-in extractor ID, or {command: [argv], sources?: [paths]}"),
                    "comparator": part("The new comparator: {options} for the default one, a comparator file's path or {file: path, sources?, options?} for a custom one, or null for the default one without options"),
                    "renderer": part("The new renderer: a built-in renderer name, or {bundle: directory, sources?}"),
                    "confirm": confirm(),
                }),
                &[],
            ),
            read_only: false,
            destructive: true,
            trust: Trust::Write,
            view: false,
        },
        Tool {
            name: "update_snapshots",
            title: "Update comparator test snapshots",
            description: "Rewrite comparator tests' snapshots (never their expectations) to what the comparator produces now. The first call previews which snapshots differ and how; confirm only once the new output is right, since it becomes what the tests expect. Writing needs trust.",
            input_schema: object(
                json!({
                    "path": {"type": "string", "minLength": 1, "maxLength": 1024, "description": "One test file, repository-relative; default every test file"},
                    "cases": {"type": "array", "items": {"type": "string", "minLength": 1}, "maxItems": 200, "description": "Only these cases of that file, by name (needs path)"},
                    "projection": projection_id("Only the run for this projection"),
                    "confirm": confirm(),
                }),
                &[],
            ),
            read_only: false,
            destructive: true,
            trust: Trust::Write,
            view: false,
        },
    ]
}

/// Checks `value` against the subset of JSON Schema the catalog uses: `type`
/// (a name or a list), `enum`, `properties`, `required`,
/// `additionalProperties: false`, `items`, `minItems`, `maxItems`,
/// `minLength`, `maxLength`, `minimum` and `maximum`.
pub fn validate(schema: &Value, value: &Value, at: &str) -> Result<(), String> {
    let name = if at.is_empty() { "the arguments" } else { at };
    if let Some(kinds) = schema.get("type") {
        let kinds: Vec<&str> = match kinds {
            Value::String(kind) => vec![kind.as_str()],
            Value::Array(kinds) => kinds.iter().filter_map(Value::as_str).collect(),
            _ => Vec::new(),
        };
        let matches = kinds.iter().any(|kind| match *kind {
            "object" => value.is_object(),
            "array" => value.is_array(),
            "string" => value.is_string(),
            "boolean" => value.is_boolean(),
            "integer" => value.is_i64() || value.is_u64(),
            "number" => value.is_number(),
            "null" => value.is_null(),
            _ => false,
        });
        if !matches {
            return Err(format!("{name} must be {}", kinds.join(" or ")));
        }
    }
    if let Some(options) = schema.get("enum").and_then(Value::as_array)
        && !options.contains(value)
    {
        let names: Vec<String> = options.iter().map(Value::to_string).collect();
        return Err(format!("{name} must be one of {}", names.join(", ")));
    }
    let bound = |key: &str| schema.get(key).and_then(Value::as_f64);
    match value {
        Value::String(text) => {
            let length = text.chars().count() as f64;
            if bound("minLength").is_some_and(|minimum| length < minimum) {
                return Err(format!("{name} must not be empty"));
            }
            if let Some(maximum) = bound("maxLength").filter(|maximum| length > *maximum) {
                return Err(format!("{name} must be at most {maximum} characters"));
            }
        }
        Value::Number(number) => {
            let number = number.as_f64().unwrap_or_default();
            if let Some(minimum) = bound("minimum").filter(|minimum| number < *minimum) {
                return Err(format!("{name} must be at least {minimum}"));
            }
            if let Some(maximum) = bound("maximum").filter(|maximum| number > *maximum) {
                return Err(format!("{name} must be at most {maximum}"));
            }
        }
        Value::Array(items) => {
            let count = items.len() as f64;
            if let Some(minimum) = bound("minItems").filter(|minimum| count < *minimum) {
                return Err(format!("{name} must have at least {minimum} items"));
            }
            if let Some(maximum) = bound("maxItems").filter(|maximum| count > *maximum) {
                return Err(format!("{name} must have at most {maximum} items"));
            }
            if let Some(item) = schema.get("items") {
                for (index, value) in items.iter().enumerate() {
                    validate(item, value, &format!("{name}[{index}]"))?;
                }
            }
        }
        Value::Object(fields) => {
            let properties = schema.get("properties").and_then(Value::as_object);
            for required in schema
                .get("required")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                if !fields.contains_key(required) {
                    return Err(format!("{name} need {required}"));
                }
            }
            for (key, field) in fields {
                let path = if at.is_empty() { key.clone() } else { format!("{at}.{key}") };
                match properties.and_then(|properties| properties.get(key)) {
                    Some(property) => validate(property, field, &path)?,
                    None if schema.get("additionalProperties") == Some(&Value::Bool(false)) => {
                        let known: Vec<&str> = properties
                            .map(|properties| properties.keys().map(String::as_str).collect())
                            .unwrap_or_default();
                        return Err(format!(
                            "{name} have no {key}; {}",
                            if known.is_empty() {
                                "this tool takes none".to_owned()
                            } else {
                                format!("they are {}", known.join(", "))
                            }
                        ));
                    }
                    None => {}
                }
            }
        }
        _ => {}
    }
    Ok(())
}
