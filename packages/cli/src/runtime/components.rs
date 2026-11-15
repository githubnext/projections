//! A definition's custom comparator and renderer files, read from its revision.

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};

use super::{
    MAX_RENDERER_BYTES, MAX_RULES_BYTES, RENDERER_FILES, Runner,
    definitions::definition_paths,
    revision::{Revision, safe_path},
};
use crate::artifact;

/// A custom renderer bundle's files: names relative to the bundle and bytes.
type RendererBundle = Vec<(String, Vec<u8>)>;

pub(super) fn sorted(mut bundle: RendererBundle) -> RendererBundle {
    bundle.sort();
    bundle
}

impl Runner {
    /// The comparator file of a definition's custom comparator (relative to its
    /// project), read from its revision.
    pub(super) fn comparator_bytes(&self, definition: &Value, program: &Revision) -> Result<Option<Vec<u8>>> {
        let Some(path) = artifact::custom_comparator(definition) else {
            return Ok(None);
        };
        let path = crate::project::resolve(path)?;
        self.comparator_file(&path, program).map(Some)
    }

    /// The repository's comparator file `path`, read from `program`.
    fn comparator_file(&self, path: &str, program: &Revision) -> Result<Vec<u8>> {
        ensure!(
            program.files.iter().any(|file| file == path),
            "Comparator file {path} does not exist in {}",
            program.repository["ref"]
        );
        ensure!(program.is_regular(path), "Comparator file {path} must be a regular file");
        self.read_file(program, path, MAX_RULES_BYTES)
    }

    /// The comparator files (`*.comparator.yaml`, `*.comparator.yml`) at `reference`, sorted,
    /// so the Inspector can try any of them as a projection's comparator.
    pub fn rules_files(&self, reference: &str) -> Result<Vec<String>> {
        let repository = self.repository_root()?;
        let patterns = [":(glob)**/*.comparator.yaml", ":(glob)**/*.comparator.yml"];
        let listed = if reference == "working-tree" {
            let mut arguments = vec!["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--"];
            arguments.extend(patterns);
            self.git(&repository, &arguments, None, 16 * 1024 * 1024)?
        } else {
            // `ls-tree` takes paths, not pathspec patterns: list and filter.
            let commit = self.resolve(&repository, reference)?;
            self.git(
                &repository,
                &["ls-tree", "-r", "-z", "--name-only", commit.as_str()],
                None,
                64 * 1024 * 1024,
            )?
        };
        let mut files: Vec<String> = std::str::from_utf8(&listed)?
            .split('\0')
            .filter(|name| projections_comparator_runtime::is_comparator_file(name))
            .filter(|name| safe_path(name).is_ok())
            .map(str::to_owned)
            .collect();
        files.sort();
        files.dedup();
        files.truncate(200);
        Ok(files)
    }

    /// A comparator file at `reference` as a viewer runs it: `{"rules", "digest"}`,
    /// `rules` holding its bytes.
    pub fn rules_comparator(&self, path: &str, reference: &str) -> Result<Value> {
        safe_path(path)?;
        ensure!(
            projections_comparator_runtime::is_comparator_file(path),
            "{path} is not a comparator file (.comparator.yaml or .comparator.yml)"
        );
        let program = self.capture_paths(reference, Some(&[path.to_owned()]))?;
        let bytes = self.comparator_file(path, &program)?;
        let rules = artifact::load_comparator(path, &bytes)?;
        Ok(json!({"rules": artifact::base64(&bytes), "digest": rules.digest()}))
    }

    /// The comparator a viewer runs for a projection defined at `reference`:
    /// `{"default": true}`, or a comparator file's bytes (`rules`) and digest.
    pub fn comparator(&self, id: &str, reference: &str) -> Result<Value> {
        let definitions = self.capture_paths(reference, Some(&definition_paths()))?;
        let definition = self.definition(&definitions, id)?;
        let Some(path) = artifact::custom_comparator(&definition) else {
            return Ok(json!({"default": true}));
        };
        let program = self.capture_paths(reference, Some(&[crate::project::resolve(path)?]))?;
        let bytes = self.comparator_bytes(&definition, &program)?.context("Missing comparator file")?;
        let rules = artifact::load_comparator(path, &bytes)?;
        Ok(json!({"rules": artifact::base64(&bytes), "digest": rules.digest()}))
    }

