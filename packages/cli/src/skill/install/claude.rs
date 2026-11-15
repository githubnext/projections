//! Claude Code's copy of the skill: `.claude/skills/projections`, a relative
//! symlink to the skill or, on Windows or with `--claude copy`, a copy that every
//! run of `init` keeps in sync.

use anyhow::{Context, Result, bail, ensure};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

use super::{Action, CLAUDE, Claude, FILE, Placement, only_the_skill_file, real_directory, write_owned};
use crate::skill::{NAME, written_by};

fn claude_placement(path: String, action: Action) -> Placement {
    Placement {
        path,
        action,
        agents: vec!["Claude Code"],
    }
}

/// Claude Code's `.claude/skills/projections`: created with `--claude`, and kept
/// in sync (a copy rewritten, a link checked) whenever it exists.
pub(super) fn mirror(
    root: &Path,
    skill: &str,
    claude: Option<Claude>,
    contents: &str,
    notes: &mut Vec<String>,
) -> Result<Option<Placement>> {
    let mirror = format!("{CLAUDE}/{NAME}");
    let path = root.join(&mirror);
    let target = format!("../../{skill}");
    let metadata = match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let Some(mode) = claude else { return Ok(None) };
            ensure_directory(root, CLAUDE)?;
            return create_mirror(root, skill, mode, contents, notes).map(Some);
        }
        Err(error) => return Err(error).with_context(|| format!("Cannot read {mirror}")),
        Ok(metadata) => metadata,
    };
    ensure!(real_directory(root, CLAUDE), "{CLAUDE} must be a directory, not a symlink");
    if metadata.is_symlink() {
        let resolved = path.canonicalize().ok();
        if resolved.is_none() || resolved != root.join(skill).canonicalize().ok() {
            return Ok(Some(claude_placement(
                mirror,
                Action::Kept("it links somewhere other than the skill".into()),
            )));
        }
        if claude == Some(Claude::Copy) {
            remove_link(&path).with_context(|| format!("Cannot remove {mirror}"))?;
            return create_mirror(root, skill, Claude::Copy, contents, notes).map(Some);
        }
        return Ok(Some(claude_placement(format!("{mirror} → {target}"), Action::Unchanged)));
    }
    if metadata.is_file() {
        // A symlink checked out where Git doesn't make symlinks (core.symlinks false, Windows' default).
        let checked_out_link = fs::read_to_string(&path).is_ok_and(|text| text.trim() == target);
        if checked_out_link && claude == Some(Claude::Copy) {
            fs::remove_file(&path).with_context(|| format!("Cannot remove {mirror}"))?;
            return create_mirror(root, skill, Claude::Copy, contents, notes).map(Some);
        }
        let why = if checked_out_link {
            "it is a symlink checked out as a file (Git's core.symlinks is off), which Claude Code can't read; --claude copy replaces it with a copy"
        } else {
            "it is a file, not a skill directory"
        };
        return Ok(Some(claude_placement(mirror, Action::Kept(why.into()))));
    }
    let file = path.join(FILE);
    let owned = fs::read_to_string(&file).ok().and_then(|text| written_by(&text)).is_some();
    if owned && claude == Some(Claude::Link) && only_the_skill_file(&path) {
        fs::remove_file(&file).with_context(|| format!("Cannot remove {mirror}/{FILE}"))?;
        fs::remove_dir(&path).with_context(|| format!("Cannot remove {mirror}"))?;
        return create_mirror(root, skill, Claude::Link, contents, notes).map(Some);
    }
    let action = write_owned(root, &mirror, contents)?;
    if !matches!(action, Action::Kept(_)) {
        notes.push(format!("{mirror} is a copy of {skill}; init keeps it in sync"));
    }
    Ok(Some(claude_placement(format!("{mirror}/{FILE}"), action)))
}

/// Links `.claude/skills/projections` to the skill, or copies it there.
fn create_mirror(root: &Path, skill: &str, mode: Claude, contents: &str, notes: &mut Vec<String>) -> Result<Placement> {
    let mirror = format!("{CLAUDE}/{NAME}");
    let target = format!("../../{skill}");
    if mode == Claude::Link || (mode == Claude::Auto && !cfg!(windows)) {
        match symlink_directory(&target, &root.join(&mirror)) {
            Ok(()) => {
                return Ok(claude_placement(format!("{mirror} → {target}"), Action::Linked(target)));
            }
            Err(error) => notes.push(format!("Couldn't link {mirror} ({error}), so wrote a copy instead")),
        }
    }
    crate::scaffold::create(root, &format!("{mirror}/{FILE}"), contents)?;
    notes.push(format!("{mirror} is a copy of {skill}; init keeps it in sync"));
    Ok(claude_placement(format!("{mirror}/{FILE}"), Action::Created))
}

/// Creates `relative` and its parents as real directories.
fn ensure_directory(root: &Path, relative: &str) -> Result<()> {
    let mut path = PathBuf::from(root);
    for part in relative.split('/') {
        path.push(part);
        match fs::create_dir(&path) {
            Ok(()) => (),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
            Err(error) => return Err(error).with_context(|| format!("Cannot create {relative}")),
        }
        if !fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_dir() && !metadata.is_symlink()) {
            bail!("{} must be a directory, not a symlink", path.display());
        }
    }
    Ok(())
}

#[cfg(unix)]
fn symlink_directory(target: &str, link: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn symlink_directory(target: &str, link: &Path) -> io::Result<()> {
    std::os::windows::fs::symlink_dir(target.replace('/', "\\"), link)
}

#[cfg(not(any(unix, windows)))]
fn symlink_directory(_target: &str, _link: &Path) -> io::Result<()> {
    Err(io::ErrorKind::Unsupported.into())
}

/// Removes a symlink; Windows removes a directory symlink as a directory.
fn remove_link(path: &Path) -> io::Result<()> {
    fs::remove_file(path).or_else(|_| fs::remove_dir(path))
}
