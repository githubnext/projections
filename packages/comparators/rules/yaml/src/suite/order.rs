use super::matching::{ids, listed, matches, named, shown};
use super::model::{Failure, StepExpectation, Suite};
use serde_json::{Value, json};
use std::collections::{BTreeSet, HashSet};

impl Suite {
    pub(super) fn order(&self, at: &str, order: &[String], changes: &[Value], steps: &[Value]) -> Vec<Failure> {
        let mut failures = Vec::new();
        // Each token's first and last step.
        let mut spans = Vec::new();
        for (index, token) in order.iter().enumerate() {
            let named: HashSet<&str> = named(changes, token).iter().filter_map(|change| change["id"].as_str()).collect();
            let positions: Vec<usize> = steps
                .iter()
                .enumerate()
                .filter(|(_, step)| ids(&step["changes"]).iter().any(|id| named.contains(id)))
                .map(|(position, _)| position)
                .collect();
            match (positions.first(), positions.last()) {
                (Some(first), Some(last)) => spans.push(Some((*first, *last))),
                _ => {
                    failures.push(self.failure(format!("{at}/{index}"), format!("`{token}` names no change in any step")));
                    spans.push(None);
                }
            }
        }
        for index in 1..order.len() {
            if let (Some((_, last)), Some((first, _))) = (spans[index - 1], spans[index]) {
                if last >= first {
                    failures.push(Failure {
                        expected: Some(json!(order)),
                        actual: Some(json!(
                            spans
                                .iter()
                                .map(|span| span.map(|(first, last)| if first == last {
                                    json!(first + 1)
                                } else {
                                    json!([first + 1, last + 1])
                                }))
                                .collect::<Vec<_>>()
                        )),
                        ..self.failure(
                            format!("{at}/{index}"),
                            format!(
                                "`{}` (step {}) is not in a step before `{}` (step {})",
                                order[index - 1],
                                last + 1,
                                order[index],
                                first + 1
                            ),
                        )
                    });
                }
            }
        }
        failures
    }

    pub(super) fn steps(&self, at: &str, expected: &[StepExpectation], changes: &[Value], steps: &[Value]) -> Vec<Failure> {
        let outline = |step: &Value| {
            let mut value = json!({"changes": step["changes"]});
            if let Some(kind) = step.get("kind") {
                value["kind"] = kind.clone();
            }
            if let Some(summary) = step.get("summary") {
                value["summary"] = summary.clone();
            }
            value
        };
        if expected.len() != steps.len() {
            let wanted: Vec<Value> = expected
                .iter()
                .map(|step| {
                    let mut value = json!({});
                    if let Some(changes) = &step.changes {
                        value["changes"] = json!(changes);
                    }
                    if let Some(kind) = &step.kind {
                        value["kind"] = kind.clone();
                    }
                    if let Some(summary) = &step.summary {
                        value["summary"] = summary.clone();
                    }
                    value
                })
                .collect();
            return vec![self.mismatched(
                at.to_owned(),
                format!("The comparison has {} steps; expected {}", steps.len(), expected.len()),
                json!(wanted),
                json!(steps.iter().map(outline).collect::<Vec<_>>()),
            )];
        }
        let mut failures = Vec::new();
        for (index, (wanted, step)) in expected.iter().zip(steps).enumerate() {
            let here = format!("{at}/{index}");
            for (key, value) in [("kind", &wanted.kind), ("summary", &wanted.summary)] {
                if let Some(value) = value {
                    if !matches(value, step.get(key)) {
                        failures.push(self.mismatched(
                            format!("{here}/{key}"),
                            format!(
                                "Step {}'s {key} is {}; expected {}",
                                index + 1,
                                shown(step.get(key)),
                                shown(Some(value))
                            ),
                            value.clone(),
                            step.get(key).cloned().unwrap_or(Value::Null),
                        ));
                    }
                }
            }
            if let Some(tokens) = &wanted.changes {
                let mut resolved = BTreeSet::new();
                let mut unknown = false;
                for (position, token) in tokens.iter().enumerate() {
                    let named = named(changes, token);
                    if named.is_empty() {
                        unknown = true;
                        failures.push(self.failure(format!("{here}/changes/{position}"), format!("`{token}` names no change")));
                    }
                    resolved.extend(named.iter().filter_map(|change| change["id"].as_str()));
                }
                let actual: BTreeSet<&str> = ids(&step["changes"]).into_iter().collect();
                if !unknown && resolved != actual {
                    let missing: Vec<&str> = resolved.difference(&actual).copied().collect();
                    let extra: Vec<&str> = actual.difference(&resolved).copied().collect();
                    let mut parts = Vec::new();
                    if !missing.is_empty() {
                        parts.push(format!("lacks {}", listed(&missing)));
                    }
                    if !extra.is_empty() {
                        parts.push(format!("also has {}", listed(&extra)));
                    }
                    failures.push(self.mismatched(
                        format!("{here}/changes"),
                        format!("Step {} {}", index + 1, parts.join(" and ")),
                        json!(resolved),
                        json!(actual),
                    ));
                }
            }
        }
        failures
    }
}
