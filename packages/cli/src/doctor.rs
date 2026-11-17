//! `projections doctor`: what this checkout needs to run its projections,
//! without running any of them. It reads definitions and looks up programs
//! (asking a Python launcher only for its version), and never executes
//! repository code, installs anything or changes files.

use crate::{browser, collectors, dev_server, runtime::Runner, scaffold, workspace};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

fn item(status: &str, title: &str, message: impl Into<String>) -> Value {
    json!({"status": status, "title": title, "message": message.into()})
}

/// `program` resolved like a shell would, without running it: a path in the
/// checkout, or the first match on `PATH`.
fn find_program(root: &Path, program: &str) -> Option<PathBuf> {
    if program.contains('/') || program.contains('\\') {
        let path = root.join(program);
        return path.is_file().then_some(path);
    }
    let path = std::env::var_os("PATH")?;
    let extensions: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT".into())
            .split(';')
            .map(str::to_owned)
            .chain([String::new()])
            .collect()
    } else {
        vec![String::new()]
    };
    std::env::split_paths(&path).find_map(|directory| {
        extensions.iter().find_map(|extension| {
            let candidate = directory.join(format!("{program}{extension}"));
            candidate.is_file().then_some(candidate)
        })
    })
}

/// The checks for one definition, whose paths are relative to its project in
/// the checkout at `root`.
fn projection(root: &Path, definition: &Value, catalog: &Value) -> Value {
    let id = definition["id"].as_str().unwrap_or_default();
    let project = crate::project::directory(root);
    let mut items = Vec::new();
    let extractor = &definition["extractor"];
    if let Some(builtin) = extractor.as_str() {
        items.push(builtin_extractor(builtin, catalog));
    } else if let Some(command) = extractor["command"].as_array() {
        items.push(command_extractor(&project, command));
    }
    if let Some(bundle) = definition["renderer"]["bundle"].as_str() {
        items.push(custom_renderer(root, definition, bundle));
        if let Some(message) = renderer_package(root, definition) {
            items.push(item("warn", "Renderer package", message));
        }
    } else if let Some(name) = definition["renderer"].as_str() {
        items.push(item("pass", "Renderer", format!("Built-in renderer {name}")));
    }
    if let Some(rules) = crate::artifact::custom_comparator(definition) {
        items.push(if project.join(rules).is_file() {
            item("pass", "Comparator", format!("Custom comparator {rules}"))
        } else {
            item("fail", "Comparator", format!("{rules} doesn't exist"))
        });
    }
    let ok = items.iter().all(|item| item["status"] != "fail");
    json!({"id": id, "title": definition["title"].as_str().unwrap_or(id), "ok": ok, "items": items})
}

/// Whether the built-in extractor exists, and whether it needs trust.
fn builtin_extractor(builtin: &str, catalog: &Value) -> Value {
    let descriptor = catalog["extractors"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|descriptor| descriptor["id"] == builtin);
    match descriptor {
        None => item(
            "fail",
            "Extractor",
            format!("Unknown built-in extractor {builtin}; projections extractor list shows them"),
        ),
        Some(descriptor) => item(
            "pass",
            "Extractor",
            format!(
                "Built-in extractor {builtin}{}",
                if descriptor["trust"] == "none" {
                    ""
                } else {
                    " (runs repository code, so it needs --trust)"
                }
            ),
        ),
    }
}

/// Whether the extractor command's program is on `PATH` and the files it
/// names exist.
fn command_extractor(root: &Path, command: &[Value]) -> Value {
    let program = command.first().and_then(Value::as_str).unwrap_or_default();
    let files: Vec<&str> = command
        .iter()
        .skip(1)
        .filter_map(Value::as_str)
        .filter(|argument| {
            !argument.starts_with('-') && (argument.contains('/') || argument.contains('.')) && Path::new(argument).extension().is_some()
        })
        .collect();
    let missing: Vec<&&str> = files.iter().filter(|file| !root.join(file).is_file()).collect();
    match (extractor_program(root, program), missing.is_empty()) {
        (Err(message), _) => item("fail", "Extractor", message),
        (Ok(_), false) => item(
            "fail",
            "Extractor",
            format!(
                "{} doesn't exist in the working tree",
                missing.iter().map(|file| **file).collect::<Vec<_>>().join(", ")
            ),
        ),
        (Ok(path), true) => item(
            "pass",
            "Extractor",
            format!("{} (runs repository code, so it needs --trust)", path.display()),
        ),
    }
}

