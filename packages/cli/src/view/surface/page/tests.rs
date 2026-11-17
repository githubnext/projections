use super::describe;
use serde_json::json;

#[test]
fn a_change_is_listed_with_its_context() {
    let view = json!({
        "compared": true,
        "rows": 4,
        "changes": {"added": 1},
        "items": [
            {"id": "tool:view/viewer", "label": "viewer", "kind": "property", "status": "added",
             "context": {"items": [{"id": "tool:view", "label": "view", "kind": "tool"}], "total": 2, "rules": ["callers", "siblings"]}},
            {"id": "tool:check", "label": "check", "kind": "tool", "status": "modified",
             "context": {"items": [{"id": "module", "label": "module", "kind": "module"}], "total": 1, "derived": true}},
            {"id": "tool:view", "label": "view", "kind": "tool", "status": "unchanged"},
            {"id": "tool:serve", "label": "serve", "kind": "tool", "status": "unchanged",
             "context": {"items": [{"id": "module", "label": "module", "kind": "module"}], "total": 1}},
        ],
    });
    let mut lines = Vec::new();
    describe(&mut lines, &view, &json!({}));
    let text = lines.join("\n");
    assert!(
        text.contains(
            "- added property viewer [tool:view/viewer]\n  context: tool view [tool:view] and 1 more (added by rules `callers`, `siblings`)"
        ),
        "{text}"
    );
    // A rename is unchanged, but it is a change: listed with its context; the unchanged item without context isn't.
    assert!(
        text.contains("- unchanged tool serve [tool:serve]\n  context: module module [module]\n"),
        "{text}"
    );
    assert!(!text.contains("[tool:view]\n"), "{text}");
    assert!(
        text.contains("  context: module module [module] (derived: the comparison was saved without context)"),
        "{text}"
    );
}
