//! `defaults`: option values a file declares once, which every expression,
//! functions included, reads through `options`.

use projections_comparator_rules::Comparator;
use serde_json::{Value, json};

const RULES: &str = "format: projections.comparator
version: 0
defaults:
  impure: [network, process]
  limit: 2
functions:
  impure:
    params: [{name: capability, type: string}]
    returns: bool
    body: capability in options.impure
metadata:
  values:
    flagged: \"['network', 'clock', 'process'].filter(c, impure(c))\"
    limit: options.limit
";

fn metadata(rules: &str, options: Value) -> Result<Value, String> {
    let extraction = json!({"protocolVersion": 0, "schema": "graph/v0", "entities": [], "relationships": []});
    let comparator = Comparator::from_yaml(rules).map_err(|failure| format!("{failure:?}"))?;
    let comparison = comparator
        .compare(&extraction, &extraction, &options)
        .map_err(|failure| format!("{failure:?}"))?;
    Ok(comparison["metadata"].clone())
}

#[test]
fn functions_read_defaults_through_options_and_given_options_override_them_key_by_key() {
    assert_eq!(
        metadata(RULES, json!({})).unwrap(),
        json!({"flagged": ["network", "process"], "limit": 2})
    );
    assert_eq!(
        metadata(RULES, json!({"impure": ["clock"]})).unwrap(),
        json!({"flagged": ["clock"], "limit": 2})
    );
}

#[test]
fn defaults_must_be_a_map() {
    let error = metadata(
        &RULES.replace("defaults:\n  impure: [network, process]\n  limit: 2\n", "defaults: [1]\n"),
        json!({}),
    )
    .unwrap_err();
    assert!(
        error.contains("/defaults") && error.contains("Expected a map of option names to values"),
        "{error}"
    );
}
