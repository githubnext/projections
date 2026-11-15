//! The job graph a GitHub Actions workflow declares: its jobs and their `needs`.

use anyhow::{Result, bail, ensure};
use projections_extractor_sdk::{Context, Descriptor, Trust, extraction, input, key, object, parse_yaml, relationship, strings};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub const ID: &str = "github-actions-jobs";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "GitHub Actions jobs",
        description: "Jobs and needs declared by a GitHub Actions workflow",
        schema: "dag/v0",
        renderer: "dag",
        trust: Trust::None,
        access: projections_extractor_sdk::Access::Files,
        determinism: projections_extractor_sdk::Determinism::Pure,
        inputs: json!({"workflowPath":"GitHub Actions workflow path"}),
        template_inputs: Some(json!({"workflowPath":".github/workflows/ci.yml"})),
        detects: &[".github/workflows/*.yml", ".github/workflows/*.yaml"],
    }
}

pub fn requires_trust(_inputs: &Value) -> bool {
    false
}

pub fn collect(cx: &Context) -> Result<Value> {
    let definition = cx.definition();
    let path = input(definition, "workflowPath", None)?;
    let metadata = json!({
        "source":"GitHub Actions workflow declaration","workflow":path,
        "limitations":["Declaration graph only: matrix expansion, reusable workflows, expressions, conditions and runtime scheduling are not evaluated."]
    });
    // A revision without the workflow (before it was added) has no jobs.
    if !cx.input_exists(path)? {
        return Ok(extraction("dag/v0", vec![], vec![], Some(metadata)));
    }
    let yaml = cx.read_source(path)?;
    let workflow = parse_yaml(&yaml, path)?;
    let jobs = object(&workflow["jobs"], "workflow.jobs")?;
    ensure!(!jobs.is_empty(), "Workflow {path} declares no jobs");
    let mut needs = BTreeMap::new();
    for (id, job) in jobs {
        object(job, &format!("jobs.{id}"))?;
        let declared = match job.get("needs") {
            None => vec![],
            Some(Value::String(s)) => vec![s.clone()],
            Some(v) => strings(v, &format!("jobs.{id}.needs"))?,
        };
        for dependency in &declared {
            ensure!(
                !dependency.contains("${{"),
                "jobs.{id}.needs uses an expression, which a declared job graph cannot represent"
            );
            ensure!(
                jobs.contains_key(dependency),
                "jobs.{id}.needs names {dependency}, which the workflow does not declare"
            );
        }
        needs.insert(id.as_str(), declared);
    }
    if let Some(cycle) = cycle(&needs) {
        bail!("Workflow jobs form a needs cycle: {}", cycle.join(" → "));
    }
    let evidence = json!([{"kind":"github-actions-workflow","source":path}]);
    let mut entities = vec![];
    let mut relationships = vec![];
    for (id, job) in jobs {
        let name = job.get("name").and_then(Value::as_str).unwrap_or(id);
        entities.push(json!({"id":key(&["job",id]),"kind":"job","label":name,"confidence":"authoritative","evidence":evidence}));
        for dependency in &needs[id.as_str()] {
            let mut edge = relationship("precedes", &key(&["job", dependency]), &key(&["job", id]));
            edge["evidence"] = evidence.clone();
            relationships.push(edge);
        }
    }
    let mut seen = BTreeSet::new();
    relationships.retain(|edge| seen.insert(edge["id"].as_str().unwrap().to_owned()));
    Ok(extraction("dag/v0", entities, relationships, Some(metadata)))
}

/// One cycle among the jobs' `needs`, as job IDs from its first job back to it.
fn cycle(needs: &BTreeMap<&str, Vec<String>>) -> Option<Vec<String>> {
    #[derive(Clone, Copy, PartialEq)]
    enum State {
        Visiting,
        Done,
    }
    fn visit<'a>(
        job: &'a str,
        needs: &'a BTreeMap<&str, Vec<String>>,
        states: &mut BTreeMap<&'a str, State>,
        path: &mut Vec<&'a str>,
    ) -> Option<Vec<String>> {
        match states.get(job) {
            Some(State::Done) => return None,
            Some(State::Visiting) => {
                let start = path.iter().position(|j| *j == job).unwrap();
                let mut cycle: Vec<String> = path[start..].iter().map(|j| (*j).to_owned()).collect();
                cycle.push(job.to_owned());
                return Some(cycle);
            }
            None => {}
        }
        states.insert(job, State::Visiting);
        path.push(job);
        for dependency in &needs[job] {
            if let Some(cycle) = visit(dependency, needs, states, path) {
                return Some(cycle);
            }
        }
        path.pop();
        states.insert(job, State::Done);
        None
    }
    let mut states = BTreeMap::new();
    needs.keys().find_map(|job| visit(job, needs, &mut states, &mut vec![]))
}
