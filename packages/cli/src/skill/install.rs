//! Where `projections init` writes the agent skill, and the link or copy Claude
//! Code reads.
//!
//! The skill goes in one skills directory: `--skills-dir`, else the one that
//! already holds it, else an existing skills directory (the most widely read
//! first), else `.agents/skills`. Agents that read several directories would
//! see two copies, so `init` never writes one beside another: it removes a copy
//! it wrote elsewhere and reports one it didn't. Claude Code reads only
//! `.claude/skills`, so `--claude` links (or, on Windows, copies) the skill
//! there, and later runs keep that copy in sync. Projections manages only the
//! `projections` skill, and only while its front matter records the version
//! that wrote it; other skills are never touched. Which agents read which
//! directory, from each vendor's documentation: docs/setup/agent-skills.md.

use anyhow::{Context, Result, ensure};
use std::{fs, io, path::Path};

use super::{NAME, VERSION_KEY, written_by};

/// The repository skills directories agents read, the most widely read first,
/// and the agents that read each.
pub const DIRECTORIES: &[(&str, &[&str])] = &[
    (".agents/skills", &["GitHub Copilot", "OpenAI Codex", "Cursor", "Gemini CLI"]),
    (".claude/skills", &["Claude Code", "GitHub Copilot", "Cursor"]),
    (".github/skills", &["GitHub Copilot"]),
];
/// Directories a single agent reads, which `--skills-dir` may name.
const SINGLE_AGENT_DIRECTORIES: &[(&str, &[&str])] = &[(".cursor/skills", &["Cursor"]), (".gemini/skills", &["Gemini CLI"])];
pub const DEFAULT: &str = ".agents/skills";
pub const CLAUDE: &str = ".claude/skills";
pub(super) const FILE: &str = "SKILL.md";

/// How `--claude` puts the skill in `.claude/skills`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Claude {
    /// A link where the platform makes one without special rights, else a copy (Windows).
    Auto,
    Link,
    Copy,
}

#[derive(Clone, Debug, Default)]
pub struct Options {
    /// `--skills-dir`, relative to the repository root.
    pub directory: Option<String>,
    pub claude: Option<Claude>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    Created,
    Updated,
    Unchanged,
    /// Left as it is, and why.
    Kept(String),
    /// A link created to this target.
    Linked(String),
    /// A copy init wrote elsewhere, removed so agents see one skill.
    Removed,
}

/// One place the skill is, relative to the repository root.
#[derive(Debug)]
pub struct Placement {
    pub path: String,
    pub action: Action,
    /// The agents that read it there.
    pub agents: Vec<&'static str>,
}

#[derive(Debug, Default)]
pub struct Installed {
    /// The skills directory chosen.
    pub directory: String,
    pub placements: Vec<Placement>,
    pub notes: Vec<String>,
}

/// Writes or updates the skill, and Claude Code's link or copy.
pub fn install(root: &Path, options: &Options) -> Result<Installed> {
    let contents = super::skill();
    let mut installed = Installed::default();
    let directory = match &options.directory {
        Some(directory) => normalize(directory)?,
        None => choose(root, &mut installed.notes),
    };
    let skill = format!("{directory}/{NAME}");
    let action = write_owned(root, &skill, &contents)?;
    let agents = readers(root, &directory);
    if agents.is_empty() {
        installed.notes.push(format!(
            "No agent reads {directory} by default; point yours at it, or use --skills-dir {DEFAULT}"
        ));
    } else {
        let missing: Vec<&str> = DIRECTORIES[0].1.iter().copied().filter(|agent| !agents.contains(agent)).collect();
        if !missing.is_empty() {
            installed.notes.push(format!(
                "{} {} read {directory}; --skills-dir {DEFAULT} moves the skill where they do",
                and_list(&missing),
                if missing.len() == 1 { "doesn't" } else { "don't" }
            ));
        }
    }
    installed.placements.push(Placement {
        path: format!("{skill}/{FILE}"),
        action,
        agents: agents.clone(),
    });
    remove_duplicates(root, &skill, &mut installed)?;
    if agents.contains(&"Claude Code") {
        if options.claude.is_some() {
            installed.notes.push(format!("Claude Code already reads {directory}"));
        }
    } else if let Some(placement) = claude::mirror(root, &skill, options.claude, &contents, &mut installed.notes)? {
        installed.placements.push(placement);
    } else {
        installed.notes.push(format!(
            "Claude Code reads only {CLAUDE}: projections init --claude {} the skill there",
            if cfg!(windows) { "copies" } else { "links" }
        ));
    }
    installed.directory = directory;
    Ok(installed)
}