/// What an extractor command's `program` runs, or why it can't run. A bare
/// python3 or python runs whichever Python 3 the machine has (crate::python::launch).
fn extractor_program(root: &Path, program: &str) -> Result<PathBuf, String> {
    if crate::python::launches_python(program) {
        return crate::python::find(program)
            .map(|prefix| PathBuf::from(prefix.join(" ")))
            .ok_or_else(|| {
                format!("{program} needs Python 3, but none of python3, python or py -3 on PATH runs it; Projections never installs it")
            });
    }
    find_program(root, program).ok_or_else(|| {
        format!("{program} is not on PATH; the extractor runs with this project's own toolchain, which Projections never installs")
    })
}

/// Whether the custom renderer is built or its development server runs.
fn custom_renderer(root: &Path, definition: &Value, bundle: &str) -> Value {
    let directory = crate::project::renderer_bundle(definition)
        .ok()
        .flatten()
        .map(|bundle| root.join(bundle));
    let built = directory.is_some_and(|directory| directory.join("index.html").is_file() && directory.join("renderer.json").is_file());
    let package = dev_server::package(root, definition);
    let live = package.as_deref().and_then(dev_server::find);
    match (built, &package, live) {
        (_, _, Some((url, _))) => item(
            "pass",
            "Renderer",
            format!("Custom renderer {bundle}; its development server runs at {url}"),
        ),
        (true, _, None) => item("pass", "Renderer", format!("Custom renderer {bundle}")),
        (false, Some(package), None) => item(
            "fail",
            "Renderer",
            format!(
                "The custom renderer {bundle} isn't built: run npm install && npm run build in {}{}",
                package.strip_prefix(root).unwrap_or(package).display(),
                if find_program(root, "npm").is_none() {
                    " (npm isn't on PATH: custom renderers are built with Node and npm)"
                } else {
                    ""
                }
            ),
        ),
        (false, None, None) => item(
            "fail",
            "Renderer",
            format!("The custom renderer bundle {bundle} has no index.html and renderer.json"),
        ),
    }
}

/// Why the custom renderer's package needs updating, when the
/// `@githubnext/projections` it uses isn't this CLI's version.
fn renderer_package(root: &Path, definition: &Value) -> Option<String> {
    let package = dev_server::package(root, definition)?;
    let shown = package.strip_prefix(root).unwrap_or(&package).display().to_string();
    scaffold::version_mismatch(&package, &shown)
}

/// The doctor report, as a `projections.doctor` document.
pub fn doctor(runner: &Runner, ids: &[String]) -> Value {
    let mut items = Vec::new();
    let root = match runner.repository_root() {
        Ok(root) => {
            items.push(item("pass", "Repository", format!("Git checkout at {}", root.display())));
            root
        }
        Err(error) => {
            items.push(item(
                "fail",
                "Repository",
                format!("{error:#}. Run Projections in a Git checkout, or pass -C DIR"),
            ));
            return json!({"format": "projections.doctor", "version": 0, "ok": false, "items": items, "projections": []});
        }
    };
    if runner.resolve(&root, "HEAD").is_err() {
        items.push(item(
            "fail",
            "Commits",
            "This repository has no commits yet; commit once (git commit --allow-empty -m Start)",
        ));
    }
    let (status, message) = crate::skill::health::status(&root);
    items.push(item(status, "Agent skill", message));
    let environment = runner.environment_report();
    let mut toolchains = false;
    let mut projections = Vec::new();
    match runner.discover_all("working-tree") {
        Err(error) => items.push(item("fail", "Definitions", format!("{error:#}"))),
        Ok((definitions, invalid)) => {
            for failure in &invalid {
                items.push(item("fail", "Definitions", crate::runtime::invalid_summary(failure)));
            }
            if workspace::authored(&root) {
                items.push(item("pass", "Definitions", format!("{} valid", definitions.len())));
            } else {
                items.push(item(
                    "warn",
                    "Definitions",
                    "This repository defines no projections; the built-in defaults apply. Create one with projections init <id>",
                ));
            }
            let catalog = collectors::catalog();
            toolchains = definitions
                .iter()
                .any(|definition| definition["extractor"].as_str().is_none_or(|id| !collectors::reads_files_only(id)));
            for definition in definitions
                .iter()
                .filter(|definition| ids.is_empty() || ids.iter().any(|id| definition["id"] == id.as_str()))
            {
                projections.push(projection(&root, definition, &catalog));
            }
        }
    }
    match &environment {
        Err(error) => items.push(item("fail", "Environment", format!("{error:#}"))),
        Ok(report) => items.extend(environment_items(report, toolchains)),
    }
    items.push(match browser::find(None) {
        Ok(path) => item("pass", "Browser", format!("{} (for --png and check)", path.display())),
        Err(_) => item(
            "warn",
            "Browser",
            "No Chrome, Chromium or Edge found: --png and the renderer checks in projections check need one (or --browser PATH)",
        ),
    });
    let ok = items.iter().all(|item| item["status"] != "fail") && projections.iter().all(|projection| projection["ok"] == true);
    let mut report = json!({"format": "projections.doctor", "version": 0, "ok": ok, "items": items, "projections": projections});
    if let Ok(environment) = environment {
        report["environment"] = environment;
    }
    report
}

