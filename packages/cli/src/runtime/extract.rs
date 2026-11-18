//! Running extractors.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};

use super::{Captured, Prepared, Runner, container::ContainerRun, document::Origin, placement::Placement, revision::Revision};
use crate::{artifact, collectors, engine};

impl Runner {
    /// A projection's definition at `program_reference` (its components, digest
    /// and comparator file) ready to extract any number of revisions with.
    pub fn prepare(&self, id: &str, program_reference: &str) -> Result<Prepared> {
        let program = self.capture(program_reference)?;
        let definition = self.definition(&program, id)?;
        self.require_trust(&definition)?;
        let digest = self.definition_digest(&definition, &program)?;
        let rules = self.comparator_bytes(&definition, &program)?;
        Ok(Prepared {
            program,
            definition,
            digest,
            rules,
        })
    }

    /// A revision materialized once, to extract several projections from.
    pub fn captured(&self, reference: &str) -> Result<Captured> {
        Ok(Captured(self.capture(reference)?))
    }

    /// Extracts a captured revision with a prepared definition.
    pub fn extract_captured(&self, captured: &Captured, prepared: &Prepared) -> Result<Value> {
        self.extract(&captured.0, &prepared.definition, &prepared.program)
    }

    /// Runs `definition`, taken from `program`, against the examined revision,
    /// in the cheapest trustworthy place ([`Runner::place`]). Component
    /// programs come from the definition's revision while
    /// `request.repository.root` names the examined revision's directory.
    pub(super) fn extract(&self, examined: &Revision, definition: &Value, program: &Revision) -> Result<Value> {
        self.require_trust(definition)?;
        // Digesting checks the definition's sources before anything runs.
        let definition_digest = self.definition_digest(definition, program)?;
        *self.current.lock().expect("revision lock") = examined.repository.clone();
        let files_only = self.isolation.is_none()
            && definition["extractor"]
                .as_str()
                .is_some_and(|id| collectors::reads_files_only(id, &definition["inputs"]));
        // A toolchain's run on the working tree also depends on ignored files
        // (installed dependencies, generated code) its identity can't see.
        // An observed extraction is never reused silently.
        let observed = determinism(definition) == projections_extractor_sdk::Determinism::Observed;
        let key = (self.cache.is_some() && !observed && (files_only || examined.is_commit()))
            .then(|| self.cache_key(examined, program, definition, &definition_digest, files_only))
            .transpose()?;
        // A commit's official extraction is the run its CI published: it comes
        // first, then this machine's cache.
        if examined.is_commit()
            && let Some(mut document) = self.artifacts.find(
                self,
                examined.repository["commit"].as_str().unwrap_or_default(),
                definition["id"].as_str().unwrap_or_default(),
                &definition_digest,
            )?
        {
            Self::restamp(&mut document, examined, definition);
            let document = artifact::validate_extraction(&document)?;
            // Not cached: whether CI's extraction is official depends on the
            // artifact policy, which is checked again on every run.
            self.harvest(definition, &document, crate::generation_store::Source::Ci);
            return Ok(document);
        }
        if let Some(key) = &key
            && let Some(document) = self.cached(key, examined, definition, &definition_digest)
        {
            self.harvest(definition, &document, crate::generation_store::Source::Local);
            return Ok(document);
        }
        // Upstream extractions run (or come from the cache) before this extractor is placed.
        let upstream = self.upstream(examined, definition, program)?;
        let placement = self.place(examined, program, definition, files_only)?;
        let argv = self.extractor_argv(definition, program, &placement)?;
        let store = self.generation_store(definition);
        // The snapshot file lives until the extractor has finished.
        let snapshot = match (&store, self.regenerate) {
            (Some(store), false) => store.snapshot_file().unwrap_or(None),
            _ => None,
        };
        let mut request = self.placed_request(definition, &placement);
        if let Some(upstream) = upstream {
            request["upstream"] = upstream;
        }
        if let Some(snapshot) = &snapshot {
            request["generations"] = json!({"file": snapshot.path()});
        }
        let extraction = self.run_request(definition, &argv, request, &placement)?;
        drop(snapshot);
        let mut placement = placement;
        if let Some(check) = &placement.check
            && !self.unchanged(check)?
        {
            placement.fidelity = "stale";
            placement.limitations.push(
                "The working tree changed while the extractor ran, so this extraction may describe neither version; extract again.".into(),
            );
        }
        let mut document = self.extraction_document(
            examined,
            program,
            definition,
            definition_digest,
            extraction,
            Origin::Ran(&placement),
        )?;
        if let Some(store) = &store {
            document = record_generations(store, &placement, document)?;
        }
        if placement.fidelity != "stale"
            && let (Some(key), Some(cache)) = (&key, &self.cache)
        {
            // A cache that can't be written never fails the extraction.
            let _ = cache.put(key, &document);
        }
        Ok(document)
    }

