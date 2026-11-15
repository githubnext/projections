//! Vendored and generated code, as `.gitattributes` marks it for GitHub
//! Linguist (`linguist-vendored`, `linguist-generated`): it describes other
//! systems, so it never proposes a projection, and a projection of the whole
//! repository skips it.

use crate::runtime::Runner;
use anyhow::Result;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

/// Exclusion globs a candidate gets at most; the rest are left to the person.
const MAX_EXCLUSIONS: usize = 32;

/// The files among `files` that `.gitattributes` marks vendored or generated.
pub fn marked(runner: &Runner, root: &Path, files: &[String]) -> Result<BTreeSet<String>> {
    let attributes = root.join(".gitattributes").is_file() || files.iter().any(|file| file.ends_with("/.gitattributes"));
    if !attributes {
        return Ok(BTreeSet::new());
    }
    let input = files.join("\0") + "\0";
    let output = runner.git(
        root,
        &["check-attr", "-z", "--stdin", "linguist-vendored", "linguist-generated"],
        Some(input.as_bytes()),
        256 * 1024 * 1024,
    )?;
    Ok(parse(&String::from_utf8_lossy(&output)))
}

/// `git check-attr -z` output (`path NUL attribute NUL value NUL`…): the paths
/// with either attribute set or `true`, as Linguist reads them.
fn parse(output: &str) -> BTreeSet<String> {
    let fields: Vec<&str> = output.split('\0').collect();
    fields
        .chunks_exact(3)
        .filter(|record| record[2] == "set" || record[2] == "true")
        .map(|record| record[0].to_owned())
        .collect()
}

/// Globs that skip the `marked` files among `files`: each marked file's
/// shallowest directory holding nothing else (`dir/**`), else the file itself.
pub fn exclusions(files: &[String], marked: &BTreeSet<String>) -> Vec<String> {
    if marked.is_empty() {
        return Vec::new();
    }
    // Per directory: its files, and how many are marked.
    let mut counts: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
    for file in files {
        let is_marked = marked.contains(file);
        for directory in ancestors(file) {
            let entry = counts.entry(directory).or_default();
            entry.0 += 1;
            entry.1 += usize::from(is_marked);
        }
    }
    let only_marked = |directory: &str| counts.get(directory).is_some_and(|(total, marked)| total == marked);
    let mut globs = BTreeSet::new();
    for file in marked {
        let glob = match ancestors(file).find(|directory| only_marked(directory)) {
            Some(directory) => format!("{directory}/**"),
            None => file.clone(),
        };
        // A glob's own metacharacters can't be escaped, so such paths are left in.
        if !glob.trim_end_matches("/**").contains(['*', '?', '[', ']', '{', '}']) {
            globs.insert(glob);
        }
    }
    globs.into_iter().take(MAX_EXCLUSIONS).collect()
}

/// A path's directories, outermost first: `a/b/c.txt` → `a`, `a/b`.
fn ancestors(file: &str) -> impl Iterator<Item = &str> {
    file.match_indices('/').map(|(index, _)| &file[..index])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_attr_output_marks_set_and_true_values() {
        let output = "a.js\0linguist-vendored\0set\0a.js\0linguist-generated\0unspecified\0b.js\0linguist-vendored\0false\0c.js\0linguist-generated\0true\0";
        assert_eq!(parse(output), BTreeSet::from(["a.js".to_owned(), "c.js".to_owned()]));
    }

    #[test]
    fn marked_trees_collapse_to_their_shallowest_directory() {
        let files: Vec<String> = [
            ".repos/effect/a.ts",
            ".repos/effect/b/c.ts",
            ".repos/alchemy/d.ts",
            "src/index.ts",
            "src/generated/api.ts",
            "src/schema.gen.ts",
        ]
        .map(str::to_owned)
        .to_vec();
        let marked: BTreeSet<String> = files
            .iter()
            .filter(|file| file.starts_with(".repos/") || file.contains("gen"))
            .cloned()
            .collect();
        assert_eq!(exclusions(&files, &marked), [".repos/**", "src/generated/**", "src/schema.gen.ts"]);
        assert!(exclusions(&files, &BTreeSet::new()).is_empty());
    }
}
