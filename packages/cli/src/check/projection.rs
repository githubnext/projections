//! One projection's check: its steps, in report order.

use super::{
    Options,
    churn::churn_step,
    failed,
    renderer::{diff_step, renderer_package_step, renderer_step},
    reproducibility::{determinism_step, own_files_step, parity_step, scope_step},
    step,
};
use crate::runtime::{DefinitionSource, Runner};
use anyhow::Result;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// What every projection's check shares.
pub(super) struct Checker<'a> {
    pub(super) runner: &'a Runner,
    pub(super) root: PathBuf,
    pub(super) options: &'a Options,
    pub(super) has_head: bool,
    /// The browser to run renderer checks in; `None` with `--no-render`.
    pub(super) executable: Option<Result<PathBuf>>,
}

/// A projection whose extraction is rendered.
pub(super) struct Rendered<'a> {
    pub(super) id: &'a str,
    pub(super) definition: &'a Value,
    pub(super) document: &'a Value,
    pub(super) comparison: Option<&'a Value>,
    pub(super) bundle: Option<PathBuf>,
}

impl Checker<'_> {
    /// The checked projection's report entry.
    pub(super) async fn projection(&self, definition: &Value) -> Result<Value> {
        let id = definition["id"].as_str().unwrap_or_default().to_owned();
        let options = self.options;
        let mut steps = vec![step("definition", "Definition", "pass", "Valid")];
        let extraction = self.extract(&id, &mut steps);
        if let (Some(document), None) = (&extraction, &options.from) {
            steps.push(determinism_step(self.runner, &id, definition, document, options.strict_determinism));
            if let Some(step) = scope_step(self.runner, &id) {
                steps.push(step);
            }
            if let Some(step) = own_files_step(self.runner, &id, document) {
                steps.push(step);
            }
        }
        if let Some(step) = extraction.as_ref().and_then(|document| churn_step(definition, document)) {
            steps.push(step);
        }
        let comparison = if extraction.is_some() {
            self.compare(&id, &mut steps)
        } else {
            None
        };
        if let Some(reference) = &options.parity {
            steps.push(parity_step(self.runner, &id, reference));
        }
        // Tests use their own fixtures, so they run even when extraction failed.
        steps.push(crate::comparator_tests::check_step(
            &self.root,
            self.runner,
            definition,
            options.update,
            options.coverage,
        ));
        let (renderer, bundle) = renderer_step(&self.root, definition);
        let renderer_failed = renderer["status"] == "fail";
        steps.push(renderer);
        steps.extend(renderer_package_step(&self.root, definition));
        if !renderer_failed && let Some(modes) = diff_step(definition, bundle.as_deref()) {
            steps.push(modes);
        }
        let skipped = |message: String| step("render", "Renderer checks", "skip", message);
        match (&extraction, &self.executable) {
            (_, None) => steps.push(skipped("--no-render".into())),
            (None, _) => steps.push(skipped("Nothing extracted to render".into())),
            (Some(_), _) if renderer_failed => {
                steps.push(skipped("The renderer bundle isn't available".into()));
            }
            (Some(_), Some(Err(error))) => steps.push(skipped(format!("{error:#}. Pass --browser, or --no-render to skip them"))),
            (Some(document), Some(Ok(executable))) => {
                let target = Rendered {
                    id: &id,
                    definition,
                    document,
                    comparison: comparison.as_ref(),
                    bundle,
                };
                self.render(target, executable, &mut steps).await?;
            }
        }
        let ok = steps.iter().all(|step| step["status"] != "fail");
        Ok(json!({
            "id": id, "title": definition["title"].as_str().unwrap_or(&id), "ok": ok, "steps": steps,
        }))
    }

    /// The extraction step: the working tree's extraction, or the supplied one.
    fn extract(&self, id: &str, steps: &mut Vec<Value>) -> Option<Value> {
        let source = self.source();
        let extracted = match &self.options.from {
            Some(file) => self.runner.supplied(id, file),
            None => self.runner.show(id, "working-tree", None),
        };
        match extracted {
            // At the checked revision a declared input that doesn't exist is a misconfiguration,
            // even though another revision of a comparison may lack it.
            Ok(document) if !crate::artifact::missing_inputs(&document).is_empty() => {
                steps.push(missing_inputs(source, &document));
                None
            }
            Ok(document) => {
                steps.push(step("extract", source, "pass", summary(&document)));
                Some(document)
            }
            Err(error) => {
                steps.push(failed("extract", source, &error));
                None
            }
        }
    }

    fn source(&self) -> &'static str {
        if self.options.from.is_some() {
            "Supplied extraction"
        } else {
            "Working tree extraction"
        }
    }

    /// The comparison with HEAD under the working tree's definition, when one runs.
    fn compare(&self, id: &str, steps: &mut Vec<Value>) -> Option<Value> {
        const TITLE: &str = "Comparison with HEAD";
        if self.options.from.is_some() {
            steps.push(step("compare", TITLE, "skip", "--from checks a supplied extraction alone"));
            return None;
        }
        if !self.has_head {
            steps.push(step("compare", TITLE, "skip", "No commits yet"));
            return None;
        }
        match self.runner.compare_with(id, "HEAD", "working-tree", DefinitionSource::Head) {
            Ok(compared) => {
                let document = compared.document;
                steps.push(compared_step(&document));
                Some(document)
            }
            Err(error) => {
                let mut value = failed("compare", TITLE, &error);
                // HEAD may predate what the extractor reads; the working tree is what matters.
                value["status"] = json!("warn");
                value["message"] = json!(format!(
                    "HEAD couldn't be extracted with the working tree's definition: {}",
                    value["message"].as_str().unwrap_or_default()
                ));
                steps.push(value);
                None
            }
        }
    }
}

