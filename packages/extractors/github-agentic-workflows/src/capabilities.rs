//! What a workflow's agent can reach: its tools, the GitHub tool's toolsets
//! and repositories, bash commands, MCP servers and network allowlist, from
//! the workflow and everything it imports (gh-aw merges an import's `tools`,
//! `mcp-servers` and `network.allowed` into the workflow's).

use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// `tools` keys that configure the others rather than enable a tool.
const SETTINGS: &[&str] = &["timeout", "startup-timeout"];

/// The capabilities gathered so far, and which import added each one the workflow itself doesn't declare.
#[derive(Default)]
pub struct Capabilities {
    tools: BTreeSet<String>,
    toolsets: BTreeSet<String>,
    /// `tools.github.allowed-repos`; `None` when nothing declares a guard policy.
    repos: Option<BTreeSet<String>>,
    /// Allowed bash commands, `*` for any; `None` when bash isn't enabled.
    bash: Option<BTreeSet<String>>,
    mcp: BTreeSet<String>,
    allowed: BTreeSet<String>,
    blocked: BTreeSet<String>,
    network_declared: bool,
    github: Map<String, Value>,
    sources: BTreeMap<String, BTreeSet<String>>,
}

fn strings(value: &Value) -> Vec<String> {
    match value {
        Value::String(text) => vec![text.clone()],
        Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                item.as_str()
                    .map(str::to_owned)
                    .or_else(|| item.get("name").and_then(Value::as_str).map(str::to_owned))
            })
            .collect(),
        _ => vec![],
    }
}

impl Capabilities {
    /// Adds what `front` declares: the workflow's own (`via` is `None`), then each import's.
    pub fn add(&mut self, front: &Map<String, Value>, via: Option<&str>) {
        if let Some(tools) = front.get("tools").and_then(Value::as_object) {
            self.add_tools(tools, via);
        }
        if let Some(servers) = front.get("mcp-servers").and_then(Value::as_object) {
            for name in servers.keys() {
                self.note("mcp", name, via);
                self.mcp.insert(name.clone());
            }
        }
        self.add_network(front.get("network"), via);
    }

    fn note(&mut self, section: &str, item: &str, via: Option<&str>) {
        let key = format!("{section}:{item}");
        match via {
            None => {
                self.sources.remove(&key);
            }
            Some(import) if !self.declared(section, item) => {
                self.sources.entry(key).or_default().insert(import.to_owned());
            }
            Some(_) => {}
        }
    }

    /// Whether an item is already present, from the workflow or an import.
    fn declared(&self, section: &str, item: &str) -> bool {
        let has = |set: &BTreeSet<String>| set.contains(item);
        let key = format!("{section}:{item}");
        let present = match section {
            "tools" => has(&self.tools),
            "toolsets" => has(&self.toolsets),
            "repos" => self.repos.as_ref().is_some_and(has),
            "bash" => self.bash.as_ref().is_some_and(has),
            "mcp" => has(&self.mcp),
            "network" => has(&self.allowed),
            _ => has(&self.blocked),
        };
        present && !self.sources.contains_key(&key)
    }

    fn add_tools(&mut self, tools: &Map<String, Value>, via: Option<&str>) {
        for (name, value) in tools {
            if SETTINGS.contains(&name.as_str()) || *value == Value::Bool(false) {
                continue;
            }
            self.note("tools", name, via);
            self.tools.insert(name.clone());
        }
        if let Some(github) = tools.get("github").and_then(Value::as_object) {
            self.add_github(github, via);
        } else if tools.get("github").is_some_and(|github| *github != Value::Bool(false)) {
            self.toolsets.insert("default".to_owned());
        }
        match tools.get("bash") {
            None | Some(Value::Bool(false)) => {}
            Some(Value::Array(commands)) => {
                for command in commands.iter().filter_map(Value::as_str) {
                    self.note("bash", command, via);
                    self.bash.get_or_insert_with(BTreeSet::new).insert(command.to_owned());
                }
                self.bash.get_or_insert_with(BTreeSet::new);
            }
            Some(_) => {
                self.note("bash", "*", via);
                self.bash.get_or_insert_with(BTreeSet::new).insert("*".to_owned());
            }
        }
    }

    fn add_github(&mut self, github: &Map<String, Value>, via: Option<&str>) {
        let toolsets = github.get("toolsets").map(strings).unwrap_or_else(|| vec!["default".to_owned()]);
        for toolset in toolsets {
            self.note("toolsets", &toolset, via);
            self.toolsets.insert(toolset);
        }
        if let Some(repos) = github.get("allowed-repos") {
            for repo in strings(repos) {
                self.note("repos", &repo, via);
                self.repos.get_or_insert_with(BTreeSet::new).insert(repo);
            }
        }
        for (key, name) in [
            ("read-only", "readOnly"),
            ("lockdown", "lockdown"),
            ("min-integrity", "minIntegrity"),
            ("mode", "mode"),
        ] {
            if let Some(value) = github.get(key) {
                self.github.entry(name).or_insert_with(|| value.clone());
            }
        }
        if let Some(allowed) = github.get("allowed") {
            let names: Value = strings(allowed).into();
            self.github.entry("allowed").or_insert(names);
        }
    }

    fn add_network(&mut self, network: Option<&Value>, via: Option<&str>) {
        let (allowed, blocked) = match network {
            None => return,
            Some(Value::String(name)) => (vec![name.clone()], vec![]),
            Some(Value::Object(settings)) => (
                settings.get("allowed").map(strings).unwrap_or_default(),
                settings.get("blocked").map(strings).unwrap_or_default(),
            ),
            Some(_) => (vec![], vec![]),
        };
        self.network_declared |= via.is_none();
        for domain in allowed {
            self.note("network", &domain, via);
            self.allowed.insert(domain);
        }
        for domain in blocked {
            self.note("blocked", &domain, via);
            self.blocked.insert(domain);
        }
    }

    /// The capabilities as extraction data, every list sorted. Without a
    /// `network` of its own, a workflow gets gh-aw's `defaults`.
    pub fn finish(mut self) -> Map<String, Value> {
        if !self.network_declared && !self.allowed.contains("defaults") {
            self.allowed.insert("defaults".to_owned());
        }
        let sources: Map<String, Value> = self.sources.into_iter().map(|(key, imports)| (key, json!(imports))).collect();
        let mut data = Map::new();
        data.insert("tools".into(), json!(self.tools));
        data.insert(
            "github".into(),
            json!({"toolsets": self.toolsets, "repos": self.repos, "settings": self.github}),
        );
        data.insert("bash".into(), json!(self.bash));
        data.insert("mcpServers".into(), json!(self.mcp));
        data.insert(
            "network".into(),
            json!({"allowed": self.allowed, "blocked": self.blocked, "declared": self.network_declared}),
        );
        data.insert("sources".into(), Value::Object(sources));
        data
    }
}

/// `permissions` as scope to level: `read-all` and `write-all` as `all`, `null` when the workflow declares none.
pub fn permissions(value: Option<&Value>) -> Value {
    match value {
        None => Value::Null,
        Some(Value::String(level)) => match level.as_str() {
            "read-all" => json!({"all": "read"}),
            "write-all" => json!({"all": "write"}),
            other => json!({"all": other}),
        },
        Some(Value::Object(scopes)) => Value::Object(scopes.iter().map(|(scope, level)| (scope.clone(), level.clone())).collect()),
        Some(other) => other.clone(),
    }
}

#[cfg(test)]
mod tests;
