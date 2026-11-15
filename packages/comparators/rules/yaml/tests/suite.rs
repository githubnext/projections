//! Comparator rules test files: reading them, and judging comparisons
//! against their expectations.

use projections_rules_yaml::suite::{self, Location, Outcome, Selector, Source};
use serde_json::{Value, json};

const FILE: &str = r#"# yaml-language-server: $schema=https://schemas.projections.githubnext.com/comparator-tests/v0.json
format: projections.comparator-tests
version: 0
options: {priority: [entity:a]}
cases:
  - name: a comes first
    before: fixtures/before.json
    after: {file: fixtures/after.json}
    expect:
      order: [entity:a, entity:b]
      steps:
        - {kind: restructure, changes: [entity:a]}
        - {kind: add, summary: Adds b., changes: [entity:b, rel:b]}
      changes:
        - {item: entity:a, status: modified, correspondence: exact}
        - {id: rel:b, status: added, summary: null}
      count: {changes: 3, steps: 2}
      metadata: {verdict: {level: breaking}}
    snapshot: snapshots/a.json
  - name: inline and revision
    before: {extraction: {protocolVersion: 0, schema: graph/v0, entities: [], relationships: []}}
    after: {revision: working-tree}
    options: {}
    snapshot: snapshots/b.json
  - name: bad options
    before: fixtures/before.json
    after: fixtures/before.json
    options: {priority: 1}
    expect:
      error: invalid options
"#;

fn comparison() -> Value {
    json!({
        "protocolVersion": 0,
        "changes": [
            {"id": "entity:a", "collection": "entities", "before": ["entity:a"], "after": ["entity:a"], "status": "modified", "correspondence": "exact"},
            {"id": "entity:b", "collection": "entities", "before": [], "after": ["entity:b"], "status": "added", "correspondence": "none"},
            {"id": "rel:b", "collection": "relationships", "before": [], "after": ["rel:b"], "status": "added", "correspondence": "none"},
        ],
        "steps": [
            {"kind": "restructure", "changes": ["entity:a"]},
            {"kind": "add", "summary": "Adds b.", "changes": ["entity:b", "rel:b"]},
        ],
        "metadata": {"verdict": {"level": "breaking", "count": 1}, "other": true},
    })
}

fn messages(failures: &[suite::Failure]) -> Vec<String> {
    failures
        .iter()
        .map(|failure| format!("{} {}", failure.expectation, failure.message))
        .collect()
}

#[test]
fn reads_cases_sources_and_options() {
    let suite = suite::parse(FILE).unwrap();
    assert_eq!(suite.cases.len(), 3);
    let [first, second, third] = &suite.cases[..] else { unreachable!() };
    assert_eq!(first.name, "a comes first");
    assert_eq!(first.location, Location { line: 6, column: 11 });
    assert_eq!(first.before, Source::File("fixtures/before.json".into()));
    assert_eq!(first.after, Source::File("fixtures/after.json".into()));
    assert_eq!(suite.options(first), Some(&json!({"priority": ["entity:a"]})));
    let expect = first.expect.as_ref().unwrap();
    assert_eq!(expect.steps.as_ref().unwrap().len(), 2);
    assert_eq!(expect.changes[0].selector, Selector::Item("entity:a".into()));
    assert_eq!(expect.count_changes, Some(3));
    assert_eq!(first.snapshot.as_deref(), Some("snapshots/a.json"));
    assert!(matches!(second.before, Source::Extraction(_)));
    assert_eq!(second.after, Source::Revision("working-tree".into()));
    assert!(second.uses_revisions() && !first.uses_revisions());
    // A case's options replace the file's.
    assert_eq!(suite.options(second), Some(&json!({})));
    assert_eq!(third.expect.as_ref().unwrap().error.as_deref(), Some("invalid options"));
    assert_eq!(suite.location("/cases/0/expect/steps/1/changes"), Location { line: 13, column: 41 });
}

