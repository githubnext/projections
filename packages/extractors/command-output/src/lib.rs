//! Captured stdout from named CLI commands.

use anyhow::{Context as _, Result, ensure};
use projections_extractor_sdk::{Context, Descriptor, Trust, array, execute, extraction, object, text};
use regex::Regex;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub const ID: &str = "command-output";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Command output",
        description: "Captured stdout from named CLI commands",
        schema: "graph/v0",
        renderer: "text-diff",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({"commands":"Array of {id, label, command} with stable ID and executable argv; each command runs in both revisions (requires --trust)"}),
        template_inputs: None,
        detects: &[],
    }
}

pub fn requires_trust(_inputs: &Value) -> bool {
    true
}

pub fn collect(cx: &Context) -> Result<Value> {
    let (root, d) = (cx.root(), cx.definition());
    let commands = array(&d["inputs"]["commands"], "inputs.commands")?;
    ensure!(
        !commands.is_empty() && commands.len() <= 16,
        "inputs.commands must contain 1–16 commands"
    );
    let safe_name = Regex::new("^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$")?;
    let mut seen = BTreeSet::new();
    let mut selected = vec![];
    for (i, value) in commands.iter().enumerate() {
        object(value, &format!("inputs.commands[{i}]"))?;
        let id = text(&value["id"], "command.id")?;
        ensure!(safe_name.is_match(id), "inputs.commands[{i}].id must be a stable name");
        ensure!(seen.insert(id), "Duplicate command-output command ID: {id}");
        let label = text(&value["label"], "command.label")?;
        let presentation = match value.get("presentation") {
            None => "formatted",
            Some(v) => v.as_str().context("command.presentation must be prose or formatted")?,
        };
        ensure!(
            matches!(presentation, "prose" | "formatted"),
            "inputs.commands[{i}].presentation must be prose or formatted"
        );
        let command = array(&value["command"], "command.command")?
            .iter()
            .map(|arg| {
                arg.as_str()
                    .filter(|s| !s.is_empty() && !s.contains('\0'))
                    .map(str::to_owned)
                    .context("command must be a nonempty argv array without NULs")
            })
            .collect::<Result<Vec<_>>>()?;
        ensure!(!command.is_empty(), "command must be a nonempty argv array without NULs");
        selected.push((id, label, presentation, command));
    }
    cx.require_trust()?;
    let mut nodes = vec![];
    for (id, label, presentation, argv) in selected {
        let output = execute(
            cx,
            root,
            argv,
            None,
            BTreeMap::from([("NO_COLOR".into(), "1".into()), ("TERM".into(), "dumb".into())]),
            true,
        )?;
        ensure!(output.len() <= 256 * 1024, "Output for \"{id}\" exceeds 256 KiB");
        ensure!(
            !output.chars().any(|c| {
                let n = c as u32;
                (n < 32 && !matches!(n, 9 | 10 | 13)) || (127..=159).contains(&n)
            }),
            "Output for \"{id}\" contains non-text control characters"
        );
        nodes.push(json!({"id":format!("output:{id}"),"kind":"output","label":label,
            "data":{"text":output,"presentation":presentation},"confidence":"authoritative"}));
    }
    Ok(extraction(
        "graph/v0",
        nodes,
        vec![],
        Some(json!({"source":"CLI stdout",
        "limitations":["Command output may depend on external state or tool versions; run in a pinned, trusted environment."]})),
    ))
}
