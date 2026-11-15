//! How an extractor reads the examined revision: a directory on disk, or Git's
//! object store with nothing on disk.
//!
//! The runner chooses (`repository.mode` in the request). A directory is either
//! a temporary materialization (every file under it belongs to the revision) or
//! a checkout (the user's working tree, read in place, or a workspace), whose
//! revision is what Git lists: tracked and untracked files that aren't ignored.
//! Git objects are read with one `git cat-file --batch` process, on demand.
//! A declared scope narrows the files and refuses reads outside it.

use crate::paths::{path, read_file, relative_path, repository_files};
use anyhow::{Context as _, Result, anyhow, bail, ensure};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

/// One file of the examined revision.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FileEntry {
    /// A symbolic link (its size is its target's length).
    pub symlink: bool,
    /// Its size in bytes.
    pub size: u64,
}

/// Where the examined revision's bytes come from.
pub(crate) enum Reader {
    /// Files under a root. `listed` is true for a checkout, whose revision is
    /// what Git lists there; false for a materialization, which holds only the
    /// revision.
    Directory { root: PathBuf, listed: bool },
    /// Git's object store: the tree and its blobs, nothing on disk.
    Objects(GitObjects),
}

pub(crate) struct GitObjects {
    directory: PathBuf,
    tree: String,
    entries: BTreeMap<String, (String, String, u64)>,
    batch: Mutex<Option<Batch>>,
}

struct Batch {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}

impl Drop for Batch {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Git, configured as the runner configures it: no system or global
/// configuration, hooks, filesystem monitor or replacement objects.
pub(crate) fn git(directory: Option<&Path>, cwd: Option<&Path>, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    if let Some(directory) = directory {
        command.arg("--git-dir").arg(directory);
    }
    command
        .args(["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"])
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", if cfg!(windows) { "NUL" } else { "/dev/null" })
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stderr(Stdio::piped());
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    command
}

fn git_output(mut command: Command) -> Result<Vec<u8>> {
    let output = command
        .stdout(Stdio::piped())
        .output()
        .context("Could not start git, which reading the revision needs")?;
    ensure!(
        output.status.success(),
        "git failed ({}): {}",
        output.status,
        String::from_utf8_lossy(&output.stderr).trim()
    );
    Ok(output.stdout)
}

impl GitObjects {
    pub(crate) fn open(directory: &Path, tree: &str) -> Result<Self> {
        ensure!(
            tree.len() >= 40 && tree.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "repository.git.tree must be a Git object ID"
        );
        let listing = git_output(git(Some(directory), None, &["ls-tree", "-r", "-z", "-l", "--full-tree", tree]))?;
        let mut entries = BTreeMap::new();
        for line in std::str::from_utf8(&listing)
            .context("Git tree paths are not UTF-8")?
            .split('\0')
            .filter(|line| !line.is_empty())
        {
            let (record, name) = line.split_once('\t').context("Invalid Git tree entry")?;
            let parts: Vec<_> = record.split_whitespace().collect();
            ensure!(parts.len() == 4, "Invalid Git tree entry");
            // Submodule gitlinks and other special entries are not files.
            if parts[1] != "blob" || !["100644", "100755", "120000"].contains(&parts[0]) {
                continue;
            }
            entries.insert(name.to_owned(), (parts[0].to_owned(), parts[2].to_owned(), parts[3].parse()?));
        }
        Ok(Self {
            directory: directory.to_path_buf(),
            tree: tree.to_owned(),
            entries,
            batch: Mutex::new(None),
        })
    }

    fn files(&self) -> Vec<String> {
        self.entries.keys().cloned().collect()
    }

