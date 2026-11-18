//! What identifies an extraction for the persistent cache, scope
//! verification and reusing cached or CI extractions.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::{Runner, determinism, document::Origin, effective_scope, placement::Placement, revision::Revision, utc_now};
use crate::{artifact, collectors};

impl Runner {
    /// A parity check: projection `id` at the commit `reference` (with that
    /// commit's definition) extracted here, without the cache or artifacts, and
    /// CI's extraction of the same commit and definition from the configured
    /// artifacts; `None` when no artifact has it. Different digests mean the
    /// local environment drifted from CI's.
    pub fn parity(&self, id: &str, reference: &str) -> Result<Option<(Value, Value)>> {
        let revision = self.capture(reference)?;
        ensure!(
            revision.is_commit(),
            "A parity check compares a commit with CI's artifact; name a commit, not the working tree"
        );
        let definition = self.definition(&revision, id)?;
        self.require_trust(&definition)?;
        let digest = self.definition_digest(&definition, &revision)?;
        let commit = revision.repository["commit"].as_str().unwrap_or_default();
        let Some(ci) = self.artifacts.find(self, commit, id, &digest)? else {
            return Ok(None);
        };
        let extracted = self.uncached().extract(&revision, &definition, &revision)?;
        Ok(Some((extracted, ci)))
    }

    /// The working tree's current identity for projection `id`, which a result
    /// of it can be compared with to tell whether it is out of date:
    /// `{"tree", "definitionDigest"}`. It runs nothing.
    pub fn working_identity(&self, id: &str) -> Result<Value> {
        let revision = self.capture("working-tree")?;
        let definition = self.definition(&revision, id)?;
        let digest = self.definition_digest(&definition, &revision)?;
        let mut identity = json!({"tree": self.identity(&revision)?, "definitionDigest": digest});
        if let Some(scope) = effective_scope(&definition) {
            let files_only = definition["extractor"]
                .as_str()
                .is_some_and(|id| collectors::reads_files_only(id, &definition["inputs"]));
            identity["scope"] = json!(scope);
            identity["scopedTree"] = json!(self.scoped_tree(&revision, &scope)?);
            identity["scopeVerified"] = json!(files_only || self.scope_verified(&definition, &digest)?);
        }
        Ok(identity)
    }

    /// A revision's Git tree: a commit's, or the working tree's identity, taken
    /// once per located revision.
    pub(super) fn identity(&self, revision: &Revision) -> Result<String> {
        if let Some(tree) = &revision.tree {
            return Ok(tree.clone());
        }
        if let Some(identity) = revision.identity.get() {
            return Ok(identity.clone());
        }
        let identity = self.working_tree()?;
        let _ = revision.identity.set(identity.clone());
        Ok(identity)
    }

