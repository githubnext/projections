//! The parts `init` adds to a projection's definition, each with the files it
//! scaffolds: an extractor, a renderer and a comparator.

use super::{COMPARATOR, COMPARATOR_TESTS, Extractor, RENDERER, Renderer, Report, detect_language, fill, package::renderer_manifest};
use crate::collectors;
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::path::Path;

/// The projection one `init` run is building: its definition so far and the
/// files its parts need.
pub(super) struct Draft<'a> {
    pub root: &'a Path,
    pub id: &'a str,
    /// The projection's own directory, `<definition directory>/<id>`, repository-relative.
    pub component: String,
    /// The definition's project, relative to the repository's root: the paths
    /// the definition declares are relative to it.
    pub project: &'a str,
    /// Whether the definition exists already.
    pub existing: bool,
    /// The values templates are filled with.
    pub values: &'a [(&'a str, &'a str)],
    pub definition: Value,
    /// Files to create, relative to the repository root.
    pub files: Vec<(String, String)>,
}

impl Draft<'_> {
    /// A repository-relative path under the project, as the definition declares it.
    fn declared(&self, path: &str) -> String {
        match self.project {
            "" => path.to_owned(),
            project => path.strip_prefix(&format!("{project}/")).unwrap_or(path).to_owned(),
        }
    }

    pub fn extractor(&mut self, extractor: Extractor) -> Result<()> {
        match extractor {
            Extractor::Builtin(builtin) => self.builtin_extractor(&builtin)?,
            Extractor::BuiltinWith(builtin, inputs) => {
                self.builtin_extractor(&builtin)?;
                if !self.definition["inputs"].is_object() {
                    self.definition["inputs"] = json!({});
                }
                for (name, value) in inputs {
                    self.definition["inputs"][name] = value;
                }
            }
            Extractor::Command(command) => {
                self.definition["extractor"] = json!({"command": command});
            }
            Extractor::Starter(language) => {
                let language = language.or_else(|| detect_language(&crate::project::directory(self.root))).context(
                    "Choose the extractor's language with --language node, python or go. \
                     No package.json, pyproject.toml, requirements.txt, setup.py, Pipfile or go.mod at the project's root says which toolchain this project uses; \
                     for another language, write the program and pass --command",
                )?;
                let program = format!("{}/{}", self.component, language.file());
                self.files.push((program.clone(), fill(language.template(), self.values)));
                let declared = self.declared(&program);
                self.definition["extractor"] = json!({"command": language.command(&declared), "sources": [declared]});
            }
        }
        Ok(())
    }

    /// A built-in extractor's template fields; an existing definition keeps its renderer.
    fn builtin_extractor(&mut self, builtin: &str) -> Result<()> {
        let template = collectors::catalog()["extractors"]
            .as_array()
            .context("Invalid extractor catalog")?
            .iter()
            .find(|descriptor| descriptor["id"] == builtin)
            .map(|descriptor| descriptor["template"].clone())
            .with_context(|| format!("Unknown extractor {builtin}; projections extractor list shows them"))?;
        for (key, value) in template.as_object().context("Invalid extractor template")? {
            if key != "id" && key != "title" && (key != "renderer" || !self.existing) {
                self.definition[key] = value.clone();
            }
        }
        Ok(())
    }

    /// A built-in renderer's name, or a custom renderer package named `name`.
    pub fn renderer(&mut self, renderer: Renderer, name: &str, checkout: Option<&Path>, report: &mut Report) -> Result<()> {
        match renderer {
            Renderer::Builtin(builtin) => {
                self.definition["renderer"] = json!(builtin);
                Ok(())
            }
            Renderer::Custom => self.custom_renderer(name, checkout, report),
        }
    }

    fn custom_renderer(&mut self, name: &str, checkout: Option<&Path>, report: &mut Report) -> Result<()> {
        let id = self.id;
        ensure!(!name.is_empty(), "Projection ID {id} has no letters or digits for a renderer name");
        let package = format!("{}/renderer", self.component);
        for (relative, template) in RENDERER {
            let contents = fill(template, self.values);
            let contents = if *relative == "package.json" {
                let directory = self.root.canonicalize()?.join(&package);
                renderer_manifest(&contents, checkout, &directory, report)?
            } else {
                contents
            };
            self.files.push((format!("{package}/{relative}"), contents));
        }
        let declared = self.declared(&package);
        self.definition["renderer"] = json!({
            "bundle": format!("{declared}/dist"),
            "sources": [format!("{declared}/src"), format!("{declared}/package.json")],
        });
        report.renderer = Some(package);
        Ok(())
    }

    /// A starter comparator file and the tests beside it.
    pub fn comparator(&mut self) {
        let (component, id) = (&self.component, self.id);
        let file = format!("{component}/{id}.comparator.yaml");
        self.files.push((file.clone(), fill(COMPARATOR, self.values)));
        self.files.push((
            format!("{component}/{id}.comparator.test.yaml"),
            fill(COMPARATOR_TESTS, self.values),
        ));
        self.definition["comparator"] = json!(self.declared(&file));
    }
}
