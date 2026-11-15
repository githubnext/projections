//! Whether the agent skill is in place and current, for `projections doctor`.

use std::{fs, path::Path};

use super::{NAME, install, written_by};

/// Where the skill is now and the version that wrote it (`None` when init doesn't
/// manage it), for `projections doctor`.
fn find(root: &Path) -> Option<(String, Option<String>)> {
    let directory = install::existing_skill(root)?;
    let path = format!("{directory}/{NAME}/SKILL.md");
    let text = fs::read_to_string(root.join(&path)).ok()?;
    Some((path, written_by(&text)))
}

/// The doctor item's status and message for the skill.
pub fn status(root: &Path) -> (&'static str, String) {
    let version = env!("CARGO_PKG_VERSION");
    match find(root) {
        None => (
            "warn",
            format!(
                "None in {}; projections init writes {}/{NAME}/SKILL.md",
                install::DIRECTORIES
                    .iter()
                    .map(|(directory, _)| *directory)
                    .collect::<Vec<_>>()
                    .join(", "),
                install::DEFAULT
            ),
        ),
        Some((path, Some(written))) if written == version => ("pass", path),
        Some((path, Some(written))) => (
            "warn",
            format!("{path} is from Projections {written}, this CLI is {version}; projections init updates it"),
        ),
        Some((path, None)) => (
            "pass",
            format!("{path} (not written by Projections, so projections init leaves it as it is)"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_finds_the_skill_and_who_wrote_it() {
        let repo = tempfile::tempdir().unwrap();
        let root = repo.path();
        let write = |relative: &str, contents: &str| {
            fs::create_dir_all(root.join(relative).parent().unwrap()).unwrap();
            fs::write(root.join(relative), contents).unwrap();
        };
        assert_eq!(find(root), None);
        assert_eq!(status(root).0, "warn");
        write(
            ".github/skills/projections/SKILL.md",
            "---\nname: projections\nmetadata:\n  projections-version: \"0.0.1\"\n---\n",
        );
        assert_eq!(
            find(root),
            Some((".github/skills/projections/SKILL.md".into(), Some("0.0.1".into())))
        );
        assert!(status(root).1.contains("is from Projections 0.0.1"), "{:?}", status(root));
        write(".agents/skills/projections/SKILL.md", &crate::skill::skill());
        assert_eq!(status(root), ("pass", ".agents/skills/projections/SKILL.md".into()));
        write(".agents/skills/projections/SKILL.md", "theirs\n");
        assert_eq!(find(root), Some((".agents/skills/projections/SKILL.md".into(), None)));
    }
}
