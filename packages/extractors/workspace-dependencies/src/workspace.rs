//! The workspace's member packages, selected the way the manager selects them,
//! and their stable identities.

use crate::manager::Manager;
use crate::{lockfile, patterns};
use anyhow::{Result, bail, ensure};
use projections_extractor_sdk::{Context, object, strings, text};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub(crate) struct Package {
    /// Directory relative to the workspace root; empty for the root.
    pub directory: String,
    pub manifest_path: String,
    pub manifest: Value,
}

pub(crate) struct Workspace {
    /// The root package first, then members by directory.
    pub packages: Vec<Package>,
    /// Package name to index.
    pub ids: BTreeMap<String, usize>,
    /// Each package's entity ID.
    pub package_ids: Vec<String>,
    /// Directory to package index.
    pub by_directory: BTreeMap<String, usize>,
}

/// The workspace patterns the manager reads: pnpm reads pnpm-workspace.yaml,
/// npm and Yarn read package.json `workspaces`.
pub(crate) fn selection(
    manager: Manager,
    root_manifest: &Value,
    read_text: &dyn Fn(&str) -> Result<Option<String>>,
) -> Result<patterns::Selection> {
    let declared = match manager {
        Manager::Pnpm => pnpm_patterns(read_text)?,
        _ => match root_manifest.get("workspaces") {
            Some(v) if v.is_object() => match v.get("packages") {
                Some(packages) => strings(packages, "package.json workspaces.packages")?,
                None => vec![],
            },
            Some(v) => strings(v, "package.json workspaces")?,
            None => vec![],
        },
    };
    patterns::Selection::new(&declared, manager != Manager::YarnClassic)
}

fn pnpm_patterns(read_text: &dyn Fn(&str) -> Result<Option<String>>) -> Result<Vec<String>> {
    let Some(yaml) = read_text("pnpm-workspace.yaml")? else {
        return Ok(vec![]);
    };
    let value = lockfile::yaml(&yaml, "pnpm-workspace.yaml")?;
    match value.get("packages") {
        Some(v) if !v.is_null() => strings(v, "pnpm-workspace.yaml packages"),
        _ => Ok(vec![]),
    }
}

impl Workspace {
    /// Reads the root package and every selected member's manifest.
    pub(crate) fn read(cx: &Context, files: &[String], base: &str, selection: &patterns::Selection, root: Package) -> Result<Self> {
        let mut directories: Vec<String> = files
            .iter()
            .filter_map(|file| file.strip_prefix(base))
            .filter_map(|file| file.strip_suffix("/package.json"))
            .filter(|directory| !directory.split('/').any(|s| s == "node_modules"))
            .filter(|directory| selection.matches(directory))
            .map(str::to_owned)
            .collect();
        directories.sort();
        let mut packages = vec![root];
        for directory in directories {
            let manifest_path = format!("{base}{directory}/package.json");
            let manifest = cx.read_json(&manifest_path)?;
            object(&manifest, &manifest_path)?;
            packages.push(Package {
                directory,
                manifest_path,
                manifest,
            });
        }
        let (ids, package_ids) = identities(&packages)?;
        let by_directory = packages.iter().enumerate().map(|(i, p)| (p.directory.clone(), i)).collect();
        Ok(Self {
            packages,
            ids,
            package_ids,
            by_directory,
        })
    }

    pub(crate) fn version(&self, index: usize) -> Option<String> {
        self.packages[index].manifest["version"].as_str().map(str::to_owned)
    }

    pub(crate) fn entities(&self) -> Vec<Value> {
        self.packages
            .iter()
            .zip(&self.package_ids)
            .map(|(package, id)| {
                let label = package.manifest["name"].as_str().unwrap_or("(workspace root)");
                let mut data = json!({"workspaceMember":true,"path":if package.directory.is_empty() {"."} else {&package.directory}});
                if let Some(version) = package.manifest["version"].as_str() {
                    data["version"] = json!(version);
                }
                json!({"id":id,"kind":"package","label":label,"data":data,"confidence":"authoritative",
                    "evidence":[{"kind":"manifest","source":package.manifest_path}]})
            })
            .collect()
    }
}

/// Package identity is its name; versions are data.
fn identities(packages: &[Package]) -> Result<(BTreeMap<String, usize>, Vec<String>)> {
    let mut ids: BTreeMap<String, usize> = BTreeMap::new();
    let mut package_ids = vec![];
    for (index, package) in packages.iter().enumerate() {
        let name = match package.manifest.get("name") {
            Some(v) if !v.is_null() => Some(text(v, &format!("{}: name", package.manifest_path))?),
            _ => None,
        };
        let id = match name {
            Some(name) => {
                ensure!(
                    ids.insert(name.to_owned(), index).is_none(),
                    "Duplicate workspace package name \"{name}\" ({})",
                    package.manifest_path
                );
                // Workspace members and external packages have distinct prefixes, so a
                // member can never be mistaken for a registry package of the same name.
                format!("workspace:{name}")
            }
            None if index == 0 => "workspace-root".to_owned(),
            None => bail!("{}: workspace package must have a name for stable identity", package.manifest_path),
        };
        package_ids.push(id);
    }
    Ok((ids, package_ids))
}
