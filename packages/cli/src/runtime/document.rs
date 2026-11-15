//! Extraction documents: an extractor's output normalized, with the
//! definition's correspondence applied, digested, and with provenance saying
//! where and how it ran.

use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};

use super::{
    Runner,
    extract::{determinism, effective_scope},
    placement::Placement,
    revision::Revision,
    utc_now,
};
use crate::{artifact, engine};

/// Where an extraction document's extraction came from.
pub(super) enum Origin<'a> {
    /// An extractor the runner ran.
    Ran(&'a Placement),
    /// Extractor output supplied in a file; nothing ran.
    Supplied(&'a Path),
}

impl Runner {
    /// The validated `projections.extraction` document for an extractor's
    /// decoded output: normalized, with the definition's correspondence
    /// applied, digested and with provenance. `supplied` names the file the
    /// output came from when no extractor ran.
    pub(super) fn extraction_document(
        &self,
        examined: &Revision,
        program: &Revision,
        definition: &Value,
        definition_digest: String,
        extraction: Value,
        origin: Origin<'_>,
    ) -> Result<Value> {
        let (supplied, placement) = match origin {
            Origin::Ran(placement) => (None, Some(placement)),
            Origin::Supplied(path) => (Some(path), None),
        };
        let id = definition["id"].as_str().context("Missing projection ID")?;
        let mut extraction = engine("normalize", json!({"extraction":extraction}))?;
        if let Some(aliases) = definition["correspondence"].as_object() {
            apply_correspondence(&mut extraction, aliases)?;
            extraction = engine("normalize", json!({"extraction":extraction}))?;
        }
        let digest = engine("canonicalize", json!({"extraction":extraction}))?["digest"].clone();
        let serialized = serde_json::to_string(&extraction)?;
        let roots: Vec<&Path> = match placement {
            Some(placement) => placement
                .root
                .iter()
                .chain([&placement.cwd])
                .chain(&placement.checkout)
                .map(PathBuf::as_path)
                .collect(),
            None => [examined.directory(), program.directory()].into_iter().flatten().collect(),
        };
        self.ensure_portable(&serialized, roots)?;
        let mut limitations = vec![json!(if self.isolation.is_some() {
            "Explicit immutable container isolation: read-only revision/root, no network, dropped capabilities and bounded resources. The container engine remains a trusted host dependency."
        } else {
            "Local execution is not a sandbox; network and reproducibility declarations are descriptive, not enforcement."
        })];
        limitations.push(json!("External toolchains are not installed or pinned automatically."));
        if let Some(placement) = placement {
            limitations.extend(placement.limitations.iter().map(|text| json!(text)));
        }
        let mut document = json!({"format":"projections.extraction","version":0,
            "projection":{"id":id,"title":definition["title"].as_str().unwrap_or(id),"renderer":definition["renderer"]},
            "extraction":extraction,"digest":digest,"provenance":{"revision":examined.repository,
            "extractor":{"id":artifact::extractor_id(definition),"version":if definition["extractor"].is_string() {"1"} else {"unversioned"}},
            "definition":definition,"definitionDigest":definition_digest,
            "reproducibility":if self.isolation.is_some(){"pinned-toolchain"}else{"local"},
            "toolchain":if let Some((engine,image))=&self.isolation{json!({"containerEngine":engine,"containerImage":image})}else{json!({"projections":env!("CARGO_PKG_VERSION")})},
            "limitations":limitations}});
        if let Some(placement) = placement {
            document["provenance"]["execution"] = self.execution(definition, placement)?;
        }
        if let Some(path) = supplied {
            document["provenance"]["reproducibility"] = json!("unknown");
            document["provenance"]["limitations"] = json!([format!(
                "Supplied as extractor output in {}; no extractor ran, so the revision names only the definition's.",
                path.display()
            )]);
        }
        if let Some(limitation) = examined.skipped_limitation(super::effective_scope(definition).as_deref()) {
            document["provenance"]["limitations"]
                .as_array_mut()
                .expect("limitations")
                .push(json!(limitation));
        }
        artifact::validate_extraction(&document)
    }

    /// Where and how the extractor ran (`provenance.execution`).
    fn execution(&self, definition: &Value, placement: &Placement) -> Result<Value> {
        let mut execution = json!({"source": placement.source, "fidelity": placement.fidelity,
            "determinism": determinism(definition).as_str(),
            "environment": self.fingerprint(definition)?, "at": utc_now()});
        if let Some(tree) = &placement.tree {
            execution["tree"] = json!(tree);
        }
        if let Some(strategy) = placement.strategy {
            execution["strategy"] = json!(strategy);
        }
        if !placement.prepared.is_empty() {
            execution["prepared"] = json!(placement.prepared);
        }
        if let Some(scope) = effective_scope(definition) {
            execution["scope"] = json!(scope);
        }
        Ok(execution)
    }
}

/// Sets each aliased item's `previousIds` from the definition's
/// correspondence, which must name only items the extraction has.
fn apply_correspondence(extraction: &mut Value, aliases: &serde_json::Map<String, Value>) -> Result<()> {
    let mut matched = BTreeSet::new();
    for collection in ["entities", "relationships"] {
        for item in extraction[collection].as_array_mut().context("Invalid extraction items")? {
            let item_id = item["id"].as_str().context("Missing item ID")?.to_owned();
            if let Some(previous) = aliases.get(&item_id) {
                ensure!(
                    item.get("previousIds").is_none() || item["previousIds"] == *previous,
                    "Conflicting correspondence"
                );
                item["previousIds"] = previous.clone();
                matched.insert(item_id);
            }
        }
    }
    ensure!(matched.len() == aliases.len(), "Correspondence references absent entity");
    Ok(())
}