#[test]
fn paths_beside_rules() {
    assert_eq!(
        suite::tests_path("a/b.comparator.yaml").as_deref(),
        Some("a/b.comparator.test.yaml")
    );
    assert_eq!(suite::tests_path("b.comparator.yml").as_deref(), Some("b.comparator.test.yml"));
    assert_eq!(suite::tests_path("b.yaml"), None);
    assert_eq!(suite::tests_path("b.rules.yaml"), None);
    assert_eq!(
        suite::rules_path("a/b.comparator.test.yaml").as_deref(),
        Some("a/b.comparator.yaml")
    );
    assert_eq!(suite::rules_path("a/b.comparator.yaml"), None);
}

fn errors(text: &str) -> Vec<String> {
    suite::parse(text)
        .unwrap_err()
        .iter()
        .map(|diagnostic| {
            format!(
                "{}:{} {} {}",
                diagnostic.location.line, diagnostic.location.column, diagnostic.pointer, diagnostic.message
            )
        })
        .collect()
}

#[test]
fn rejects_mistakes_with_their_line_and_column() {
    let header = "format: projections.comparator-tests\nversion: 0\n";
    let unknown = errors(&format!(
        "{header}cases:\n  - name: x\n    before: a.json\n    after: b.json\n    snapshot: s.json\n    expected: {{}}\n"
    ));
    assert_eq!(unknown.len(), 1, "{unknown:?}");
    assert!(
        unknown[0].starts_with("8:15 /cases/0/expected Unknown field `expected` in A case"),
        "{unknown:?}"
    );

    let duplicate = errors(&format!(
        "{header}cases:\n  - {{name: x, before: a.json, after: b.json, snapshot: s.json}}\n  - {{name: x, before: a.json, after: b.json, snapshot: t.json}}\n"
    ));
    assert_eq!(duplicate, ["5:12 /cases/1/name Duplicate case name `x`; names are case IDs"]);

    assert_eq!(
        errors(&format!("{header}cases: []\n")),
        ["3:1 /cases `cases` must list at least one case"]
    );
    let nothing = errors(&format!("{header}cases:\n  - {{name: x, before: a.json, after: b.json}}\n"));
    assert!(nothing[0].contains("A case asserts nothing"), "{nothing:?}");

    let sources = errors(&format!(
        "{header}cases:\n  - name: x\n    before: /etc/passwd\n    after: {{file: a.json, revision: HEAD}}\n    snapshot: s.json\n"
    ));
    assert_eq!(sources.len(), 2, "{sources:?}");
    assert!(
        sources[0].starts_with("5:13 /cases/0/before A fixture path must be a path relative"),
        "{sources:?}"
    );
    assert!(sources[1].starts_with("6:12 /cases/0/after A source is one of"), "{sources:?}");

    let format = errors("format: projections.comparator\nversion: 1\ncases:\n  - {name: x}\n");
    assert!(format.iter().any(|error| error.starts_with("1:9 /format")), "{format:?}");
    assert!(format.iter().any(|error| error.starts_with("2:10 /version")), "{format:?}");
    assert!(format.iter().any(|error| error.contains("A case needs `before`")), "{format:?}");

    let selector = errors(&format!(
        "{header}cases:\n  - name: x\n    before: a.json\n    after: b.json\n    expect:\n      changes:\n        - {{item: a, id: a, status: added}}\n        - {{item: a, status: moved}}\n      steps: [{{kind: shuffle}}]\n"
    ));
    assert_eq!(selector.len(), 3, "{selector:?}");
    assert!(
        selector[0].starts_with("11:22 /cases/0/expect/steps/0/kind A step's `kind` must be one of"),
        "{selector:?}"
    );
    assert!(selector[1].contains("exactly one of `item` or `id`"), "{selector:?}");
    assert!(selector[2].starts_with("10:29 /cases/0/expect/changes/1/status"), "{selector:?}");

    let combined = errors(&format!(
        "{header}cases:\n  - name: x\n    before: a.json\n    after: b.json\n    snapshot: s.json\n    expect: {{error: boom}}\n"
    ));
    assert!(combined[0].contains("expects an `error`"), "{combined:?}");

    // The YAML reader's own errors keep their position.
    let syntax = errors(&format!("{header}cases:\n  - name: [unclosed\n"));
    assert_eq!(syntax.len(), 1);
    assert!(syntax[0].starts_with("5:"), "{syntax:?}");
    let anchors = errors(&format!("{header}cases: &a []\n"));
    assert!(anchors[0].contains("Anchors aren't allowed"), "{anchors:?}");
}

