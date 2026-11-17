//! Which skills directory the skill goes in without `--skills-dir`.

use super::{DEFAULT, DIRECTORIES, FILE, existing_skill, real_directory};
use crate::skill::NAME;
use std::{fs, path::Path};

/// The skills directory to use without `--skills-dir`.
pub(super) fn choose(root: &Path, notes: &mut Vec<String>) -> String {
    if let Some(directory) = existing_skill(root) {
        return directory.to_owned();
    }
    let existing: Vec<&str> = DIRECTORIES
        .iter()
        .map(|(directory, _)| *directory)
        .filter(|directory| real_directory(root, directory))
        .collect();
    match existing.as_slice() {
        [] => DEFAULT.to_owned(),
        [only] => (*only).to_owned(),
        several => {
            // The repository's convention: the directory holding the most of
            // its own skills, the most widely read of those that tie.
            let counts: Vec<usize> = several.iter().map(|directory| skills(root, directory)).collect();
            let most = counts.iter().copied().max().unwrap_or(0);
            let chosen = several[counts.iter().position(|count| *count == most).unwrap_or(0)];
            let why = match counts.iter().filter(|count| **count == most).count() {
                _ if most == 0 => "which the most agents read",
                1 => "which holds the most of this repository's skills",
                _ => "which holds as many of this repository's skills as any and the most agents read",
            };
            notes.push(format!(
                "Several skills directories exist ({}); chose {chosen}, {why}",
                several.join(", ")
            ));
            chosen.to_owned()
        }
    }
}

/// The skills other than Projections' in `directory`: subdirectories holding a `SKILL.md`.
fn skills(root: &Path, directory: &str) -> usize {
    fs::read_dir(root.join(directory)).map_or(0, |entries| {
        entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name() != NAME && entry.path().join(FILE).is_file())
            .count()
    })
}
