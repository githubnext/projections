//! The hooks each probe item attaches to, one per call, list entry or symbol.

use super::fields::{KPROBE_FIELDS, LSM_FIELDS, TRACEPOINT_FIELDS, UPROBE_FIELDS, USDT_FIELDS};
use super::values::{flag, locate, scalars, text, unmodelled, yaml_value};
use super::{Policy, Probe};
use crate::hooks::{function_category, function_stability, tracepoint_category};
use anyhow::{Context, Result};
use projections_extractor_sdk::key;
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

impl Policy<'_> {
    /// Expands a call, or a `list:` reference, into kernel function names and
    /// whether each came from a list. Generated lists stay one item.
    pub(super) fn expand(&self, call: &str) -> Result<Vec<(String, Option<String>)>> {
        let Some(name) = call.strip_prefix("list:") else {
            return Ok(vec![(call.to_owned(), None)]);
        };
        let (list_type, values, pattern) = self
            .lists
            .get(name)
            .with_context(|| format!("Policy {} references undefined list {name}", self.name))?;
        if let Some(generated @ ("generated_syscalls" | "generated_ftrace")) = list_type.as_deref() {
            let target = match pattern {
                Some(pattern) => format!("{generated}:{pattern}"),
                None => generated.to_owned(),
            };
            return Ok(vec![(format!("generated:{target}"), Some(name.to_owned()))]);
        }
        Ok(values.iter().map(|value| (value.clone(), Some(name.to_owned()))).collect())
    }

    pub(super) fn probes(
        &self,
        family: &str,
        item: &Map<String, Value>,
        path: &str,
        limitations: &mut BTreeSet<String>,
    ) -> Result<Vec<Probe>> {
        let known = match family {
            "kprobe" | "fentry" => KPROBE_FIELDS,
            "tracepoint" => TRACEPOINT_FIELDS,
            "lsm" => LSM_FIELDS,
            "uprobe" => UPROBE_FIELDS,
            _ => USDT_FIELDS,
        };
        let extra = unmodelled(item, known, path, limitations);
        let mut base = json!({"hookType":family});
        for field in [
            "message",
            "tags",
            "args",
            "data",
            "returnArg",
            "returnArgAction",
            "ignore",
            "btfPath",
            "binaryDigests",
        ] {
            if let Some(value) = item.get(field).filter(|v| !v.is_null()) {
                base[field] = value.clone();
            }
        }
        if let Some(extra) = extra {
            base["unmodelled"] = extra;
        }
        let mut probes = vec![];
        match family {
            "kprobe" | "fentry" => {
                let call = text(item.get("call"), &format!("{path}.call"))?;
                let syscall = flag(item.get("syscall"), true);
                for (target, via) in self.expand(call)? {
                    let mut data = base.clone();
                    data["target"] = json!(target);
                    data["syscall"] = json!(syscall);
                    data["return"] = json!(flag(item.get("return"), false));
                    if let Some(via) = &via {
                        data["viaList"] = json!(via);
                    }
                    let generated = target.starts_with("generated:");
                    let stability = if generated { "generated" } else { function_stability(&target) };
                    let category = if generated { "other" } else { function_category(&target) };
                    probes.push(Probe {
                        hook: key(&["hook", family, &target]),
                        hook_label: target.clone(),
                        hook_data: json!({"hookType":family,"target":target,"stability":stability,"category":category}),
                        data,
                        line: locate(
                            self.document,
                            &format!(r#"^\s*-?\s*call:\s*["']?{}["']?\s*(#.*)?$"#, yaml_value(call)),
                        ),
                    });
                }
            }
            "tracepoint" => {
                let subsystem = text(item.get("subsystem"), &format!("{path}.subsystem"))?;
                let event = text(item.get("event"), &format!("{path}.event"))?;
                let target = format!("{subsystem}/{event}");
                let raw = flag(item.get("raw"), false);
                let mut data = base;
                data["target"] = json!(target);
                data["raw"] = json!(raw);
                probes.push(Probe {
                    hook: key(&["hook", family, &target]),
                    hook_label: target.clone(),
                    hook_data: json!({"hookType":family,"target":target,"stability":"stable","category":tracepoint_category(subsystem, event)}),
                    data,
                    line: locate(self.document, &format!(r#"^\s*-?\s*event:\s*["']?{}["']?"#, yaml_value(event))),
                });
            }
            "lsm" => {
                let hook = text(item.get("hook"), &format!("{path}.hook"))?;
                let mut data = base;
                data["target"] = json!(hook);
                probes.push(Probe {
                    hook: key(&["hook", family, hook]),
                    hook_label: hook.to_owned(),
                    hook_data: json!({"hookType":family,"target":hook,"stability":"stable","category":function_category(hook)}),
                    data,
                    line: locate(self.document, &format!(r#"^\s*-?\s*hook:\s*["']?{}["']?"#, yaml_value(hook))),
                });
            }
            "uprobe" => {
                let binary = text(item.get("path"), &format!("{path}.path"))?;
                let mut targets: Vec<String> = scalars(item.get("symbols"), &format!("{path}.symbols"))?;
                for (field, prefix) in [("offsets", "+"), ("addrs", "@")] {
                    for value in scalars(item.get(field), &format!("{path}.{field}"))? {
                        targets.push(format!("{prefix}{value}"));
                    }
                }
                if targets.is_empty() {
                    targets.push(String::new());
                }
                for symbol in targets {
                    let target = if symbol.is_empty() {
                        binary.to_owned()
                    } else {
                        format!("{binary}:{symbol}")
                    };
                    let mut data = base.clone();
                    data["target"] = json!(target);
                    data["binary"] = json!(binary);
                    data["return"] = json!(flag(item.get("return"), false));
                    probes.push(Probe {
                        hook: key(&["hook", family, &target]),
                        hook_label: target.clone(),
                        hook_data: json!({"hookType":family,"target":target,"binary":binary,"stability":"user","category":"user-space"}),
                        data,
                        line: locate(self.document, &format!(r#"^\s*-?\s*path:\s*["']?{}["']?"#, yaml_value(binary))),
                    });
                }
            }
            _ => {
                let binary = text(item.get("path"), &format!("{path}.path"))?;
                let provider = text(item.get("provider"), &format!("{path}.provider"))?;
                let name = text(item.get("name"), &format!("{path}.name"))?;
                let target = format!("{binary}:{provider}:{name}");
                let mut data = base;
                data["target"] = json!(target);
                data["binary"] = json!(binary);
                probes.push(Probe {
                    hook: key(&["hook", family, &target]),
                    hook_label: format!("{provider}:{name}"),
                    hook_data: json!({"hookType":family,"target":target,"binary":binary,"stability":"user","category":"user-space"}),
                    data,
                    line: locate(self.document, &format!(r#"^\s*-?\s*path:\s*["']?{}["']?"#, yaml_value(binary))),
                });
            }
        }
        Ok(probes)
    }
}