#[test]
fn passing_expectations_report_nothing() {
    let suite = suite::parse(FILE).unwrap();
    let comparison = comparison();
    assert!(suite.evaluate(&suite.cases[0], Outcome::Comparison(&comparison)).is_empty());
    // Only a snapshot: nothing to evaluate.
    assert!(suite.evaluate(&suite.cases[1], Outcome::Comparison(&comparison)).is_empty());
    assert!(
        suite
            .evaluate(
                &suite.cases[2],
                Outcome::Error("Comparator x failed (comparator-error): invalid options: `priority`")
            )
            .is_empty()
    );
}

#[test]
fn failures_name_the_expectation_and_show_the_difference() {
    let suite = suite::parse(FILE).unwrap();
    let mut comparison = comparison();
    comparison["steps"] = json!([
        {"kind": "add", "summary": "Adds b.", "changes": ["entity:b", "rel:b"]},
        {"kind": "restructure", "changes": ["entity:a"]},
    ]);
    comparison["changes"][0]["status"] = json!("unchanged");
    comparison["changes"][2]["summary"] = json!("Adds rel:b.");
    comparison["metadata"]["verdict"]["level"] = json!("compatible");
    let failures = suite.evaluate(&suite.cases[0], Outcome::Comparison(&comparison));
    assert_eq!(
        messages(&failures),
        [
            "/cases/0/expect/order/1 `entity:a` (step 2) is not in a step before `entity:b` (step 1)",
            "/cases/0/expect/steps/0/kind Step 1's kind is \"add\"; expected \"restructure\"",
            "/cases/0/expect/steps/0/changes Step 1 lacks `entity:a` and also has `entity:b`, `rel:b`",
            "/cases/0/expect/steps/1/kind Step 2's kind is \"restructure\"; expected \"add\"",
            "/cases/0/expect/steps/1/summary Step 2's summary is absent; expected \"Adds b.\"",
            "/cases/0/expect/steps/1/changes Step 2 lacks `entity:b`, `rel:b` and also has `entity:a`",
            "/cases/0/expect/changes/0/status Change `entity:a` has status \"unchanged\"; expected \"modified\"",
            "/cases/0/expect/changes/1/summary Change `rel:b` has summary \"Adds rel:b.\"; expected null",
            "/cases/0/expect/metadata/verdict/level metadata.verdict.level is \"compatible\"; expected \"breaking\"",
        ]
    );
    let status = &failures[6];
    assert_eq!(status.location, Location { line: 15, column: 36 });
    assert_eq!(status.expected, Some(json!("modified")));
    assert_eq!(status.actual, Some(json!("unchanged")));
    assert_eq!(
        status.diff.as_deref(),
        Some("--- expected\n+++ actual\n-\"modified\"\n+\"unchanged\"")
    );
    // A metadata diff shows only the keys the expectation lists.
    let metadata = failures.last().unwrap();
    assert_eq!(metadata.actual, Some(json!({"verdict": {"level": "compatible"}})));
    assert!(
        metadata
            .diff
            .as_deref()
            .unwrap()
            .contains("-    \"level\": \"breaking\"\n+    \"level\": \"compatible\""),
        "{:?}",
        metadata.diff
    );

    // Counts, and a step list of another length.
    comparison["steps"] = json!([{"kind": "add", "changes": ["entity:a", "entity:b", "rel:b"]}]);
    comparison["changes"].as_array_mut().unwrap().pop();
    let failures = suite.evaluate(&suite.cases[0], Outcome::Comparison(&comparison));
    let shown = messages(&failures);
    assert!(
        shown.contains(&"/cases/0/expect/count/changes The comparison has 2 changes; expected 3".to_owned()),
        "{shown:?}"
    );
    assert!(
        shown.contains(&"/cases/0/expect/steps The comparison has 1 steps; expected 2".to_owned()),
        "{shown:?}"
    );
    assert!(
        shown
            .iter()
            .any(|message| message.starts_with("/cases/0/expect/changes/1/id No change has the ID `rel:b`")),
        "{shown:?}"
    );
}