    /// The persistent cache key of an extraction: the definition digest (and
    /// a nested definition's project), the examined tree (and the definition revision's, when it differs), the
    /// access mode and the environment the extractor receives.
    pub(super) fn cache_key(
        &self,
        examined: &Revision,
        program: &Revision,
        definition: &Value,
        digest: &str,
        files_only: bool,
    ) -> Result<String> {
        // A pure extraction is a function of the files; an environmental one
        // also of the environment it ran in.
        let environment = match determinism(definition) {
            projections_extractor_sdk::Determinism::Pure => None,
            _ => Some(json!([self.fingerprint(definition)?, self.dependencies(examined, files_only)?])),
        };
        // A custom program from another revision may read files it doesn't declare.
        let program_tree = if program.repository == examined.repository || definition["extractor"].is_string() {
            None
        } else {
            Some(self.identity(program)?)
        };
        let mut key = json!({
            "version": 1,
            "projections": env!("CARGO_PKG_VERSION"),
            "definitionDigest": digest,
            "tree": self.keyed_tree(examined, definition, digest, files_only)?,
            "program": program_tree,
            "access": if files_only { "files" } else { "checkout" },
            "environment": environment,
            "isolation": self.isolation.as_ref().map(|(engine, image)| format!("{engine} {image}")),
        });
        // The digest covers the project too; a nested project's key names it as well.
        if !crate::project::prefix().is_empty() {
            key["project"] = json!(crate::project::prefix());
        }
        Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(&key)?)))
    }

    /// What a toolchain extraction of `examined` would use as dependencies, for
    /// the cache key: the prepare steps' keys at a commit when they run
    /// (trusted), else the working tree's lockfiles it borrows.
    pub(super) fn dependencies(&self, examined: &Revision, files_only: bool) -> Result<Value> {
        if files_only || !examined.is_commit() {
            return Ok(Value::Null);
        }
        if let Some(environment) = self.environment_of(examined)?
            && !environment.prepare.is_empty()
            && self.trust
        {
            return Ok(json!({"prepared": self.prepare_keys(examined, &environment)?}));
        }
        let root = self.repository_root()?;
        let lockfiles = self.working_lockfiles()?;
        let ids = crate::environment::blobs(self, &root, &lockfiles.iter().collect::<Vec<_>>())?;
        Ok(json!({"borrowed": ids}))
    }

    /// The tree an extraction is keyed by: the scope's subtrees when the scope
    /// is enforced (a built-in reading files through the SDK) or `check`
    /// verified it, so an edit outside it is a hit; otherwise the whole tree.
    fn keyed_tree(&self, examined: &Revision, definition: &Value, digest: &str, files_only: bool) -> Result<String> {
        if let Some(scope) = effective_scope(definition)
            && (files_only || self.scope_verified(definition, digest)?)
        {
            return self.scoped_tree(examined, &scope);
        }
        self.identity(examined)
    }

    /// A revision's scope identity: each scope path's Git object in its tree
    /// (or its absence), hashed.
    fn scoped_tree(&self, revision: &Revision, scope: &[String]) -> Result<String> {
        let tree = self.identity(revision)?;
        let root = self.repository_root()?;
        let mut hasher = Sha256::new();
        for path in scope {
            let object = self
                .git_text(&root, &["rev-parse", "--verify", "--quiet", &format!("{tree}:{path}")])
                .unwrap_or_else(|_| "absent".into());
            hasher.update(path.as_bytes());
            hasher.update(b"=");
            hasher.update(object.as_bytes());
            hasher.update(b"\0");
        }
        Ok(format!("sha256:{:x}", hasher.finalize()))
    }

    /// Where verified scopes are recorded: definition digest → scope.
    fn scopes_file(&self) -> Result<PathBuf> {
        Ok(self.cache_base()?.join("scopes").join(format!(
            "{}.json",
            crate::extraction_cache::repository_name(&self.common_directory()?)
        )))
    }

    /// Whether `projections check` verified this definition's scope: a run
    /// limited to the scope matched a full one.
    fn scope_verified(&self, definition: &Value, digest: &str) -> Result<bool> {
        let Some(scope) = effective_scope(definition) else {
            return Ok(false);
        };
        let recorded: Value = fs::read(self.scopes_file()?)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(Value::Null);
        Ok(recorded[digest]["scope"] == json!(scope))
    }

    /// Verifies projection `id`'s scope in the working tree: extracts it in
    /// full and again from a copy holding only the scope. Extractions that agree
    /// up to their declared volatile fields
    /// record the scope as verified (cache keys may then use it); otherwise
    /// returns how they differ. `None` when the projection declares no scope.
    pub fn verify_scope(&self, id: &str) -> Result<Option<(Vec<String>, crate::determinism::Variation)>> {
        let working = self.capture("working-tree")?;
        let definition = self.definition(&working, id)?;
        let Some(scope) = effective_scope(&definition) else {
            return Ok(None);
        };
        self.require_trust(&definition)?;
        let runner = self.uncached();
        let full = runner.extract(&working, &definition, &working)?;
        // Only the scope, materialized; the definition's program from the working tree.
        let copy = self.materialize_paths("working-tree", Some(&scope))?;
        // The upstream built-ins read the same scoped copy.
        let upstream = runner.upstream(&copy, &definition, &working)?;
        let digest = self.definition_digest(&definition, &working)?;
        let key = digest.clone();
        *self.current.lock().expect("revision lock") = working.repository.clone();
        let repository = self.repository_root()?;
        let placement = Placement {
            mode: "materialized",
            root: Some(copy.root().to_path_buf()),
            cwd: repository.clone(),
            checkout: Some(repository),
            git: None,
            source: "local-materialized",
            strategy: Some("sparse"),
            fidelity: "exact",
            tree: None,
            limitations: vec!["Extracted from the scope alone, to verify it.".into()],
            check: None,
            prepared: Vec::new(),
            _lease: None,
            _scratch: Vec::new(),
            _held: Vec::new(),
        };
        let argv = self.extractor_argv(&definition, &working, &placement)?;
        let mut request = self.placed_request(&definition, &placement);
        if let Some(upstream) = upstream {
            request["upstream"] = upstream;
        }
        let extraction = self.run_request(&definition, &argv, request, &placement)?;
        let scoped = self.extraction_document(&copy, &working, &definition, digest, extraction, Origin::Ran(&placement))?;
        let variation = crate::determinism::variation(&full, &scoped)?;
        if variation.reproducible() {
            let file = self.scopes_file()?;
            crate::cache::private_directory(file.parent().context("scopes directory")?)?;
            let mut recorded: Value = fs::read(&file)
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                .filter(Value::is_object)
                .unwrap_or_else(|| json!({}));
            recorded[&key] = json!({"scope": scope, "at": utc_now()});
            fs::write(&file, crate::json_text::pretty(&recorded)?)?;
        }
        Ok(Some((scope, variation)))
    }

    /// The environment an extractor of `definition` runs in, as a `sha256:`
    /// fingerprint: this Projections version, `PATH` and the granted
    /// variables' values (hashed, never stored).
    pub(super) fn fingerprint(&self, definition: &Value) -> Result<String> {
        let mut hasher = Sha256::new();
        hasher.update(env!("CARGO_PKG_VERSION").as_bytes());
        hasher.update(b"\0");
        hasher.update(self.toolchain_identity().as_bytes());
        hasher.update(b"\0");
        let names: Vec<String> = definition["execution"]["environment"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|name| name.as_str().map(str::to_owned))
            .collect();
        for (name, value) in self.environment(&names)? {
            hasher.update(name.as_bytes());
            hasher.update(b"=");
            hasher.update(value.as_bytes());
            hasher.update(b"\0");
        }
        Ok(format!("sha256:{:x}", hasher.finalize()))
    }

    /// The cached extraction under `key`, revalidated and given this run's
    /// revision and definition (which may differ in presentation only).
    pub(super) fn cached(&self, key: &str, examined: &Revision, definition: &Value, digest: &str) -> Option<Value> {
        let cache = self.cache.as_ref()?;
        let mut document = cache.get(key)?;
        // CI's extractions (cached by earlier versions) come from artifacts,
        // under the current artifact policy, never from this cache.
        if document["provenance"]["definitionDigest"] != digest
            || document["projection"]["id"] != definition["id"]
            || document["provenance"]["execution"]["source"] == "ci"
        {
            return None;
        }
        // An entry that names a host directory is refused as a fresh run would be.
        let serialized = serde_json::to_string(&document["extraction"]).ok()?;
        self.ensure_portable(&serialized, examined.directory()).ok()?;
        Self::restamp(&mut document, examined, definition);
        let document = artifact::validate_extraction(&document).ok()?;
        self.cache_hits.fetch_add(1, Ordering::SeqCst);
        Some(document)
    }

    /// Fails when `serialized` names one of this run's host directories: the
    /// examined revision's, the definition's, the checkout dependencies are
    /// borrowed from, or the repository's (as given and canonical). The same
    /// set applies whatever the command and the definition revision, so `show`,
    /// `compare` and `check` accept or refuse one extraction alike; a path that
    /// escapes the root (`../../Users/…`) names one too.
    pub(super) fn ensure_portable<'p>(&self, serialized: &str, roots: impl IntoIterator<Item = &'p Path>) -> Result<()> {
        if self.isolation.is_some() {
            ensure!(
                !serialized.contains("/repository"),
                "Extractor emitted a host directory (/repository); extractions use repository-relative paths"
            );
            return Ok(());
        }
        let mut paths: Vec<PathBuf> = roots.into_iter().map(Path::to_path_buf).collect();
        paths.push(self.repo.clone());
        paths.extend(self.repository_root().ok());
        let canonical: Vec<PathBuf> = paths
            .iter()
            .filter_map(|path| projections_extractor_sdk::canonical(path).ok())
            .collect();
        paths.extend(canonical);
        for path in paths {
            let root = path.to_str().context("NonUTF8 revision root")?;
            // The filesystem root (`/`) is a prefix of every path, never a leak.
            if Path::new(root).parent().is_none() {
                continue;
            }
            ensure!(
                !serialized.contains(root),
                "Extractor emitted a host directory ({root}); extractions use repository-relative paths"
            );
        }
        Ok(())
    }

    /// Gives a reused extraction this run's revision record and definition.
    pub(super) fn restamp(document: &mut Value, examined: &Revision, definition: &Value) {
        let id = definition["id"].as_str().unwrap_or_default();
        document["provenance"]["revision"] = examined.repository.clone();
        document["provenance"]["definition"] = definition.clone();
        document["projection"] = json!({"id": id,
            "title": definition["title"].as_str().unwrap_or(id), "renderer": definition["renderer"]});
    }
}
