//! Reading fixture files: bounded reads, JSON and bounded text, local
//! authoring paths and lexical paths, and short digests of what was read.

use anyhow::{Context, Result, ensure};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};

use crate::artifact::{self, text};

pub(super) fn short_sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))[..16].to_owned()
}

/// Removes `.` and resolves `..` lexically, for paths that may not exist yet.
pub(super) fn lexical(path: &Path) -> PathBuf {
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

/// A local authoring path relative to the scenarios file. Unlike repository
/// paths, `..` is allowed.
pub(super) fn local_path<'a>(value: &'a Value, label: &str) -> Result<&'a str> {
    let path = text(value, label)?;
    ensure!(
        path.len() <= 1024
            && !path.starts_with('/')
            && !path.chars().any(|character| character.is_control() || "\\:".contains(character))
            && path.split('/').all(|part| !part.is_empty()),
        "{label} must be a relative path without URL schemes or backslashes"
    );
    Ok(path)
}

pub(super) fn bounded_text<'a>(value: &'a Value, label: &str, maximum: usize) -> Result<&'a str> {
    let value = text(value, label)?;
    ensure!(value.chars().count() <= maximum, "{label} must be at most {maximum} characters");
    Ok(value)
}

pub(super) fn json_text(bytes: &[u8], label: &str) -> Result<Value> {
    artifact::parse(std::str::from_utf8(bytes).with_context(|| format!("{label} must be UTF-8"))?)
}

pub(super) fn read(path: &Path, maximum: usize) -> Result<Vec<u8>> {
    ensure!(std::fs::symlink_metadata(path).is_ok(), "{} does not exist", path.display());
    artifact::read_artifact(path, maximum)
}
