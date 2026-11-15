//! Resolved Cargo metadata.

use anyhow::{Context as _, Result, ensure};
use projections_extractor_sdk::{
    Context, Descriptor, Trust, array, extraction, input, key, object, path, percent, read_json, relationship, run, stable, strings, text,
    unique_relationships,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

pub const ID: &str = "cargo-dependencies";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Cargo dependencies",
        description: "Resolved Cargo metadata",
        schema: "graph/v0",
        renderer: "dependencies",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({"metadataPath":"Pre-exported cargo metadata JSON; otherwise runs Cargo","manifestPath":"Cargo.toml path; default Cargo.toml","cargoPath":"Cargo executable"}),
        template_inputs: None,
        detects: &["Cargo.toml", "**/Cargo.toml"],
    }
}

pub fn requires_trust(inputs: &Value) -> bool {
    inputs.get("metadataPath").is_none()
}

pub fn collect(cx: &Context) -> Result<Value> {
    let (root, definition) = (cx.root(), cx.definition());
    cargo(root, definition, cx)
}

fn cargo(root: &Path, d: &Value, cx: &Context) -> Result<Value> {
    let declared = match d["inputs"].get("metadataPath") {
        Some(_) => input(d, "metadataPath", None)?,
        None => input(d, "manifestPath", Some("Cargo.toml"))?,
    };
    // A revision without the declared metadata or manifest (before it was added) has no packages.
    if !cx.input_exists(declared)? {
        return Ok(extraction(
            "graph/v0",
            vec![],
            vec![],
            Some(json!({"source":"cargo metadata","effective":true})),
        ));
    }
    let model = if d["inputs"].get("metadataPath").is_some() {
        read_json(root, declared)?
    } else {
        let manifest = path(root, declared, false, false)?;
        run(
            cx,
            root,
            vec![
                input(d, "cargoPath", Some("cargo"))?.into(),
                "metadata".into(),
                "--format-version".into(),
                "1".into(),
                "--manifest-path".into(),
                manifest.to_string_lossy().into_owned(),
            ],
            None,
            BTreeMap::new(),
        )?
    };
    ensure!(model["version"] == 1, "Unsupported Cargo metadata version; expected version 1");
    let workspace = text(&model["workspace_root"], "workspace_root")?;
    let mut packages = vec![];
    for p in array(&model["packages"], "Cargo packages")? {
        let source = if p["source"].is_null() {
            "local"
        } else {
            text(&p["source"], "package.source")?
        };
        let place = if source == "local" {
            let manifest = text(&p["manifest_path"], "package.manifest_path")?;
            workspace_relative(workspace, Path::new(manifest).parent().unwrap_or(Path::new("")))
        } else {
            String::new()
        };
        packages.push(Package {
            id: text(&p["id"], "package.id")?,
            name: text(&p["name"], "package.name")?,
            version: text(&p["version"], "package.version")?,
            source,
            place,
        });
    }
    let identities = package_identities(&packages)?;
    let mut ids = BTreeMap::new();
    let mut nodes = vec![];
    for (
        Package {
            id: package_id,
            name,
            version,
            source,
            ..
        },
        id,
    ) in packages.iter().zip(identities)
    {
        ensure!(
            ids.insert((*package_id).to_owned(), id.clone()).is_none(),
            "Duplicate Cargo package ID"
        );
        nodes.push(json!({"id":id,"kind":"package","label":name,"data":{"version":version,"source":source},"confidence":"authoritative"}));
    }
    object(&model["resolve"], "Cargo resolve (a resolved metadata graph is required)")?;
    let mut edges = vec![];
    for n in array(&model["resolve"]["nodes"], "Cargo resolve.nodes")? {
        let from = ids
            .get(text(&n["id"], "resolve node.id")?)
            .context("Cargo resolve references an unknown package")?;
        for dep in array(&n["deps"], "Cargo resolve node.deps")? {
            let to = ids
                .get(text(&dep["pkg"], "dependency.pkg")?)
                .context("Cargo dependency references an unknown package")?;
            let mut kinds = vec![];
            for raw in array(&dep["dep_kinds"], "dependency.dep_kinds")? {
                object(raw, "dependency kind")?;
                let kind = if raw["kind"].is_null() {
                    "normal"
                } else {
                    text(&raw["kind"], "dependency kind")?
                };
                let target = if raw["target"].is_null() {
                    Value::Null
                } else {
                    json!(text(&raw["target"], "dependency target")?)
                };
                kinds.push(json!({"kind":kind,"target":target}));
            }
            kinds.sort_by_key(stable);
            let name = text(&dep["name"], "dependency.name")?;
            let mut e = relationship("depends-on", from, to);
            e["id"] = json!(key(&["depends-on", from, to, name]));
            e["data"] = json!({"name":name,"kinds":kinds});
            edges.push(e);
        }
    }
    let mut members = BTreeSet::new();
    for id in strings(&model["workspace_members"], "workspace_members")? {
        members.insert(ids.get(&id).context("Cargo workspace references an unknown package")?.clone());
    }
    for node in &mut nodes {
        node["data"]["workspaceMember"] = json!(members.contains(node["id"].as_str().unwrap()));
    }
    Ok(extraction(
        "graph/v0",
        nodes,
        unique_relationships(edges),
        Some(json!({
            "source":"cargo metadata","effective":true,
            "limitations":["Cargo resolve includes target-specific dependency conditions; it is not a single-target build graph."]
        })),
    ))
}

