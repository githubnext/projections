//! Whether a custom extractor reads the examined revision only through
//! `request.repository.root`, as the extractor contract requires.
//!
//! Its working directory is the definition's project in the revision that
//! supplied the definition. In a comparison that is one revision for both
//! sides, so a file the extractor reads relative to its working directory (or
//! its own location) comes from that revision on every side, and the
//! comparison shows no change in it.

use anyhow::Result;
use serde_json::Value;

use super::{Runner, document::Origin, placement::Placement, placement::program_paths};

impl Runner {
    /// Extracts the working tree again with projection `id`'s custom extractor
    /// run from a copy holding only the definition's own files (its definition
    /// directories, declared sources and command paths), the examined revision
    /// still at `repository.root`, and measures how that differs from `first`,
    /// the working tree's extraction. `None` for a built-in extractor (which
    /// reads through the SDK), an `observed` one or under container isolation;
    /// otherwise the definition's own files the copy held, and the difference,
    /// or why the run from the copy failed.
    pub fn verify_own_files(&self, id: &str, first: &Value) -> Result<Option<(Vec<String>, Result<crate::determinism::Variation>)>> {
        let working = self.capture("working-tree")?;
        let definition = self.definition(&working, id)?;
        if definition["extractor"].is_string()
            || self.isolation.is_some()
            || super::determinism(&definition) == projections_extractor_sdk::Determinism::Observed
        {
            return Ok(None);
        }
        self.require_trust(&definition)?;
        let runner = self.uncached();
        let paths = program_paths(&definition);
        let own = self.materialize_paths("working-tree", Some(&paths))?;
        let own_files = paths.into_iter().filter(|path| own.root().join(path).exists()).collect();
        let upstream = runner.upstream(&working, &definition, &working)?;
        let digest = self.definition_digest(&definition, &working)?;
        *self.current.lock().expect("revision lock") = working.repository.clone();
        let repository = self.repository_root()?;
        let placement = Placement {
            mode: "in-place",
            root: Some(repository.clone()),
            cwd: own.root().to_path_buf(),
            checkout: Some(repository),
            git: None,
            source: "local-in-place",
            strategy: None,
            fidelity: "exact",
            tree: None,
            limitations: vec![
                "Run from a copy of the definition's own files, to verify that it reads the revision through repository.root.".into(),
            ],
            check: None,
            prepared: Vec::new(),
            _lease: None,
            _scratch: Vec::new(),
            _held: Vec::new(),
        };
        let probed = (|| {
            let argv = self.extractor_argv(&definition, &own, &placement)?;
            let mut request = self.placed_request(&definition, &placement);
            if let Some(upstream) = upstream {
                request["upstream"] = upstream;
            }
            let extraction = self.run_request(&definition, &argv, request, &placement)?;
            let probed = self.extraction_document(&working, &own, &definition, digest, extraction, Origin::Ran(&placement))?;
            crate::determinism::variation(first, &probed)
        })();
        Ok(Some((own_files, probed)))
    }
}
