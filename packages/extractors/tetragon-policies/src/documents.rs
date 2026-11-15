//! Policy resources in each source's YAML documents, added to the model with
//! the line and text that locate their evidence.

use crate::crd::Crds;
use crate::policy;
use crate::sources::Source;
use anyhow::{Context as _, Result, bail};
use projections_extractor_sdk::parse_yaml_documents;
use serde_json::Value;

/// Each YAML document's text and first line, found by its `---` separators.
/// Used only to locate evidence; `None` when the split disagrees with the parser.
fn document_texts(text: &str, count: usize) -> Vec<Option<(usize, String)>> {
    let mut documents: Vec<(usize, String)> = vec![(1, String::new())];
    for (index, line) in text.lines().enumerate() {
        if line.starts_with("---") {
            documents.push((index + 2, String::new()));
        } else {
            documents.last_mut().unwrap().1.push_str(line);
            documents.last_mut().unwrap().1.push('\n');
        }
    }
    if documents.len() > 1 && documents[0].1.trim().is_empty() {
        documents.remove(0);
    }
    if documents.len() == count {
        documents.into_iter().map(Some).collect()
    } else {
        vec![None; count]
    }
}

fn policies(value: &Value) -> Vec<&Value> {
    let kind = value["kind"].as_str().unwrap_or_default();
    let api = value["apiVersion"].as_str().unwrap_or_default();
    if kind.ends_with("List") {
        return value["items"]
            .as_array()
            .map(|items| items.iter().flat_map(policies).collect())
            .unwrap_or_default();
    }
    if api.starts_with("cilium.io/") && (kind == "TracingPolicy" || kind == "TracingPolicyNamespaced") {
        vec![value]
    } else {
        vec![]
    }
}

/// Adds every policy in `sources` to the model; the labels of the sources that had any.
pub(crate) fn read(model: &mut policy::Model, sources: &[Source], crds: Option<&Crds>, namespace: Option<&str>) -> Result<Vec<String>> {
    let mut read = vec![];
    for source in sources {
        let documents = match parse_yaml_documents(&source.text, &source.label) {
            Ok(documents) => documents,
            Err(error) if source.text.contains("{{") => {
                bail!(
                    "{:#}. {} looks like a template; render it with helm template or kustomize build in CI and set inputs.renderedManifestsPath",
                    error,
                    source.label
                )
            }
            Err(error) => return Err(error),
        };
        let texts = document_texts(&source.text, documents.len());
        let mut found = false;
        for (value, located) in documents.iter().zip(&texts) {
            for value in policies(value) {
                found = true;
                let (line, text) = match located {
                    Some((line, text)) => (Some(*line), text.as_str()),
                    None => (None, ""),
                };
                policy::add(
                    model,
                    &policy::Document {
                        value,
                        source: &source.label,
                        line,
                        text,
                        templated: text.contains("${"),
                        invalid: crds.as_ref().map(|crds| crds.violations(value)).unwrap_or_default(),
                    },
                    namespace,
                )
                .with_context(|| format!("In {}", source.label))?;
            }
        }
        if found {
            read.push(source.label.clone());
        }
    }
    Ok(read)
}