/// "A, B and C".
pub fn and_list(items: &[&str]) -> String {
    match items {
        [] => String::new(),
        [only] => (*only).to_owned(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

/// `--skills-dir` as a relative path with `/` separators, inside the repository.
fn normalize(directory: &str) -> Result<String> {
    let directory = directory.replace('\\', "/");
    let directory = directory.trim_start_matches("./").trim_end_matches('/');
    ensure!(
        !directory.is_empty()
            && !Path::new(directory).is_absolute()
            && !directory.starts_with('/')
            && !directory.contains(':')
            && directory.split('/').all(|part| !part.is_empty() && part != "." && part != ".."),
        "--skills-dir must be a directory inside the repository, relative to its root (for example {DEFAULT})"
    );
    Ok(directory.to_owned())
}

/// The skills directory to use without `--skills-dir`.
fn choose(root: &Path, notes: &mut Vec<String>) -> String {
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
        [first, ..] => {
            notes.push(format!(
                "Several skills directories exist ({}); chose {first}, which the most agents read",
                existing.join(", ")
            ));
            (*first).to_owned()
        }
    }
}

/// The known skills directory that already holds the skill. A `.claude/skills`
/// copy beside another is Claude Code's mirror, so it comes last.
pub(super) fn existing_skill(root: &Path) -> Option<&'static str> {
    [DEFAULT, ".github/skills", CLAUDE]
        .into_iter()
        .find(|directory| real_directory(root, &format!("{directory}/{NAME}")) && root.join(directory).join(NAME).join(FILE).is_file())
}

/// Whether every component of `relative` is a directory, not a symlink.
pub(super) fn real_directory(root: &Path, relative: &str) -> bool {
    let mut path = root.to_path_buf();
    relative.split('/').all(|part| {
        path.push(part);
        fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_dir() && !metadata.is_symlink())
    })
}

/// The agents that read `directory`: its own and those of the known directories
/// that resolve to it (`.claude/skills` may be a link to `.agents/skills`).
fn readers(root: &Path, directory: &str) -> Vec<&'static str> {
    let target = root.join(directory).canonicalize().ok();
    let mut agents = Vec::new();
    for (known, readers) in DIRECTORIES.iter().chain(SINGLE_AGENT_DIRECTORIES) {
        if *known == directory || (target.is_some() && root.join(known).canonicalize().ok() == target) {
            for agent in *readers {
                if !agents.contains(agent) {
                    agents.push(*agent);
                }
            }
        }
    }
    agents
}

/// Line endings aside, whether a skill file already holds `contents`.
fn same(existing: &str, contents: &str) -> bool {
    existing.replace("\r\n", "\n") == contents
}

/// Writes `<skill>/SKILL.md` unless someone else's skill is there.
pub(super) fn write_owned(root: &Path, skill: &str, contents: &str) -> Result<Action> {
    if fs::symlink_metadata(root.join(skill)).is_ok_and(|metadata| metadata.is_symlink()) {
        return Ok(Action::Kept(format!("{skill} is a symlink, which init doesn't write through")));
    }
    let path = root.join(skill).join(FILE);
    match fs::read_to_string(&path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            crate::scaffold::create(root, &format!("{skill}/{FILE}"), contents)?;
            Ok(Action::Created)
        }
        Err(error) => Err(error).with_context(|| format!("Cannot read {skill}/{FILE}")),
        Ok(existing) if written_by(&existing).is_none() => Ok(Action::Kept(format!(
            "it has no metadata.{VERSION_KEY}, so it isn't Projections' to update"
        ))),
        Ok(existing) if same(&existing, contents) => Ok(Action::Unchanged),
        Ok(_) => {
            ensure!(real_directory(root, skill), "{skill} must be a directory, not a symlink");
            fs::write(&path, contents).with_context(|| format!("Cannot write {skill}/{FILE}"))?;
            Ok(Action::Updated)
        }
    }
}

/// Removes copies init wrote in the other known directories (not Claude Code's
/// mirror), and notes others' copies, so agents that read several see one skill.
fn remove_duplicates(root: &Path, skill: &str, installed: &mut Installed) -> Result<()> {
    let chosen = root.join(skill).canonicalize().ok();
    for (directory, _) in DIRECTORIES {
        let other = format!("{directory}/{NAME}");
        if *directory == CLAUDE || other == skill || !real_directory(root, &other) {
            continue;
        }
        if chosen.is_some() && root.join(&other).canonicalize().ok() == chosen {
            continue;
        }
        let file = root.join(&other).join(FILE);
        let owned = fs::read_to_string(&file).ok().and_then(|text| written_by(&text)).is_some();
        if owned && only_the_skill_file(&root.join(&other)) {
            fs::remove_file(&file).with_context(|| format!("Cannot remove {other}/{FILE}"))?;
            fs::remove_dir(root.join(&other)).with_context(|| format!("Cannot remove {other}"))?;
            installed.placements.push(Placement {
                path: format!("{other}/{FILE}"),
                action: Action::Removed,
                agents: Vec::new(),
            });
        } else {
            installed.notes.push(format!(
                "{other} also holds a projections skill, so agents that read both directories see two; remove one"
            ));
        }
    }
    Ok(())
}

pub(super) fn only_the_skill_file(directory: &Path) -> bool {
    fs::read_dir(directory).is_ok_and(|mut entries| entries.all(|entry| entry.is_ok_and(|entry| entry.file_name() == FILE)))
}

mod claude;
#[cfg(test)]
mod tests;
