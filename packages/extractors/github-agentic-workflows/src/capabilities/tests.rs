use super::*;

fn object(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

#[test]
fn merges_imports_and_records_where_their_capabilities_come_from() {
    let mut capabilities = Capabilities::default();
    capabilities.add(
        &object(json!({
            "tools": {"github": {"toolsets": ["issues"], "min-integrity": "none"}, "bash": ["cat"], "edit": null, "timeout": 60},
            "network": {"allowed": ["defaults", "node"]}
        })),
        None,
    );
    capabilities.add(
        &object(json!({"network": {"allowed": ["*.sentry.io", "node"]}, "tools": {"bash": true}, "mcp-servers": {"docs": {}}})),
        Some("shared/otlp.md"),
    );
    let data = capabilities.finish();
    assert_eq!(data["tools"], json!(["bash", "edit", "github"]));
    assert_eq!(
        data["github"],
        json!({"toolsets": ["issues"], "repos": null, "settings": {"minIntegrity": "none"}})
    );
    assert_eq!(data["bash"], json!(["*", "cat"]));
    assert_eq!(data["network"]["allowed"], json!(["*.sentry.io", "defaults", "node"]));
    assert_eq!(
        data["sources"],
        json!({"bash:*": ["shared/otlp.md"], "mcp:docs": ["shared/otlp.md"], "network:*.sentry.io": ["shared/otlp.md"]})
    );
}

#[test]
fn defaults_apply_when_nothing_is_declared() {
    let mut capabilities = Capabilities::default();
    capabilities.add(&object(json!({"tools": {"github": null}})), None);
    let data = capabilities.finish();
    assert_eq!(data["github"]["toolsets"], json!(["default"]));
    assert_eq!(data["network"], json!({"allowed": ["defaults"], "blocked": [], "declared": false}));
    assert_eq!(data["bash"], Value::Null);
    assert_eq!(permissions(Some(&json!("read-all"))), json!({"all": "read"}));
    assert_eq!(permissions(None), Value::Null);
}
