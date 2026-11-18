//! The renderer checks step: the projection's scenarios rendered in a
//! headless browser, and the image `--png` writes.

use super::{
    failed,
    projection::{Checker, Rendered},
    scenarios::write_scenarios,
    stage::renderer_checks,
    step,
};
use crate::{assets, browser, fixtures, runtime::DefinitionSource, snapshot};
use anyhow::Result;
use serde_json::{Value, json};
use std::{collections::HashMap, fs, path::Path};

impl Checker<'_> {
    /// Runs the renderer checks on the projection's scenarios, then writes `--png`.
    pub(super) async fn render(&self, target: Rendered<'_>, executable: &Path, steps: &mut Vec<Value>) -> Result<()> {
        let directory = tempfile::Builder::new().prefix("projections-check-").tempdir()?;
        let path = write_scenarios(
            directory.path(),
            &self.root,
            target.definition,
            target.definition["title"].as_str().unwrap_or(target.id),
            target.renderer_name()?,
            target.document,
            target.comparison,
        )?;
        let sources = target.sources(&self.root, path);
        let loaded = fixtures::load(&sources, target.bundle.as_slice(), "", true, self.runner.trust);
        for error in loaded.errors() {
            steps.push(step("render", "Renderer scenarios", "fail", error));
        }
        let (keys, titles) = scenario_keys(&loaded.value, self.options.from.is_some());
        match renderer_checks(
            &sources,
            target.bundle,
            self.runner.trust,
            &keys,
            executable,
            &self.browsers,
            self.options.timeout,
            self.options.cancel.clone(),
        )
        .await
        {
            Ok(results) => steps.extend(results.into_iter().map(|(key, checks)| checks_step(&titles, &key, checks))),
            Err(error) => steps.push(failed("render", "Renderer checks", &error)),
        }
        self.png(target.document, executable, steps).await
    }

    /// `--png`: an image of the working tree's extraction, never overwriting a file.
    async fn png(&self, document: &Value, executable: &Path, steps: &mut Vec<Value>) -> Result<()> {
        let Some(png) = &self.options.png else {
            return Ok(());
        };
        if fs::symlink_metadata(png).is_ok() {
            steps.push(step(
                "png",
                "Image",
                "fail",
                format!("{} already exists; images never overwrite files, so name a new one", png.display()),
            ));
            return Ok(());
        }
        let rendered = snapshot::render_with(
            snapshot::Request {
                document: document.clone(),
                definition_revision: Some("working-tree".into()),
                repo: self.root.clone(),
                trust: self.runner.trust,
                definition: DefinitionSource::Base,
                assets: assets::inspector_assets()?.path.clone(),
                mode: None,
                progress: None,
                focus: snapshot::Focus::default(),
                theme: snapshot::Theme::Light,
                frame: snapshot::Frame::Card,
                matte: None,
                width: 1280,
                height: 800,
                scale: 1.0,
                browser: executable.to_path_buf(),
                transport: browser::Transport::default(),
                timeout: self.options.timeout,
                cancel: self.options.cancel.clone(),
            },
            &self.browsers,
        )
        .await;
        match rendered.and_then(|rendered| crate::create_file(png, &rendered.png)) {
            Ok(()) => steps.push(step("png", "Image", "pass", format!("Wrote {}", png.display()))),
            Err(error) => steps.push(failed("png", "Image", &error)),
        }
        Ok(())
    }
}

/// The keys of the loaded scenarios that can be checked, and each one's title.
fn scenario_keys(loaded: &Value, supplied: bool) -> (Vec<String>, HashMap<String, String>) {
    let mut titles = HashMap::new();
    let keys = loaded["scenarios"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|scenario| scenario["error"].is_null())
        .filter_map(|scenario| {
            let key = scenario["key"].as_str()?.to_owned();
            titles.insert(key.clone(), scenario_title(scenario, supplied));
            Some(key)
        })
        .collect();
    (keys, titles)
}

fn scenario_title(scenario: &Value, supplied: bool) -> String {
    if scenario["source"] != "check" {
        format!("scenarios.json {}", scenario["id"].as_str().unwrap_or_default())
    } else if scenario["id"] == "head" {
        "HEAD → working tree".to_owned()
    } else if supplied {
        "supplied extraction".to_owned()
    } else {
        "working tree".to_owned()
    }
}

/// One scenario's renderer checks as a step, its failures as details.
fn checks_step(titles: &HashMap<String, String>, key: &str, checks: Value) -> Value {
    let all = checks.as_array().cloned().unwrap_or_default();
    let failures: Vec<String> = all
        .iter()
        .filter(|check| check["status"] == "fail")
        .flat_map(|check| {
            let title = check["title"].as_str().unwrap_or_default().to_owned();
            check["details"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(move |detail| format!("{title}: {}", detail.as_str().unwrap_or_default()))
        })
        .collect();
    let passed = all.iter().filter(|check| check["status"] == "pass").count();
    let skipped = all.iter().filter(|check| check["status"] == "skip").count();
    let scenario = titles.get(key).map_or("working tree", String::as_str);
    let mut value = step(
        "render",
        &format!("Renderer checks, {scenario}"),
        if failures.is_empty() { "pass" } else { "fail" },
        format!("{passed} passed, {} failed, {skipped} skipped", all.len() - passed - skipped),
    );
    if !failures.is_empty() {
        value["details"] = json!(failures);
    }
    value["checks"] = Value::Array(all);
    value
}
