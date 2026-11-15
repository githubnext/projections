use super::diff::diff;
use super::matching::{equal, get, mismatch, projected, shown};
use super::model::{Case, Failure, Location, Outcome, Suite};
use super::{location_in, pretty, snapshot};
use serde_json::{Value, json};

impl Suite {
    /// The line and column of a pointer into the test file (or of its
    /// nearest written ancestor).
    pub fn location(&self, pointer: &str) -> Location {
        location_in(&self.positions, pointer)
    }

    /// The options a case runs with, when the file or the case gives any.
    pub fn options<'a>(&'a self, case: &'a Case) -> Option<&'a Value> {
        case.options.as_ref().or(self.options.as_ref())
    }

    pub(super) fn failure(&self, expectation: String, message: impl Into<String>) -> Failure {
        Failure {
            location: self.location(&expectation),
            expectation,
            message: message.into(),
            expected: None,
            actual: None,
            diff: None,
        }
    }

    pub(super) fn mismatched(&self, expectation: String, message: impl Into<String>, expected: Value, actual: Value) -> Failure {
        let diff = diff(&pretty(&expected), &pretty(&actual));
        Failure {
            diff: Some(diff),
            expected: Some(expected),
            actual: Some(actual),
            ..self.failure(expectation, message)
        }
    }

    /// Judges a case's outcome against its expectations (not its snapshot).
    pub fn evaluate(&self, case: &Case, outcome: Outcome<'_>) -> Vec<Failure> {
        let base = case.pointer();
        let expect = case.expect.clone().unwrap_or_default();
        let comparison = match (outcome, &expect.error) {
            (Outcome::Error(message), Some(expected)) => {
                return if message.contains(expected.as_str()) {
                    Vec::new()
                } else {
                    vec![self.mismatched(
                        format!("{base}/expect/error"),
                        format!("The comparator failed with another error: {message}"),
                        json!(expected),
                        json!(message),
                    )]
                };
            }
            (Outcome::Error(message), None) => {
                return vec![Failure {
                    actual: Some(json!(message)),
                    ..self.failure(base, format!("The comparator failed: {message}"))
                }];
            }
            (Outcome::Comparison(_), Some(expected)) => {
                return vec![Failure {
                    expected: Some(json!(expected)),
                    ..self.failure(
                        format!("{base}/expect/error"),
                        format!("The comparator produced a comparison; expected it to fail with \"{expected}\""),
                    )
                }];
            }
            (Outcome::Comparison(comparison), None) => comparison,
        };
        let at = format!("{base}/expect");
        let changes = comparison["changes"].as_array().cloned().unwrap_or_default();
        let steps = comparison["steps"].as_array().cloned().unwrap_or_default();
        let mut failures = Vec::new();
        for (key, expected, actual) in [
            ("changes", expect.count_changes, changes.len()),
            ("steps", expect.count_steps, steps.len()),
        ] {
            if let Some(expected) = expected.filter(|expected| *expected != actual as u64) {
                failures.push(Failure {
                    expected: Some(json!(expected)),
                    actual: Some(json!(actual)),
                    ..self.failure(
                        format!("{at}/count/{key}"),
                        format!("The comparison has {actual} {key}; expected {expected}"),
                    )
                });
            }
        }
        if let Some(order) = &expect.order {
            failures.extend(self.order(&format!("{at}/order"), order, &changes, &steps));
        }
        if let Some(expected) = &expect.steps {
            failures.extend(self.steps(&format!("{at}/steps"), expected, &changes, &steps));
        }
        for (index, expectation) in expect.changes.iter().enumerate() {
            failures.extend(self.change(&format!("{at}/changes/{index}"), expectation, &changes));
        }
        if let Some(expected) = &expect.metadata {
            let actual = comparison.get("metadata").cloned().unwrap_or(json!({}));
            if let Some(path) = mismatch(expected, Some(&actual), "") {
                let wanted = get(expected, &path);
                let found = get(&actual, &path);
                failures.push(self.mismatched(
                    format!("{at}/metadata{path}"),
                    format!("metadata{} is {}; expected {}", path.replace('/', "."), shown(found), shown(wanted)),
                    expected.clone(),
                    projected(expected, Some(&actual)),
                ));
            }
        }
        failures
    }

    /// Judges a comparison against a case's snapshot file's text (`None`
    /// when it doesn't exist yet). Formatting doesn't matter, only the JSON.
    pub fn check_snapshot(&self, case: &Case, comparison: &Value, existing: Option<&str>) -> Option<Failure> {
        let path = case.snapshot.as_deref()?;
        let at = format!("{}/snapshot", case.pointer());
        let Some(existing) = existing else {
            return Some(self.failure(at, format!("No snapshot {path} yet; run projections check --update to write it")));
        };
        let saved = match projections_engine::parse_json(existing) {
            Ok(saved) => saved,
            Err(_) => {
                return Some(self.failure(
                    at,
                    format!("The snapshot {path} isn't JSON; run projections check --update to rewrite it"),
                ));
            }
        };
        if equal(&saved, comparison) {
            return None;
        }
        Some(Failure {
            diff: Some(diff(&snapshot(&saved), &snapshot(comparison))),
            ..self.failure(
                at,
                format!("The comparison differs from the snapshot {path}; if the change is intended, run projections check --update"),
            )
        })
    }
}
