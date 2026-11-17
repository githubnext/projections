use super::{Cache, number};
use serde_json::json;
use std::sync::Arc;

#[test]
fn the_cache_drops_its_oldest_extractions_first() {
    let cache = Cache::default();
    for key in ["a", "b", "c"] {
        cache.insert_bounded(key.to_owned(), Arc::new(json!(key)), 2);
    }
    assert!(cache.get("a").is_none());
    assert_eq!(cache.get("c").as_deref(), Some(&json!("c")));
    // Replacing a key keeps one entry for it.
    cache.insert_bounded("b".to_owned(), Arc::new(json!("B")), 2);
    assert_eq!(cache.get("b").as_deref(), Some(&json!("B")));
    assert_eq!(cache.get("c").as_deref(), Some(&json!("c")));
}

#[test]
fn pull_request_numbers_come_from_messages() {
    assert_eq!(number("Merge pull request #42 from acme/feature"), Some(42));
    assert_eq!(number("Add exports (#17)"), Some(17));
    assert_eq!(number("Run reports earlier"), None);
}

#[test]
fn merged_pull_requests_are_titled_by_their_own_title() {
    assert_eq!(super::title("Merge pull request #4 from a/b", "Add posts\n\nMore"), "Add posts");
    assert_eq!(super::title("Merge pull request #4 from a/b", ""), "Merge pull request #4 from a/b");
    assert_eq!(super::title("Add posts (#4)", "Body"), "Add posts (#4)");
}

#[test]
fn squash_history_with_a_few_old_merges_sweeps_its_commits() {
    let change = |kind: &'static str| super::Change {
        before: "a".into(),
        after: "b".into(),
        title: String::new(),
        number: None,
        kind,
        date: String::new(),
    };
    let squashed: Vec<_> = (0..20).map(|_| change("commit")).collect();
    assert!(!super::merges_dominate(&squashed));
    let mut mixed = squashed.clone();
    mixed[3] = change("merge");
    assert!(!super::merges_dominate(&mixed), "one merge among recent squashes");
    let merged: Vec<_> = (0..20)
        .map(|index| change(if index % 4 == 0 { "commit" } else { "merge" }))
        .collect();
    assert!(super::merges_dominate(&merged), "a branch that takes changes by merging");
}

#[test]
fn failed_cells_keep_the_end_of_the_extractors_stderr() {
    assert_eq!(super::run::tail("short", 10), "short");
    let long = format!("{}é{}", "a".repeat(10), "z".repeat(5));
    // The cut lands inside `é`, so it moves to the next character.
    assert_eq!(super::run::tail(&long, 6), "…zzzzz");
    let change = super::Change {
        before: "a0".into(),
        after: "a1".into(),
        title: String::new(),
        number: Some(7),
        kind: "commit",
        date: String::new(),
    };
    let rows = vec![json!({"projection": "api", "status": "ready"})];
    let cells = vec![json!({"projection": "api", "before": "a0", "after": "a1", "status": "failed",
        "error": "Extractor api exited with exit status: 1", "stderr": "one\ntwo\nthree\nfour\nfive\nsix\nTypeError: x is undefined"})];
    let text = super::text(&[change], &rows, &cells);
    assert!(text.contains("first failure: Extractor api exited with exit status: 1\n"), "{text}");
    assert!(text.contains("      TypeError: x is undefined\n"), "{text}");
    assert!(!text.contains("      two\n"), "only the last lines: {text}");
}

#[test]
fn sweeps_rank_projections_by_signal_and_say_which_are_noise() {
    let changes: Vec<super::Change> = (0..5)
        .map(|index| super::Change {
            before: format!("b{index}"),
            after: format!("a{index}"),
            title: String::new(),
            number: Some(index + 1),
            kind: "commit",
            date: String::new(),
        })
        .collect();
    let rows: Vec<_> = ["map", "ci", "schema", "flags"]
        .iter()
        .map(|id| match *id {
            "flags" => json!({"projection": id, "status": "trust", "error": "It runs repository code"}),
            _ => json!({"projection": id, "status": "ready"}),
        })
        .collect();
    let mut cells = Vec::new();
    for (index, change) in changes.iter().enumerate() {
        for (id, changed) in [("map", true), ("ci", false), ("schema", index == 2)] {
            cells.push(json!({"projection": id, "before": change.before, "after": change.after,
                "status": if changed { "changed" } else { "unchanged" }, "changes": usize::from(changed), "steps": usize::from(changed)}));
        }
    }
    let text = super::text(&changes, &rows, &cells);
    let order: Vec<usize> = ["  schema:", "  map:", "  ci:", "  flags:"]
        .iter()
        .map(|line| text.find(line).unwrap_or_else(|| panic!("{line} in {text}")))
        .collect();
    assert!(
        order.windows(2).all(|pair| pair[0] < pair[1]),
        "rare, noisy, quiet, skipped: {text}"
    );
    assert!(text.contains("    likely noise: it changed on 5 of 5 changes"), "{text}");
    assert!(text.contains("    never changed on these 5 changes"), "{text}");
    assert!(
        text.contains("Worth a look: schema.\nLikely noise (changed on nearly every change): map.\nNever changed here: ci.\n"),
        "{text}"
    );
    // Without anything in between, the sweep says so.
    let rows = vec![
        json!({"projection": "map", "status": "ready"}),
        json!({"projection": "ci", "status": "ready"}),
    ];
    let cells: Vec<_> = cells.into_iter().filter(|cell| cell["projection"] != "schema").collect();
    assert!(super::text(&changes, &rows, &cells).contains("None of these singles out particular changes"));
}

#[test]
fn a_few_changes_are_too_few_to_judge() {
    let cells: Vec<_> = (0..3)
        .map(|_| json!({"projection": "map", "status": "changed"}))
        .chain([json!({"projection": "map", "status": "failed"})])
        .collect();
    let tally = super::signal::tally("map", &cells);
    assert_eq!((tally.changed, tally.judged, tally.failed), (3, 3, 1));
    assert_eq!(tally.signal, super::signal::Signal::Unknown);
    let cells: Vec<_> = (0..5)
        .map(|index| json!({"projection": "map", "status": if index < 4 { "changed" } else { "unchanged" }}))
        .collect();
    assert_eq!(super::signal::tally("map", &cells).signal, super::signal::Signal::Noisy, "4 of 5");
}
