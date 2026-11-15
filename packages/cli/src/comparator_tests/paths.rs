//! Paths a test file names, kept inside the repository.

use anyhow::{Context as _, Result, ensure};
use std::path::{Component, Path, PathBuf};

/// `path` relative to `root`, with `/` separators.
pub(super) fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// `path` without `.` and `..` components, lexically.
fn normalized(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
            other => result.push(other),
        }
    }
    result
}

/// The file a test file names (relative to itself), refusing anything
/// outside the repository, lexically and after resolving links.
pub(super) fn inside(root: &Path, tests: &Path, name: &str) -> Result<PathBuf> {
    let directory = tests.parent().context("A test file has a directory")?;
    let path = normalized(&directory.join(name));
    let root = normalized(root);
    ensure!(path.starts_with(&root) && path != root, "{name} is outside the repository");
    // The nearest existing ancestor must resolve inside the repository too.
    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.clone());
    let mut existing = path.as_path();
    while !existing.exists() {
        existing = existing.parent().unwrap_or(&root);
    }
    ensure!(
        existing.canonicalize().is_ok_and(|resolved| resolved.starts_with(&canonical_root)),
        "{name} resolves outside the repository"
    );
    Ok(path)
}
