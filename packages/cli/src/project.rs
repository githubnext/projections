//! The project a command works on: the directory whose `.github/projections`
//! (or `.projections`) holds the definitions, `.projections-bookmarks.json`
//! beside them. It is the repository's root unless a nested directory holds
//! its own: then running from inside it (or `-C` it, or `--root` it) makes it
//! the project, so a monorepo's workspaces can each keep their projections.
//! A definition belongs to its project: the paths inside it (sources,
//! commands, comparator files, renderer bundles, scopes, inputs) are relative
//! to the project, and extractors run there, so a project's definitions move
//! with it. [`resolve`] turns one into a repository-relative path.
//! See docs/runner/execution.md#nested-projects.

use anyhow::{Result, bail, ensure};
use serde_json::Value;
use std::{path::Path, sync::OnceLock};

/// The definition directories, relative to a project.
pub const DIRECTORIES: [&str; 2] = [".github/projections", ".projections"];

/// The bookmarks file, relative to a project.
pub const BOOKMARKS: &str = ".projections-bookmarks.json";

/// The project's directory relative to the repository's root (`opensource`),
/// empty for the root itself. Set once per process.
static PREFIX: OnceLock<String> = OnceLock::new();

/// The project for a command run in `start` of the repository at `toplevel`:
/// `explicit` (`--root`) when given, else the nearest directory from `start`
/// up to `toplevel` that holds a definition directory. Returns its path
/// relative to `toplevel`, `/`-separated; empty for the root.
pub fn choose(toplevel: &Path, start: &Path, explicit: Option<&Path>) -> Result<String> {
    let canonical = |path: &Path| projections_extractor_sdk::canonical(path);
    let toplevel = canonical(toplevel)?;
    if let Some(explicit) = explicit {
        let directory = canonical(explicit)?;
        ensure!(directory.is_dir(), "--root {} is not a directory", explicit.display());
        let Ok(relative) = directory.strip_prefix(&toplevel) else {
            bail!("--root {} is outside the repository {}", explicit.display(), toplevel.display());
        };
        return Ok(slashed(relative));
    }
    let Ok(start) = canonical(start) else {
        return Ok(String::new());
    };
    for directory in start.ancestors() {
        let Ok(relative) = directory.strip_prefix(&toplevel) else {
            break;
        };
        if relative.as_os_str().is_empty() {
            break;
        }
        if DIRECTORIES.iter().any(|name| is_directory(&directory.join(name))) {
            return Ok(slashed(relative));
        }
    }
    Ok(String::new())
}

fn is_directory(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir())
}

fn slashed(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

/// Makes `prefix` this process's project. A second call is ignored.
pub fn set(prefix: String) {
    let _ = PREFIX.set(prefix);
}

/// The project's directory relative to the repository's root; empty for the root.
pub fn prefix() -> &'static str {
    PREFIX.get().map_or("", String::as_str)
}

/// `relative` (a path in the project) relative to the repository's root.
pub fn path(relative: &str) -> String {
    within(prefix(), relative)
}

fn within(prefix: &str, relative: &str) -> String {
    if prefix.is_empty() {
        relative.to_owned()
    } else {
        format!("{prefix}/{relative}")
    }
}

/// `relative`, a path in the project (`..` may climb out of it, never out of
/// the repository), as a repository-relative path; empty for the root.
pub fn resolve(relative: &str) -> Result<String> {
    projections_extractor_sdk::project_path(prefix(), relative)
}

/// Fails, naming the field, when a path a definition declares (its sources,
/// comparator file, renderer bundle or scope) leaves the repository from this
/// project.
pub fn check(definition: &Value) -> Result<()> {
    let mut paths: Vec<(String, &Value)> = Vec::new();
    for component in ["extractor", "comparator", "renderer"] {
        for (index, source) in definition[component]["sources"].as_array().into_iter().flatten().enumerate() {
            paths.push((format!("/{component}/sources/{index}"), source));
        }
    }
    let comparator = &definition["comparator"];
    if comparator.is_string() {
        paths.push(("/comparator".into(), comparator));
    } else if let Some(file) = comparator.get("file") {
        paths.push(("/comparator/file".into(), file));
    }
    if let Some(bundle) = definition["renderer"].get("bundle") {
        paths.push(("/renderer/bundle".into(), bundle));
    }
    for (index, path) in definition["execution"]["scope"].as_array().into_iter().flatten().enumerate() {
        paths.push((format!("/execution/scope/{index}"), path));
    }
    for (pointer, path) in paths {
        let path = path.as_str().unwrap_or_default();
        if resolve(path).is_err() {
            return Err(crate::artifact::FieldError {
                pointer,
                message: format!(
                    "{path} leaves the repository: a definition's paths are relative to its project ({})",
                    if prefix().is_empty() { "the repository's root" } else { prefix() }
                ),
            }
            .into());
        }
    }
    Ok(())
}

/// A definition's custom comparator file, repository-relative, or `None` for
/// the default comparator (or a file outside the repository).
pub fn comparator_file(definition: &Value) -> Option<String> {
    resolve(crate::artifact::custom_comparator(definition)?).ok()
}

/// A definition's custom renderer bundle, repository-relative, or `None` for a
/// built-in renderer.
pub fn renderer_bundle(definition: &Value) -> Result<Option<String>> {
    definition["renderer"]["bundle"].as_str().map(resolve).transpose()
}

/// The project's directory in a revision whose root is `root`.
pub fn directory(root: &Path) -> std::path::PathBuf {
    if prefix().is_empty() {
        root.to_path_buf()
    } else {
        root.join(prefix())
    }
}

/// The project's definition directories, relative to the repository's root.
pub fn directories() -> [String; 2] {
    DIRECTORIES.map(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_nearest_directory_with_definitions_is_the_project() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path();
        std::fs::create_dir_all(root.join(".github/projections")).unwrap();
        std::fs::create_dir_all(root.join("packages/app/.projections")).unwrap();
        std::fs::create_dir_all(root.join("packages/app/src")).unwrap();
        std::fs::create_dir_all(root.join("packages/lib")).unwrap();
        assert_eq!(choose(root, &root.join("packages/app/src"), None).unwrap(), "packages/app");
        assert_eq!(choose(root, &root.join("packages/lib"), None).unwrap(), "");
        assert_eq!(choose(root, root, None).unwrap(), "");
        assert_eq!(choose(root, root, Some(&root.join("packages/lib"))).unwrap(), "packages/lib");
        assert!(choose(root, root, Some(root.parent().unwrap())).is_err());
        assert_eq!(within("packages/app", ".projections"), "packages/app/.projections");
        assert_eq!(within("", ".projections"), ".projections");
    }
}
