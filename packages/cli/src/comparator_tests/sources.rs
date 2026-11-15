//! A case's extractions: inline, from a fixture file, or extracted from a
//! revision with the projection's working-tree definition.

use super::{Context, MAX_FIXTURE_BYTES, paths::inside};
use crate::runtime::{TrustRequired, read_regular};
use anyhow::{Context as _, Result, bail};
use projections_rules_yaml::suite::Source;
use serde_json::Value;
use std::{collections::HashMap, path::PathBuf};

fn engine_error(failure: projections_engine::Failure) -> anyhow::Error {
    anyhow::anyhow!(
        "{}",
        failure
            .iter()
            .map(|diagnostic| {
                if diagnostic.path.is_empty() {
                    diagnostic.message.clone()
                } else {
                    format!("{}: {}", diagnostic.path, diagnostic.message)
                }
            })
            .collect::<Vec<_>>()
            .join("; ")
    )
}

/// An extraction as the Engine normalizes it, from a bare extraction or a
/// `projections.extraction` document.
fn extraction(value: &Value) -> Result<Value> {
    let extraction = if value["format"] == "projections.extraction" {
        &value["extraction"]
    } else {
        value
    };
    projections_engine::normalize(extraction, "").map_err(engine_error)
}

/// Why a case was skipped rather than run.
pub(super) struct Skipped(String);

impl std::fmt::Display for Skipped {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::fmt::Debug for Skipped {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for Skipped {}

pub(super) struct Run<'a> {
    pub(super) context: &'a Context<'a>,
    pub(super) tests: PathBuf,
    /// Extractions by revision, made once per file.
    pub(super) revisions: HashMap<String, Result<Value, (bool, String)>>,
}

impl Run<'_> {
    pub(super) fn source(&mut self, source: &Source) -> Result<Value> {
        match source {
            Source::Extraction(value) => extraction(value),
            Source::File(name) => {
                let path = inside(self.context.root, &self.tests, name)?;
                let bytes = read_regular(&path, MAX_FIXTURE_BYTES).with_context(|| format!("Cannot read the fixture {name}"))?;
                let text = String::from_utf8(bytes).with_context(|| format!("The fixture {name} is not UTF-8"))?;
                let value = projections_engine::parse_json(&text)
                    .map_err(engine_error)
                    .with_context(|| format!("The fixture {name} is not JSON"))?;
                extraction(&value).with_context(|| format!("The fixture {name} is not a valid extraction"))
            }
            Source::Revision(revision) => {
                let (Some(definition), Some(runner)) = (self.context.projection, self.context.runner) else {
                    return Err(Skipped(
                        "No projection uses this comparator here, so a revision can't be extracted; projections check -p <id> runs revision cases for a projection that uses them".into(),
                    )
                    .into());
                };
                let id = definition["id"].as_str().unwrap_or_default();
                let extracted = self.revisions.entry(revision.clone()).or_insert_with(|| {
                    runner
                        .show(id, revision, Some("working-tree"))
                        .map(|document| document["extraction"].clone())
                        .map_err(|error| {
                            if error.chain().any(|cause| cause.is::<TrustRequired>()) {
                                (true, format!("Extracting {revision} runs repository code ({id}'s extractor); trust the repository (--trust) to run this case"))
                            } else {
                                (false, format!("Cannot extract {revision} with the working tree's definition of {id}: {error:#}"))
                            }
                        })
                });
                match extracted {
                    Ok(value) => Ok(value.clone()),
                    Err((true, message)) => Err(Skipped(message.clone()).into()),
                    Err((false, message)) => bail!("{message}"),
                }
            }
        }
    }
}