fn compared_step(document: &Value) -> Value {
    let changes = document["comparison"]["changes"].as_array().map_or(0, Vec::len);
    let count = document["comparison"]["steps"].as_array().map_or(0, Vec::len);
    let hint = if changes == 0 {
        ". Nothing changed, so it exercises no comparison checks; compare real history with compare v1..v2 -p ID --definition-revision working-tree, and a renderer package's scenarios.json comparisons run here"
    } else {
        ""
    };
    step(
        "compare",
        "Comparison with HEAD",
        "pass",
        format!("{changes} changes in {count} steps since HEAD (the working tree's definition applied to both){hint}"),
    )
}

fn missing_inputs(source: &str, document: &Value) -> Value {
    let missing = crate::artifact::missing_inputs(document);
    step(
        "extract",
        source,
        "fail",
        format!(
            "Declared {} {} not exist at {}: {}. Fix the projection's inputs.",
            if missing.len() == 1 { "input" } else { "inputs" },
            if missing.len() == 1 { "does" } else { "do" },
            crate::artifact::revision_name(document),
            missing.iter().map(|path| crate::runtime::code(path)).collect::<Vec<_>>().join(", ")
        ),
    )
}

fn summary(document: &Value) -> String {
    let extraction = &document["extraction"];
    let count = |key: &str| extraction[key].as_array().map_or(0, Vec::len);
    format!(
        "{} entities, {} relationships ({})",
        count("entities"),
        count("relationships"),
        extraction["schema"].as_str().unwrap_or("unknown schema")
    )
}

impl Rendered<'_> {
    /// The renderer's name, from a custom bundle's manifest or the definition.
    pub(super) fn renderer_name(&self) -> Result<Value> {
        Ok(match &self.bundle {
            Some(bundle) => {
                crate::fixtures::renderer_manifest(&serde_json::from_slice(&std::fs::read(bundle.join("renderer.json"))?)?)?["name"].clone()
            }
            None => self.definition["renderer"].clone(),
        })
    }

    /// The scenarios file the check writes, and a custom renderer's own.
    pub(super) fn sources(&self, root: &Path, written: PathBuf) -> Vec<PathBuf> {
        // A custom renderer's own scenarios are checked too: they
        // exercise comparisons the working tree may not have.
        let mut sources = vec![written];
        if let Some(file) = crate::dev_server::package(root, self.definition)
            .map(|package| package.join("scenarios.json"))
            .filter(|file| file.is_file())
        {
            sources.push(file);
        }
        sources
    }
}