#[test]
fn a_selector_must_name_exactly_one_change() {
    let text = "format: projections.comparator-tests\nversion: 0\ncases:\n  - name: x\n    before: a.json\n    after: b.json\n    expect:\n      changes:\n        - {item: entity:b, status: added}\n        - {item: entity:b, collection: relationships, status: added}\n        - {item: entity:zzz, status: added}\n";
    let suite = suite::parse(text).unwrap();
    let mut comparison = comparison();
    comparison["changes"][2]["after"] = json!(["rel:b", "entity:b"]);
    let shown = messages(&suite.evaluate(&suite.cases[0], Outcome::Comparison(&comparison)));
    assert_eq!(
        shown,
        [
            "/cases/0/expect/changes/0/item 2 changes include `entity:b`: entity:b (entities), rel:b (relationships); select one by `id`, or narrow it with `collection`",
            "/cases/0/expect/changes/2/item No change includes the item `entity:zzz`; the changes include `entity:a`, `entity:b`, `rel:b`",
        ]
    );
}

#[test]
fn errors_are_expected_or_reported() {
    let suite = suite::parse(FILE).unwrap();
    let comparison = comparison();
    let unexpected = suite.evaluate(&suite.cases[0], Outcome::Error("boom"));
    assert_eq!(messages(&unexpected), ["/cases/0 The comparator failed: boom"]);
    let other = suite.evaluate(&suite.cases[2], Outcome::Error("budget exceeded"));
    assert_eq!(
        messages(&other),
        ["/cases/2/expect/error The comparator failed with another error: budget exceeded"]
    );
    let none = suite.evaluate(&suite.cases[2], Outcome::Comparison(&comparison));
    assert_eq!(
        messages(&none),
        ["/cases/2/expect/error The comparator produced a comparison; expected it to fail with \"invalid options\""]
    );
}

#[test]
fn snapshots_are_sorted_pretty_json_compared_by_value() {
    let suite = suite::parse(FILE).unwrap();
    let case = &suite.cases[0];
    let comparison = comparison();
    let text = suite::snapshot(&comparison);
    assert!(text.starts_with("{\n  \"changes\": [\n    {\n      \"after\": [\n        \"entity:a\""));
    assert!(text.ends_with("}\n"));
    assert!(suite.check_snapshot(case, &comparison, Some(&text)).is_none());
    // Formatting doesn't matter.
    let compact = serde_json::to_string(&comparison).unwrap();
    assert!(suite.check_snapshot(case, &comparison, Some(&compact)).is_none());
    let missing = suite.check_snapshot(case, &comparison, None).unwrap();
    assert_eq!(missing.expectation, "/cases/0/snapshot");
    assert_eq!(
        missing.message,
        "No snapshot snapshots/a.json yet; run projections check --update to write it"
    );
    let mut changed = comparison.clone();
    changed["steps"][1]["summary"] = json!("Adds b and its relationship.");
    let differs = suite.check_snapshot(case, &changed, Some(&text)).unwrap();
    assert!(
        differs
            .message
            .starts_with("The comparison differs from the snapshot snapshots/a.json")
    );
    let diff = differs.diff.unwrap();
    assert!(
        diff.contains("-      \"summary\": \"Adds b.\"\n+      \"summary\": \"Adds b and its relationship.\""),
        "{diff}"
    );
    assert!(suite.check_snapshot(&suite.cases[2], &comparison, None).is_none());
}

#[test]
fn diffs_show_context_around_each_change() {
    let old: String = (1..=20).map(|line| format!("{line}\n")).collect();
    let new = old.replace("\n3\n", "\nthree\n").replace("\n17\n", "\n");
    assert_eq!(
        suite::diff(&old, &new),
        "--- expected\n+++ actual\n 1\n 2\n-3\n+three\n 4\n 5\n 6\n…\n 14\n 15\n 16\n-17\n 18\n 19\n 20"
    );
}
