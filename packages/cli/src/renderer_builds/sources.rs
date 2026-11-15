//! Where a custom renderer's package and sources are, the script that builds
//! it, and a fingerprint of its sources.

use std::{path::Path, time::SystemTime};

use serde_json::Value;

/// A path a definition declares (relative to its project), repository-relative.
fn relative(path: &Value) -> Option<String> {
    let path = path.as_str()?;
    if path.is_empty() || path.starts_with('/') {
        return None;
    }
    crate::project::resolve(path).ok().filter(|path| !path.is_empty())
}

/// The package a custom renderer's bundle is built from: the bundle's
/// directory's parent when the bundle is a `dist` directory, as
/// `projections init --renderer custom` scaffolds it.
pub fn renderer_package(definition: &Value) -> Option<String> {
    let bundle = relative(&definition["renderer"]["bundle"])?;
    let mut parts: Vec<&str> = bundle.split('/').collect();
    if parts.pop() != Some("dist") {
        return None;
    }
    Some(if parts.is_empty() { ".".to_owned() } else { parts.join("/") })
}

/// The renderer's sources, repository-relative: its declared `sources` (relative
/// to its project), else its package's `src`.
pub fn renderer_sources(definition: &Value) -> Vec<String> {
    let declared: Vec<String> = definition["renderer"]["sources"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(relative)
        .collect();
    if !declared.is_empty() {
        return declared;
    }
    renderer_package(definition)
        .map(|package| {
            vec![if package == "." {
                "src".to_owned()
            } else {
                format!("{package}/src")
            }]
        })
        .unwrap_or_default()
}

/// The script that builds it: `watch` (started once, rebuilding on every save), else `build`.
pub fn build_script(scripts: &Value) -> Option<(&'static str, bool)> {
    if scripts["watch"].is_string() {
        Some(("watch", true))
    } else if scripts["build"].is_string() {
        Some(("build", false))
    } else {
        None
    }
}

/// The newest modification time and the count of files under the given
/// repository-relative paths, skipping dependencies and build output.
pub(super) fn fingerprint(root: &Path, paths: &[String]) -> (Option<SystemTime>, usize) {
    let mut newest = None;
    let mut count = 0;
    let mut budget = 2000;
    fn visit(path: &Path, newest: &mut Option<SystemTime>, count: &mut usize, budget: &mut usize) {
        if *budget == 0 {
            return;
        }
        *budget -= 1;
        let Ok(metadata) = std::fs::symlink_metadata(path) else {
            return;
        };
        if metadata.is_file() {
            *count += 1;
            let modified = metadata.modified().ok();
            if modified > *newest {
                *newest = modified;
            }
        } else if metadata.is_dir() {
            let mut entries: Vec<_> = std::fs::read_dir(path).into_iter().flatten().filter_map(Result::ok).collect();
            entries.sort_by_key(std::fs::DirEntry::file_name);
            for entry in entries {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name != "node_modules" && name != "dist" && !name.starts_with('.') {
                    visit(&entry.path(), newest, count, budget);
                }
            }
        }
    }
    for path in paths {
        visit(&root.join(path), &mut newest, &mut count, &mut budget);
    }
    (newest, count)
}