    /// The files of a definition's custom renderer bundle at its revision:
    /// exactly a self-contained `index.html` and its `renderer.json`.
    fn renderer_bundle(&self, definition: &Value, program: &Revision) -> Result<Vec<(String, Vec<u8>)>> {
        let Some(bundle) = crate::project::renderer_bundle(definition)? else {
            return Ok(Vec::new());
        };
        let prefix = format!("{bundle}/");
        let mut files = Vec::new();
        for name in program.files.iter().filter(|name| name.starts_with(&prefix)) {
            let relative = &name[prefix.len()..];
            // The renderer SDK's build writes the bundle's license notices beside
            // it; they are part of the source tree, not of what hosts serve.
            if relative == "THIRD_PARTY_NOTICES.txt" {
                continue;
            }
            ensure!(
                RENDERER_FILES.contains(&relative),
                "Renderer bundle {bundle} must contain only index.html and renderer.json (and THIRD_PARTY_NOTICES.txt), not {relative}"
            );
            ensure!(
                program.is_regular(name),
                "Renderer bundle {bundle} must contain only regular files: {name}"
            );
            files.push((relative.to_owned(), self.read_file(program, name, MAX_RENDERER_BYTES)?));
        }
        for required in RENDERER_FILES {
            ensure!(
                files.iter().any(|(name, _)| name == required),
                "Renderer bundle {bundle} in {} must contain {required}",
                program.repository["ref"]
            );
        }
        Ok(files)
    }

    /// The custom renderer bundle `id` declares at `reference`, or `None` when
    /// the revision doesn't define the projection or uses a built-in renderer.
    fn renderer_bundle_at(&self, id: &str, reference: &str) -> Result<Option<RendererBundle>> {
        let definitions = self.capture_paths(reference, Some(&definition_paths()))?;
        let Ok(definition) = self.definition(&definitions, id) else {
            return Ok(None);
        };
        let Some(bundle) = crate::project::renderer_bundle(&definition)? else {
            return Ok(None);
        };
        let revision = self.capture_paths(reference, Some(&[bundle]))?;
        Ok(Some(sorted(self.renderer_bundle(&definition, &revision)?)))
    }

    /// Whether the custom renderer `definition` declares at `reference` needs
    /// explicit trust when nothing else names a base revision, as in the
    /// Inspector. The checkout is the base: renderers in the working tree and
    /// `HEAD`'s history run without it. A revision outside that history, such
    /// as a fetched pull request head, is treated as a head revision whose
    /// base is its merge base with `HEAD`.
    pub fn renderer_requires_trust(&self, definition: &Value, reference: &str) -> Result<bool> {
        if definition["renderer"]["bundle"].as_str().is_none() || reference == "working-tree" {
            return Ok(false);
        }
        let id = definition["id"].as_str().context("Missing projection ID")?;
        let root = self.repository_root()?;
        let commit = self.resolve(&root, reference)?;
        let head = self.resolve(&root, "HEAD")?;
        let Ok(base) = self.git_text(&root, &["merge-base", &commit, &head]) else {
            return Ok(true);
        };
        if base == commit {
            return Ok(false);
        }
        let bundle = self.renderer_bundle_at(id, &commit).ok().flatten();
        Ok(bundle.is_none() || self.renderer_bundle_at(id, &base).ok().flatten() != bundle)
    }

    /// One file of a projection's custom renderer bundle, from the definition
    /// at `reference`.
    pub fn renderer_file(&self, id: &str, reference: &str, path: &str) -> Result<Vec<u8>> {
        let definitions = self.capture_paths(reference, Some(&definition_paths()))?;
        let definition = self.definition(&definitions, id)?;
        let bundle = crate::project::renderer_bundle(&definition)?.with_context(|| format!("Projection {id} uses a built-in renderer"))?;
        ensure!(
            RENDERER_FILES.contains(&path),
            "Renderer bundles contain only index.html and renderer.json"
        );
        let filename = format!("{bundle}/{path}");
        safe_path(&filename)?;
        let revision = self.capture_paths(reference, Some(std::slice::from_ref(&filename)))?;
        if !revision.files.iter().any(|file| file == &filename) {
            // The working tree is what Git sees, so a bundle the repository ignores (a `dist/` rule) is missing there.
            if reference == "working-tree" {
                let root = self.repository_root()?;
                let ignored = self.git_text(&root, &["ls-files", "--others", "--ignored", "--exclude-standard", "--", &filename])?;
                ensure!(
                    ignored.is_empty(),
                    "Renderer file {filename} is ignored by Git, so the working tree doesn't include it: commit the bundle with the renderer's sources (re-include it, for example with `!dist/` in the renderer package's .gitignore)"
                );
            }
            bail!("Renderer file {filename} does not exist");
        }
        ensure!(revision.is_regular(&filename), "Renderer files must be regular files");
        self.read_file(&revision, &filename, MAX_RENDERER_BYTES)
    }
}