    fn blob(&self, object: &str, maximum: usize) -> Result<Vec<u8>> {
        let mut guard = self.batch.lock().map_err(|_| anyhow!("Git reader lock"))?;
        if guard.is_none() {
            let mut child = git(Some(&self.directory), None, &["cat-file", "--batch"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .context("Could not start git, which reading the revision needs")?;
            let input = child.stdin.take().context("git stdin")?;
            let output = BufReader::new(child.stdout.take().context("git stdout")?);
            *guard = Some(Batch { child, input, output });
        }
        let batch = guard.as_mut().expect("batch");
        writeln!(batch.input, "{object}")?;
        batch.input.flush()?;
        let mut header = String::new();
        batch.output.read_line(&mut header)?;
        let parts: Vec<_> = header.split_whitespace().collect();
        ensure!(
            parts.len() == 3 && parts[0] == object && parts[1] == "blob",
            "Git object {object} is missing from the tree {}",
            self.tree
        );
        let size: usize = parts[2].parse()?;
        if size > maximum {
            // Consume it, so the next read stays in step.
            std::io::copy(&mut (&mut batch.output).take(size as u64 + 1), &mut std::io::sink())?;
            bail!("exceeds {maximum} bytes");
        }
        let mut bytes = vec![0; size + 1];
        batch.output.read_exact(&mut bytes)?;
        ensure!(bytes.pop() == Some(b'\n'), "Truncated Git object {object}");
        Ok(bytes)
    }
}

/// Files a checkout's Git lists: tracked and untracked, not ignored, present
/// as regular files or symlinks.
fn checkout_files(root: &Path) -> Result<Vec<String>> {
    let listing = git_output(git(
        None,
        Some(root),
        &["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    ))?;
    let mut files: Vec<String> = std::str::from_utf8(&listing)
        .context("Repository paths are not UTF-8")?
        .split('\0')
        .filter(|name| !name.is_empty() && !name.ends_with('/'))
        // Reads check every path segment for symlinks; listing needs only the entry.
        .filter(|name| std::fs::symlink_metadata(root.join(name)).is_ok_and(|stat| stat.is_file() || stat.file_type().is_symlink()))
        .map(str::to_owned)
        .collect();
    files.sort();
    files.dedup();
    Ok(files)
}

impl Reader {
    pub(crate) fn root(&self) -> Option<&Path> {
        match self {
            Self::Directory { root, .. } => Some(root),
            Self::Objects(_) => None,
        }
    }

    /// The revision's files, sorted by bytes, before the scope applies.
    pub(crate) fn list(&self) -> Result<Vec<String>> {
        match self {
            Self::Directory { root, listed: false } => repository_files(root),
            Self::Directory { root, listed: true } => checkout_files(root),
            Self::Objects(objects) => Ok(objects.files()),
        }
    }

    pub(crate) fn entry(&self, relative: &str) -> Result<FileEntry> {
        match self {
            Self::Directory { root, .. } => {
                let stat = std::fs::symlink_metadata(path(root, relative, true, false)?)?;
                ensure!(stat.is_file() || stat.file_type().is_symlink(), "Not a file: {relative}");
                Ok(FileEntry {
                    symlink: stat.file_type().is_symlink(),
                    size: stat.len(),
                })
            }
            Self::Objects(objects) => {
                let (mode, _, size) = objects
                    .entries
                    .get(relative)
                    .with_context(|| format!("Cannot access extractor input {relative}"))?;
                Ok(FileEntry {
                    symlink: mode == "120000",
                    size: *size,
                })
            }
        }
    }

    pub(crate) fn read(&self, relative: &str, maximum: usize) -> Result<Vec<u8>> {
        match self {
            Self::Directory { root, .. } => read_file(&path(root, relative, false, false)?, maximum),
            Self::Objects(objects) => {
                let (mode, object, _) = objects
                    .entries
                    .get(relative)
                    .with_context(|| format!("Cannot open extractor input {relative}"))?;
                if mode == "120000" {
                    bail!("Not a regular file: {relative}");
                }
                objects
                    .blob(object, maximum)
                    .with_context(|| format!("Cannot read extractor input {relative}"))
            }
        }
    }
}

/// Normalizes a scope path: repository-relative, `/`-separated, no trailing slash.
pub(crate) fn scope_path(value: &str) -> Result<String> {
    let normalized = relative_path(value)?.to_string_lossy().replace('\\', "/");
    ensure!(!normalized.is_empty(), "A scope path must name a file or directory");
    Ok(normalized)
}

/// Whether `relative` is `scope` or inside it.
pub fn within(scope: &[String], relative: &str) -> bool {
    scope
        .iter()
        .any(|path| relative == path || relative.starts_with(&format!("{path}/")))
}
