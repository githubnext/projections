//! Initialized Django application model registry.
//!
//! Runs `helper/django_schema.py` with the project's own Python environment.

use anyhow::{Result, ensure};
use projections_extractor_sdk::{
    Context, Descriptor, Trust, database_extraction, execute, input, parse_json, pre_exported_schema, strings,
};
use serde_json::{Value, json};
use std::path::Path;

pub const ID: &str = "django-schema";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Django schema",
        description: "Initialized Django application model registry",
        schema: "database/v0",
        renderer: "database",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({"settings":"Django settings module","python":"Python interpreter; default python3","database":"Database alias whose backend gives column types; default default","snapshot":"Pre-exported effective schema"}),
        template_inputs: Some(json!({"settings":"app.settings"})),
        detects: &["**/models.py", "**/models/__init__.py"],
    }
}

pub fn requires_trust(inputs: &Value) -> bool {
    inputs.get("snapshot").is_none()
}

pub fn collect(cx: &Context) -> Result<Value> {
    let (root, d) = (cx.root(), cx.definition());
    if d["inputs"].get("snapshot").is_some() {
        return pre_exported_schema(cx, d);
    }
    cx.require_trust()?;
    ensure!(
        d["inputs"].get("env").is_none(),
        "Django environment values must come from the per-invocation source via execution.environment, never inputs.env"
    );
    let names = d["execution"]
        .get("environment")
        .map(|v| strings(v, "execution.environment"))
        .transpose()?
        .unwrap_or_default();
    let mut env = cx.environment(&names);
    env.insert("PYTHONDONTWRITEBYTECODE".into(), "1".into());
    if d["inputs"].get("settings").is_some() {
        env.insert("DJANGO_SETTINGS_MODULE".into(), input(d, "settings", None)?.into());
    }
    ensure!(
        env.get("DJANGO_SETTINGS_MODULE").is_some_and(|s| !s.trim().is_empty()),
        "Django requires inputs.settings or an explicitly supplied DJANGO_SETTINGS_MODULE environment variable"
    );
    let helper = cx.helper(
        "helpers/python/django_schema.py",
        Path::new(env!("CARGO_MANIFEST_DIR")).join("helper/django_schema.py"),
    )?;
    ensure!(helper.is_file(), "Django collection requires the installed Python helper assets");
    let request = serde_json::to_string(&cx.request())?;
    let output = execute(
        cx,
        root,
        vec![input(d, "python", Some("python3"))?.into(), helper.to_string_lossy().into_owned()],
        Some(&request),
        env,
        true,
    )?;
    database_extraction(parse_json(&output)?)
}