    /// The extractor's argv: a built-in extractor's command, or the
    /// definition's, its program resolved in the definition's project at the
    /// placement's definition revision.
    pub(super) fn extractor_argv(&self, definition: &Value, program: &Revision, placement: &Placement) -> Result<Vec<String>> {
        Ok(match definition["extractor"].as_str() {
            Some(builtin) => {
                ensure!(
                    self.isolation.is_none(),
                    "Container mode supports repository-owned executable extractors, not installed built-in extractors"
                );
                collectors::command(self, builtin)?
            }
            None => {
                let mut argv: Vec<String> = definition["extractor"]["command"]
                    .as_array()
                    .context("Missing extractor argv")?
                    .iter()
                    .map(|value| value.as_str().map(str::to_owned).context("Invalid extractor argv"))
                    .collect::<Result<_>>()?;
                if !Path::new(&argv[0]).is_absolute() && argv[0].contains('/') {
                    let resolved = crate::project::resolve(&argv[0])
                        .with_context(|| format!("Extractor program {} leaves the repository", argv[0]))?;
                    program.require_materialized(&resolved, "Extractor program")?;
                    if self.isolation.is_none() {
                        argv[0] = placement.cwd.join(&resolved).to_string_lossy().into_owned();
                    }
                }
                argv
            }
        })
    }

    /// The projection's generation store, when the repository has a cache
    /// directory. Each project's projections have their own.
    pub(super) fn generation_store(&self, definition: &Value) -> Option<crate::generation_store::GenerationStore> {
        let base = self.cache_base().ok()?;
        let common = self.common_directory().ok()?;
        let id = definition["id"].as_str()?;
        let project = crate::project::prefix();
        let key = if project.is_empty() {
            id.to_owned()
        } else {
            format!("{project}\0{id}")
        };
        Some(crate::generation_store::GenerationStore::open_in(&base, &common, &key))
    }

    /// Records a validated extraction's generated values in the projection's
    /// generation store. A store that can't be written never fails anything.
    fn harvest(&self, definition: &Value, document: &Value, source: crate::generation_store::Source) {
        if projections_engine::volatility::generated_values(&document["extraction"]).is_empty() {
            return;
        }
        if let Some(store) = self.generation_store(definition) {
            let _ = store.harvest(&document["extraction"], source);
        }
    }

    /// The request for an extractor placed by [`Runner::place`].
    pub(super) fn placed_request(&self, definition: &Value, placement: &Placement) -> Value {
        let revision = self.current.lock().expect("revision lock").clone();
        let mut repository = json!({"mode": placement.mode, "revision": revision, "project": crate::project::prefix()});
        if let Some(root) = &placement.root {
            repository["root"] = json!(root);
        }
        if let Some((directory, tree)) = &placement.git {
            repository["git"] = json!({"directory": directory, "tree": tree});
        }
        if let Some(checkout) = &placement.checkout
            && let Ok(checkout) = projections_extractor_sdk::canonical(checkout)
        {
            repository["checkout"] = json!(checkout);
        }
        if let Some(scope) = effective_scope(definition) {
            repository["scope"] = json!(scope);
        }
        json!({"protocolVersion":0,"projection":{"id":definition["id"],"definition":definition},
            "repository":repository,
            "capabilities":{"trusted":self.trust,"network":definition["execution"]["network"]==true}})
    }

    /// Runs an extractor command on the examined revision `root` with the
    /// definition's project in its revision `program` as its working directory,
    /// exactly as the public extractor protocol describes, and returns its
    /// decoded extraction.
    /// Built-in and custom extractors share this path.
    pub fn run_extractor(&self, definition: &Value, argv: &[String], root: &Path, program: &Path) -> Result<Value> {
        let request = self.extractor_request(definition, root);
        self.run_request_in(definition, argv, request, root, program)
    }

    /// Runs an extractor placed by [`Runner::place`] with its request.
    pub(super) fn run_request(&self, definition: &Value, argv: &[String], request: Value, placement: &Placement) -> Result<Value> {
        let root = placement.root.clone().unwrap_or_else(|| placement.cwd.clone());
        self.run_request_in(definition, argv, request, &root, &placement.cwd)
    }

