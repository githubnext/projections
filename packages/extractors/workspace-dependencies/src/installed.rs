//! The installed packages the workspace reaches, their stable identities and
//! the relationships the lockfile records between them.

use crate::Graph;
use crate::declarations::{Declaration, To};
use crate::lockfile::{Installed, Target};
use crate::workspace::Workspace;
use anyhow::Result;
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};

/// Every installed package a workspace reaches, directly or transitively.
pub(crate) fn reached(installed: &[Installed], declarations: &[Declaration]) -> BTreeSet<usize> {
    let mut reached = BTreeSet::new();
    let mut queue: Vec<usize> = declarations
        .iter()
        .filter_map(|declaration| match declaration.to {
            To::Installed(i) => Some(i),
            _ => None,
        })
        .collect();
    while let Some(next) = queue.pop() {
        if reached.insert(next) {
            for dependency in &installed[next].dependencies {
                if let Some(Target::Package(target)) = dependency.target {
                    queue.push(target);
                }
            }
        }
    }
    reached
}

/// The semver-compatible line a package manager unifies versions within: `2`,
/// `0.4` or `0.0.3`.
fn compatible_line(version: &str) -> String {
    let core = version.split(['-', '+']).next().unwrap_or(version);
    let parts: Vec<&str> = core.split('.').collect();
    match parts.as_slice() {
        ["0", "0", patch, ..] => format!("0.0.{patch}"),
        ["0", minor, ..] => format!("0.{minor}"),
        [major, ..] => (*major).to_owned(),
        [] => version.to_owned(),
    }
}

/// Stable IDs for the reached installed packages that leave the version out, so
/// an upgrade is one modified package: `package:<name>`, or, when a name is
/// installed at several versions at once, `package:<name>@<line>` by
/// semver-compatible line, or by full version if two share a line.
pub(crate) fn identities(installed: &[Installed], reached: &BTreeSet<usize>) -> BTreeMap<usize, String> {
    let mut by_name: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for index in reached {
        by_name.entry(&installed[*index].name).or_default().push(*index);
    }
    let mut ids = BTreeMap::new();
    for (name, indexes) in by_name {
        if let [only] = indexes.as_slice() {
            ids.insert(*only, format!("package:{name}"));
            continue;
        }
        let lines: BTreeSet<String> = indexes.iter().map(|i| compatible_line(&installed[*i].version)).collect();
        for index in indexes.iter().copied() {
            let version = &installed[index].version;
            let suffix = if lines.len() == indexes.len() {
                compatible_line(version)
            } else {
                version.clone()
            };
            ids.insert(index, format!("package:{name}@{suffix}"));
        }
    }
    ids
}

/// The reached installed packages as entities, with the dependencies the
/// lockfile records for each.
pub(crate) struct Transitive<'a> {
    pub installed: &'a [Installed],
    pub reached: &'a BTreeSet<usize>,
    pub ids: &'a BTreeMap<usize, String>,
    pub workspace: &'a Workspace,
    pub lockfile_path: Option<&'a str>,
}

impl Transitive<'_> {
    pub(crate) fn relate(&self, graph: &mut Graph) -> Result<()> {
        let evidence = json!([{"kind":"lockfile","source":self.lockfile_path}]);
        for index in self.reached {
            let package = &self.installed[*index];
            let from = &self.ids[index];
            graph.external.insert(
                from.clone(),
                json!({"id":from,"kind":"external-package","label":package.name,
                    "data":{"version":package.version},"confidence":"authoritative","evidence":evidence}),
            );
            for dependency in &package.dependencies {
                // The target's version is its own data, so a transitive relationship
                // changes only when the requested range does.
                let Some((to, name)) = self.target(dependency.target.as_ref(), &dependency.key) else {
                    // Optional dependencies for other platforms are never installed.
                    if dependency.target.is_none() && dependency.kind != "optionalDependencies" {
                        graph.unresolved.push(json!([from, dependency.kind, dependency.key]));
                    }
                    continue;
                };
                let mut data = json!({"type":dependency.kind});
                if let Some(range) = &dependency.range {
                    data["version"] = json!(range);
                }
                if dependency.key != name {
                    data["alias"] = json!(dependency.key);
                }
                let mut relationship = json!({
                    "id":format!("dependency:{}",serde_json::to_string(&json!([from,dependency.kind,dependency.key]))?),
                    "from":from,"to":to,"kind":dependency.kind,"data":data,
                    "confidence":"authoritative","evidence":evidence
                });
                // A relationship's label is optional but never null: a lockfile entry without a range has none.
                if let Some(range) = &dependency.range {
                    relationship["label"] = json!(range);
                }
                graph.relationships.push(relationship);
            }
        }
        Ok(())
    }

    /// The entity a locked dependency points at, and the name of the package
    /// there; `None` when it points nowhere in the graph.
    fn target<'a>(&'a self, target: Option<&Target>, key: &'a str) -> Option<(String, &'a str)> {
        let workspace = self.workspace;
        match target? {
            Target::Package(target) => Some((self.ids[target].clone(), self.installed[*target].name.as_str())),
            Target::Workspace(directory) => workspace
                .by_directory
                .get(directory.as_str())
                .map(|i| (workspace.package_ids[*i].clone(), key)),
            Target::WorkspaceName => workspace.ids.get(key).map(|i| (workspace.package_ids[*i].clone(), key)),
        }
    }
}
