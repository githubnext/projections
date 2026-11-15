use super::{
    bookmarks::{BOOKMARKS, bookmark_id, highlights},
    *,
};
use crate::sweep;

fn candidate(id: &str, extractor: &str) -> Value {
    json!({"id": id, "adopted": null, "definition": {"id": id, "title": id, "extractor": extractor, "renderer": "graph"}})
}

fn change(after: &str, number: Option<u64>) -> sweep::Change {
    sweep::Change {
        before: format!("{after}0"),
        after: after.to_owned(),
        title: "Add posts".to_owned(),
        number,
        kind: "merge",
        date: String::new(),
    }
}

#[test]
fn adopting_previews_writes_and_never_replaces() {
    let root = tempfile::tempdir().unwrap();
    let candidates = vec![candidate("files", "repository-map")];
    let ids = vec!["files".to_owned()];
    let highlights = vec![Highlight {
        projection: "files".to_owned(),
        change: change("abc", Some(4)),
        changes: 3,
    }];
    let preview = adopt(root.path(), &candidates, &ids, &highlights, None, true).unwrap();
    assert_eq!(preview["written"], false);
    assert_eq!(preview["files"][0]["path"], ".github/projections/files.json");
    assert_eq!(preview["files"][1]["path"], BOOKMARKS);
    assert!(!root.path().join(".github").exists());
    // A stale digest is refused.
    let stale = adopt(root.path(), &candidates, &ids, &highlights, Some("sha256:00"), false).unwrap_err();
    assert!(is_conflict(&stale), "{stale:#}");
    let written = adopt(root.path(), &candidates, &ids, &highlights, preview["digest"].as_str(), false).unwrap();
    assert_eq!(written["written"], true);
    let text = std::fs::read_to_string(root.path().join(".github/projections/files.json")).unwrap();
    assert!(text.starts_with("{\n  \"id\": \"files\",\n  \"title\""), "{text}");
    let definition: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(definition["extractor"], "repository-map");
    let text = std::fs::read_to_string(root.path().join(BOOKMARKS)).unwrap();
    assert!(text.contains("    {\n      \"id\": \"files-pr-4\",\n      \"title\""), "{text}");
    let bookmarks: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(bookmarks["bookmarks"][0]["id"], "files-pr-4");
    assert_eq!(bookmarks["bookmarks"][0]["title"], "#4 Add posts");
    // The file exists now.
    let again = adopt(root.path(), &candidates, &ids, &[], None, false).unwrap_err();
    assert!(format!("{again:#}").contains("already exists"), "{again:#}");
    let unknown = adopt(root.path(), &candidates, &["nope".to_owned()], &[], None, true).unwrap_err();
    assert!(format!("{unknown:#}").contains("it proposes files"), "{unknown:#}");
}

#[test]
fn bookmarking_keeps_an_existing_files_layout() {
    let root = tempfile::tempdir().unwrap();
    let existing = "{\n    \"format\": \"projections.bookmarks\",\n    \"version\": 0,\n    \"bookmarks\": [\n        {\n            \"title\": \"Mine\",\n            \"id\": \"mine\",\n            \"projectionId\": \"files\",\n            \"after\": \"HEAD\"\n        }\n    ]\n}\n";
    std::fs::write(root.path().join(BOOKMARKS), existing).unwrap();
    let candidates = vec![candidate("files", "repository-map")];
    let highlights = vec![Highlight {
        projection: "files".to_owned(),
        change: change("abc", None),
        changes: 1,
    }];
    adopt(root.path(), &candidates, &["files".to_owned()], &highlights, None, false).unwrap();
    let text = std::fs::read_to_string(root.path().join(BOOKMARKS)).unwrap();
    assert!(text.starts_with(&existing[..existing.len() - "\n    ]\n}\n".len()]), "{text}");
    assert!(
            text.ends_with("        },\n        {\n            \"id\": \"files-abc\",\n            \"title\": \"Add posts\",\n            \"projectionId\": \"files\",\n            \"before\": \"abc0\",\n            \"after\": \"abc\"\n        }\n    ]\n}\n"),
            "{text}"
        );
}

#[test]
fn highlights_are_the_most_changed() {
    let changes = vec![change("a", Some(1)), change("b", Some(2)), change("c", None)];
    let cells = vec![
        json!({"projection": "p", "before": "a0", "after": "a", "status": "changed", "changes": 1}),
        json!({"projection": "p", "before": "b0", "after": "b", "status": "changed", "changes": 5}),
        json!({"projection": "p", "before": "c0", "after": "c", "status": "unchanged", "changes": 0}),
        json!({"projection": "q", "before": "c0", "after": "c", "status": "changed", "changes": 9}),
    ];
    let found = highlights("p", &changes, &cells, 3);
    assert_eq!(
        found.iter().map(|highlight| highlight.change.after.as_str()).collect::<Vec<_>>(),
        ["b", "a"]
    );
    assert_eq!(bookmark_id(&found[0]), "p-pr-2");
}