/// The environment's items: what is declared, what is prepared in the working
/// tree, what is stale or missing, and the workspace strategy and why.
fn environment_items(report: &Value, toolchains: bool) -> Vec<Value> {
    let mut items = Vec::new();
    if let Some(error) = report["error"].as_str() {
        items.push(item("fail", "Environment", error));
    } else if let Some(path) = report["declared"].as_str() {
        let steps = report["prepare"].as_array().map_or(0, Vec::len);
        items.push(item(
            "pass",
            "Environment",
            format!("{path} declares {steps} prepare step{}", if steps == 1 { "" } else { "s" }),
        ));
        for step in report["prepare"].as_array().into_iter().flatten() {
            let id = step["id"].as_str().unwrap_or_default();
            let title = format!("Prepare {id}");
            let log = step["last"]["log"].as_str().unwrap_or_default();
            items.push(match step["state"].as_str() {
                Some("current") => item("pass", &title, "prepared in the working tree; its key files are unchanged since"),
                Some("stale") => item(
                    "warn",
                    &title,
                    "its key files changed since it last ran in the working tree; run projections prepare --trust",
                ),
                Some("failed") => item(
                    "warn",
                    &title,
                    format!("its last run in the working tree failed (log: {log}); run projections prepare --trust"),
                ),
                _ => item(
                    "warn",
                    &title,
                    "never run in the working tree (nothing runs there automatically); run projections prepare --trust",
                ),
            });
        }
        for program in report["missing"].as_array().into_iter().flatten() {
            items.push(item(
                "fail",
                "Environment tools",
                format!("{} isn't on PATH; the environment needs it", program.as_str().unwrap_or_default()),
            ));
        }
        if let Some(devcontainer) = report["devcontainer"].as_str() {
            items.push(item(
                "pass",
                "Devcontainer",
                format!("{devcontainer} describes the same environment (reported; Projections doesn't run it)"),
            ));
        }
    } else if toolchains {
        items.push(item(
            "warn",
            "Environment",
            "None declared: toolchain extractors of other commits borrow the working tree's installed dependencies, and are labelled approximate when the lockfiles differ. Declare prepare steps in .github/projections/environment.json",
        ));
    } else {
        items.push(item("pass", "Environment", "None declared; no projection runs a toolchain"));
    }
    let workspace = &report["workspace"];
    items.push(match workspace["strategy"].as_str() {
        Some(strategy) => item(
            "pass",
            "Workspace",
            format!(
                "{strategy} ({}: {}); {} kept",
                workspace["source"].as_str().unwrap_or_default(),
                workspace["reason"].as_str().unwrap_or_default(),
                report["workspaces"].as_array().map_or(0, Vec::len)
            ),
        ),
        None => item("warn", "Workspace", workspace["error"].as_str().unwrap_or("unknown")),
    });
    items
}

/// The report as text, status words first.
pub fn text(report: &Value) -> String {
    let mut text = String::new();
    let line = |text: &mut String, indent: &str, item: &Value| {
        text.push_str(&format!(
            "{indent}{:<4} {}: {}\n",
            item["status"].as_str().unwrap_or_default(),
            item["title"].as_str().unwrap_or_default(),
            item["message"].as_str().unwrap_or_default()
        ));
    };
    for item in report["items"].as_array().into_iter().flatten() {
        line(&mut text, "", item);
    }
    for projection in report["projections"].as_array().into_iter().flatten() {
        text.push_str(&format!(
            "{} [{}]\n",
            projection["title"].as_str().unwrap_or_default(),
            projection["id"].as_str().unwrap_or_default()
        ));
        for item in projection["items"].as_array().into_iter().flatten() {
            line(&mut text, "  ", item);
        }
    }
    text.push_str(if report["ok"] == true {
        "Nothing is missing.\n"
    } else {
        "Something this checkout needs is missing; each fail says what to do.\n"
    });
    text
}