    fn run_request_in(&self, definition: &Value, argv: &[String], request: Value, root: &Path, program: &Path) -> Result<Value> {
        let names: Vec<String> = definition["execution"]["environment"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .map(|value| value.as_str().map(str::to_owned).context("Invalid environment name"))
                    .collect()
            })
            .transpose()?
            .unwrap_or_default();
        let mut environment = self.environment(&names)?;
        // A custom extractor finds the `projections` Python module; built-ins
        // run their own helpers, beside code that may have a `projections` of its own.
        let python = if definition["extractor"].is_string() {
            None
        } else {
            self.python_module()
        };
        let timeout = definition["execution"]["timeoutMs"].as_u64().unwrap_or(30_000);
        let output = if let Some((engine, image)) = &self.isolation {
            self.run_container(
                engine,
                image,
                ContainerRun {
                    argv,
                    root,
                    program,
                    project: crate::project::prefix(),
                    request: &request,
                    timeout,
                    environment: &environment,
                    selected: &names,
                    python: python.as_deref(),
                },
            )
            .map_err(timeout_advice)?
        } else {
            if let Some(directory) = python.as_deref().and_then(Path::to_str) {
                crate::python::prepend(&mut environment, directory, crate::python::SEPARATOR);
            }
            let directory = crate::project::directory(program);
            self.run_argv(argv, &directory, Some(&serde_json::to_string(&request)?), timeout, &environment)
                .map_err(timeout_advice)?
        };
        self.record_output(
            self.current.lock().expect("revision lock")["ref"].as_str().unwrap_or(""),
            &output.stdout,
            &output.stderr,
        );
        engine("decode", json!({"json":output.stdout}))
    }

    /// The `projections` Python module's directory, unpacked in this runner's
    /// cache. A cache that can't hold it never fails an extraction: the module
    /// is then missing, and an extractor that imports it says so.
    fn python_module(&self) -> Option<PathBuf> {
        crate::python::directory_in(&self.cache_base().ok()?).ok()
    }

    /// The extraction document for extractor output saved in `path` (what an
    /// extractor writes to stdout), as the working tree's definition of `id`
    /// would make it, without running the extractor.
    pub fn supplied(&self, id: &str, path: &Path) -> Result<Value> {
        // The extractor protocol's stdout limit.
        let bytes = artifact::read_artifact(path, 8 * 1024 * 1024)?;
        let text = String::from_utf8(bytes).with_context(|| format!("{} is not UTF-8", path.display()))?;
        let extraction = engine("decode", json!({"json": text}))?;
        self.supplied_documents(id, vec![(extraction, path.to_path_buf())])?.remove(0)
    }

    /// The extraction document for a file to compare or show: a saved
    /// `projections.extraction` document as it is, or, as the working tree's
    /// definition of `id` makes it, extractor output or a saved document whose
    /// extraction was edited by hand (so its digest no longer matches).
    pub fn saved_or_supplied(&self, id: Option<&str>, path: &Path) -> Result<Value> {
        let saved = artifact::read_document(path);
        let Some(id) = id else {
            return saved;
        };
        let Err(error) = saved else {
            return saved;
        };
        let bytes = artifact::read_artifact(path, 64 * 1024 * 1024)?;
        let value = artifact::parse(std::str::from_utf8(&bytes).with_context(|| format!("{} is not UTF-8", path.display()))?)?;
        let edited = value["format"] == "projections.extraction" && format!("{error:#}").contains("Extraction digest mismatch");
        if !edited {
            return match value.get("protocolVersion") {
                Some(_) => self.supplied(id, path),
                None => Err(error),
            };
        }
        let mut extraction = value["extraction"].clone();
        extraction["protocolVersion"] = json!(0);
        let extraction = engine("decode", json!({"json": serde_json::to_string(&extraction)?}))?;
        self.supplied_documents(id, vec![(extraction, path.to_path_buf())])?.remove(0)
    }

    /// Extraction documents for several supplied extractions, each with the
    /// file it came from, made with the working tree's definition of `id`
    /// (captured once). Each fails on its own.
    pub fn supplied_documents(&self, id: &str, extractions: Vec<(Value, PathBuf)>) -> Result<Vec<Result<Value>>> {
        let working = self.capture("working-tree")?;
        let definition = self.definition(&working, id)?;
        let digest = self.definition_digest(&definition, &working)?;
        Ok(extractions
            .into_iter()
            .map(|(extraction, path)| {
                self.extraction_document(&working, &working, &definition, digest.clone(), extraction, Origin::Supplied(&path))
            })
            .collect())
    }

    /// Extracts `examined` with the definition `program` declares.
    pub(super) fn show_from(&self, examined: &Revision, program: &Revision, id: &str) -> Result<Value> {
        let definition = self.definition(program, id)?;
        self.extract(examined, &definition, program)
    }

    /// Extracts one revision. The definition comes from `definition_reference`
    /// when given, so extractions of several revisions can share one definition,
    /// and otherwise from the examined revision itself.
    pub fn show(&self, id: &str, reference: &str, definition_reference: Option<&str>) -> Result<Value> {
        let examined = self.capture(reference)?;
        match definition_reference {
            Some(other) if other != reference => {
                let program = self.capture(other)?;
                self.show_from(&examined, &program, id)
            }
            _ => self.show_from(&examined, &examined, id),
        }
    }
}

