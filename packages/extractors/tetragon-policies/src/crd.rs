//! Validation against the repository's own copy of the policy CRDs: the
//! structural OpenAPI schema Kubernetes enforces, without the CEL rules
//! (`x-kubernetes-validations`), which are reported as not evaluated.

mod schema;

use anyhow::{Result, bail};
use projections_extractor_sdk::{parse_yaml_documents, read_source};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

/// Schemas by (kind, apiVersion), such as (`TracingPolicy`, `cilium.io/v1alpha1`).
pub struct Crds {
    schemas: BTreeMap<(String, String), Value>,
    pub paths: Vec<String>,
}

impl Crds {
    pub fn read(root: &Path, paths: &[String], kinds: &[&str]) -> Result<Self> {
        let mut schemas = BTreeMap::new();
        for path in paths {
            let documents = parse_yaml_documents(&read_source(root, path)?, path)?;
            let listed = documents.iter().flat_map(|document| match document["items"].as_array() {
                Some(items) if document["kind"].as_str().is_some_and(|kind| kind.ends_with("List")) => items.iter().collect(),
                _ => vec![document],
            });
            for document in listed {
                if document["kind"] != "CustomResourceDefinition" {
                    continue;
                }
                let group = document["spec"]["group"].as_str().unwrap_or_default();
                let kind = document["spec"]["names"]["kind"].as_str().unwrap_or_default();
                if !kinds.contains(&kind) {
                    continue;
                }
                for version in document["spec"]["versions"].as_array().into_iter().flatten() {
                    let (Some(name), Some(schema)) = (version["name"].as_str(), version["schema"].get("openAPIV3Schema")) else {
                        continue;
                    };
                    if version["served"] == false {
                        continue;
                    }
                    schemas.insert((kind.to_owned(), format!("{group}/{name}")), schema.clone());
                }
            }
        }
        if schemas.is_empty() {
            bail!("inputs.crdPath names no CustomResourceDefinition for {}", kinds.join(" or "));
        }
        Ok(Self {
            schemas,
            paths: paths.to_vec(),
        })
    }

    /// Every way `document` violates its CRD, as `path: problem` sentences.
    pub fn violations(&self, document: &Value) -> Vec<String> {
        let kind = document["kind"].as_str().unwrap_or_default();
        let api = document["apiVersion"].as_str().unwrap_or_default();
        let Some(schema) = self.schemas.get(&(kind.to_owned(), api.to_owned())) else {
            return vec![format!("The repository's CRDs don't define {kind} in {api}.")];
        };
        schema::violations(schema, document)
    }
}