/// Where a package comes from, without what selects its version: a Git source's
/// requested revision (`?rev=`, `?branch=`, `?tag=`) and resolved commit (`#...`).
fn source_identity(source: &str) -> &str {
    let end = source.find(['?', '#']).unwrap_or(source.len());
    &source[..end]
}

/// The semver-compatible line Cargo unifies versions within: `2`, `0.4` or `0.0.3`.
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

/// Stable package IDs that leave the version out, so a version bump is one
/// modified package. Packages that resolve to several versions at once are told
/// apart by their semver-compatible line, then by their full version.
/// One resolved package. `place` is a local package's workspace-relative directory.
struct Package<'a> {
    id: &'a str,
    name: &'a str,
    version: &'a str,
    source: &'a str,
    place: String,
}

/// `directory` relative to `workspace`, with `/` separators; `..` segments when it
/// lies outside, as a path dependency may.
fn workspace_relative(workspace: &str, directory: &Path) -> String {
    let workspace: Vec<_> = Path::new(workspace).components().collect();
    let directory: Vec<_> = directory.components().collect();
    let common = workspace.iter().zip(&directory).take_while(|(a, b)| a == b).count();
    let mut parts = vec!["..".to_owned(); workspace.len() - common];
    parts.extend(
        directory[common..]
            .iter()
            .map(|part| part.as_os_str().to_string_lossy().into_owned()),
    );
    if parts.is_empty() { ".".into() } else { parts.join("/") }
}

fn package_identities(packages: &[Package]) -> Result<Vec<String>> {
    let base = |p: &Package| key(&["cargo", p.name, source_identity(p.source)]);
    let mut groups: BTreeMap<String, usize> = BTreeMap::new();
    for package in packages {
        *groups.entry(base(package)).or_default() += 1;
    }
    let lines: BTreeMap<String, BTreeSet<String>> =
        packages
            .iter()
            .filter(|p| groups[&base(p)] > 1)
            .fold(BTreeMap::new(), |mut lines, p| {
                lines.entry(base(p)).or_default().insert(compatible_line(p.version));
                lines
            });
    let mut seen = BTreeSet::new();
    let mut result = vec![];
    for package @ Package { name, version, source, .. } in packages {
        let id = base(package);
        let id = match lines.get(&id) {
            None => id,
            // Local packages that share a name are told apart by where they live,
            // which, unlike their versions, is how the workspace distinguishes them.
            Some(_) if *source == "local" => format!("{id}@{}", percent(&package.place)),
            Some(distinct) if distinct.len() == groups[&id] => {
                format!("{id}@{}", percent(&compatible_line(version)))
            }
            Some(_) => format!("{id}@{}", percent(version)),
        };
        ensure!(
            seen.insert(id.clone()),
            "Cargo resolved {name} {version} more than once from {source}"
        );
        result.push(id);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pkg<'a>(name: &'a str, version: &'a str, source: &'a str) -> Package<'a> {
        Package {
            id: "",
            name,
            version,
            source,
            place: String::new(),
        }
    }

    fn local<'a>(name: &'a str, place: &str) -> Package<'a> {
        Package {
            id: "",
            name,
            version: "0.1.0",
            source: "local",
            place: place.into(),
        }
    }

    #[test]
    fn ids_leave_out_versions_and_git_revisions() {
        let crates = "registry+https://github.com/rust-lang/crates.io-index";
        let ids = package_identities(&[
            pkg("serde", "1.0.200", crates),
            pkg("syn", "1.0.109", crates),
            pkg("syn", "2.0.60", crates),
            pkg("rand", "0.8.5", crates),
            pkg("rand", "0.9.0", crates),
            pkg("tool", "0.1.0", "git+https://github.com/o/tool?rev=abc#0123456789"),
            pkg("app", "0.1.0", "local"),
        ])
        .unwrap();
        let registry = percent(crates);
        assert_eq!(
            ids,
            [
                format!("cargo:serde:{registry}"),
                format!("cargo:syn:{registry}@1"),
                format!("cargo:syn:{registry}@2"),
                format!("cargo:rand:{registry}@0.8"),
                format!("cargo:rand:{registry}@0.9"),
                format!("cargo:tool:{}", percent("git+https://github.com/o/tool")),
                "cargo:app:local".to_owned(),
            ]
        );
        let bumped = package_identities(&[pkg("serde", "2.0.0", crates)]).unwrap();
        assert_eq!(bumped[0], ids[0]);
        let same_line = package_identities(&[
            pkg("x", "1.0.0", "git+https://e/x?rev=1#1"),
            pkg("x", "1.2.0", "git+https://e/x?rev=2#2"),
        ])
        .unwrap();
        assert!(same_line[0].ends_with("@1.0.0") && same_line[1].ends_with("@1.2.0"));
        assert!(
            package_identities(&[
                pkg("x", "1.0.0", "git+https://e/x?rev=1#1"),
                pkg("x", "1.0.0", "git+https://e/x?rev=2#2"),
            ])
            .is_err()
        );
    }

    #[test]
    fn local_packages_sharing_a_name_are_told_apart_by_their_directory() {
        let ids = package_identities(&[local("util", "crates/a/util"), local("util", "crates/b/util"), local("app", ".")]).unwrap();
        assert_eq!(
            ids,
            [
                "cargo:util:local@crates%2Fa%2Futil",
                "cargo:util:local@crates%2Fb%2Futil",
                "cargo:app:local"
            ]
        );
        assert_eq!(workspace_relative("/w", Path::new("/w/crates/a")), "crates/a");
        assert_eq!(workspace_relative("/w", Path::new("/w")), ".");
        assert_eq!(workspace_relative("/w/ws", Path::new("/w/vendor/x")), "../vendor/x");
    }
}
