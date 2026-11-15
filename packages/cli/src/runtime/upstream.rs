//! Upstream extractions: the built-in extractions a custom extractor's
//! `extractor.upstream` asks for, extracted from the same revision first and
//! passed in its request.

use anyhow::{Context, Result, ensure};
use serde_json::{Map, Value, json};

use super::{Runner, revision::Revision};

impl Runner {
    /// The normalized extractions `definition`'s `extractor.upstream` names, of
    /// `examined`, keyed by their names; `None` when it names none. Each is an
    /// ordinary built-in extraction (`<id>.<name>`), so it is trust-gated,
    /// supervised and cached like any other.
    pub(super) fn upstream(&self, examined: &Revision, definition: &Value, program: &Revision) -> Result<Option<Value>> {
        let Some(entries) = definition["extractor"]["upstream"].as_object() else {
            return Ok(None);
        };
        ensure!(
            self.isolation.is_none(),
            "Container mode runs repository-owned executables only, so extractor.upstream, which names built-in extractors, isn't available in it"
        );
        let mut extractions = Map::new();
        for (name, entry) in entries {
            let upstream = upstream_definition(definition, name, entry)?;
            let document = self.extract(examined, &upstream, program).with_context(|| {
                format!(
                    "The upstream extraction {name} ({}) failed",
                    upstream["extractor"].as_str().unwrap_or_default()
                )
            })?;
            extractions.insert(name.clone(), document["extraction"].clone());
        }
        // The nested extractions set the current revision to the same one.
        *self.current.lock().expect("revision lock") = examined.repository.clone();
        Ok(Some(Value::Object(extractions)))
    }
}

/// The definition an upstream built-in runs with: its extractor and inputs, and
/// the downstream definition's scope and timeout, so it reads no more than the
/// command may and fails within the same time.
fn upstream_definition(definition: &Value, name: &str, entry: &Value) -> Result<Value> {
    let extractor = entry["extractor"]
        .as_str()
        .context("extractor.upstream entries name a built-in extractor")?;
    let renderer = projections_extractor_catalog::renderer(extractor)
        .with_context(|| format!("No built-in extractor is registered for {extractor}"))?;
    let mut upstream = json!({
        "id": format!("{}.{name}", definition["id"].as_str().unwrap_or_default()),
        "extractor": extractor,
        "renderer": renderer,
    });
    if let Some(inputs) = entry.get("inputs") {
        upstream["inputs"] = inputs.clone();
    }
    let mut execution = Map::new();
    for key in ["scope", "timeoutMs"] {
        if let Some(value) = definition["execution"].get(key) {
            execution.insert(key.to_owned(), value.clone());
        }
    }
    if !execution.is_empty() {
        upstream["execution"] = Value::Object(execution);
    }
    Ok(upstream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_upstream_built_in_runs_with_its_own_inputs_and_the_downstream_scope_and_timeout() {
        let definition = json!({
            "id": "topology", "renderer": "graph",
            "extractor": {"command": ["node", "x.mjs"]},
            "execution": {"scope": ["crates"], "timeoutMs": 60000, "network": true, "environment": ["HOME"]},
        });
        let upstream = upstream_definition(
            &definition,
            "crates",
            &json!({"extractor": "cargo-dependencies", "inputs": {"a": 1}}),
        )
        .unwrap();
        assert_eq!(
            upstream,
            json!({
                "id": "topology.crates", "extractor": "cargo-dependencies", "renderer": "dependencies",
                "inputs": {"a": 1}, "execution": {"scope": ["crates"], "timeoutMs": 60000},
            })
        );
        let bare = upstream_definition(&json!({"id": "t"}), "npm", &json!({"extractor": "workspace-dependencies"})).unwrap();
        assert!(bare.get("execution").is_none() && bare.get("inputs").is_none());
    }
}