/// An extractor that ran past its timeout says which setting gives it longer.
fn timeout_advice(error: anyhow::Error) -> anyhow::Error {
    match error.downcast::<super::ProcessFailure>() {
        Ok(mut failure) if failure.timed_out => {
            failure.message.push_str(&format!(
                ". Give it longer with the definition's execution.timeoutMs (at most {MAX_TIMEOUT_MS}), or read less with execution.scope"
            ));
            failure.into()
        }
        Ok(failure) => failure.into(),
        Err(error) => error,
    }
}

/// The longest `execution.timeoutMs` a definition may set.
const MAX_TIMEOUT_MS: u64 = 300_000;

/// The determinism class that applies to a definition: a custom extractor's
/// declared class (default `environmental`); a built-in's declared class, or a
/// less reproducible one the definition declares.
pub fn determinism(definition: &Value) -> projections_extractor_sdk::Determinism {
    use projections_extractor_sdk::Determinism;
    let declared = definition["execution"]["determinism"].as_str().and_then(Determinism::parse);
    match definition["extractor"]
        .as_str()
        .and_then(|id| collectors::determinism(id, &definition["inputs"]))
    {
        Some(builtin) => declared.map_or(builtin, |declared| declared.max(builtin)),
        None => declared.unwrap_or(Determinism::Environmental),
    }
}

/// The scope that applies to a definition, repository-relative: its own
/// `execution.scope`, else the files a built-in's inputs name, else, in a
/// nested project, the project itself. Its paths are relative to the project;
/// one that resolves to the repository's root means the whole revision (`None`).
pub fn effective_scope(definition: &Value) -> Option<Vec<String>> {
    let paths = definition_scope(definition)
        .or_else(|| {
            let builtin = definition["extractor"].as_str()?;
            let scope = collectors::scope(builtin, &definition["inputs"])?;
            artifact::scope(&json!(scope)).ok().map(|value| {
                value
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|path| path.as_str().map(str::to_owned))
                    .collect()
            })
        })
        .or_else(|| (!crate::project::prefix().is_empty()).then(|| vec![".".to_owned()]))?;
    let mut resolved = Vec::new();
    for path in paths {
        let path = crate::project::resolve(&path).ok()?;
        if path.is_empty() {
            return None;
        }
        resolved.push(path);
    }
    resolved.sort();
    resolved.dedup();
    Some(resolved)
}

/// The scope a definition declares, if any (`execution.scope`), as written:
/// relative to its project.
pub fn definition_scope(definition: &Value) -> Option<Vec<String>> {
    definition["execution"]["scope"]
        .as_array()
        .map(|paths| paths.iter().filter_map(|path| path.as_str().map(str::to_owned)).collect())
}

/// Records a fresh extraction's generated values in the generation store
/// (a stale one is only assessed) and describes them in its provenance.
fn record_generations(store: &crate::generation_store::GenerationStore, placement: &Placement, mut document: Value) -> Result<Value> {
    // A stale extraction is described but not harvested.
    let harvest = if placement.fidelity == "stale" {
        store.assess(&document["extraction"])
    } else {
        store
            .harvest(&document["extraction"], crate::generation_store::Source::Local)
            .unwrap_or_else(|_| store.assess(&document["extraction"]))
    };
    if let Some(generated) = harvest.provenance() {
        document["provenance"]["generated"] = generated;
        document = artifact::validate_extraction(&document)?;
    }
    Ok(document)
}
