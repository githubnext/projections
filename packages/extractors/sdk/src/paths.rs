use crate::{parse_json, strings};
use anyhow::{Context, Result, bail, ensure};
use regex::Regex;
use serde_json::Value;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn relative_path(relative: &str) -> Result<PathBuf> {
    ensure!(
        !relative.contains('\0')
            && !relative.starts_with('/')
            && !relative.starts_with('\\')
            && !(relative.as_bytes().get(1) == Some(&b':')),
        "Path must stay within the repository: {relative}"
    );
    let normalized = relative.replace('\\', "/");
    let p = Path::new(&normalized);
    ensure!(
        !p.is_absolute()
            && !p
                .components()
                .any(|c| matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_))),
        "Path must stay within the repository: {relative}"
    );
    Ok(p.components().filter(|c| !matches!(c, Component::CurDir)).collect())
}

/// `relative`, a path in the project `project` (repository-relative, empty for
/// the repository's root), as a repository-relative `/`-separated path, joined
/// lexically: `.` and empty segments drop, and each `..` climbs one directory,
/// out of the project if it must, but never out of the repository. The project
/// itself is `project`; the repository's root is empty.
pub fn project_path(project: &str, relative: &str) -> Result<String> {
    for path in [project, relative] {
        ensure!(
            !path.contains('\0') && !path.starts_with(['/', '\\']) && path.as_bytes().get(1) != Some(&b':'),
            "Path must stay within the repository: {relative}"
        );
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in project.split(['/', '\\']).chain(relative.split(['/', '\\'])) {
        match part {
            "" | "." => {}
            ".." => {
                ensure!(parts.pop().is_some(), "Path must stay within the repository: {relative}");
            }
            part => parts.push(part),
        }
    }
    Ok(parts.join("/"))
}

pub fn path(root: &Path, relative: &str, allow_final_symlink: bool, allow_missing: bool) -> Result<PathBuf> {
    let relative_path = relative_path(relative)?;
    let components: Vec<_> = relative_path.components().collect();
    let mut cursor = root.to_path_buf();
    for (i, segment) in components.iter().enumerate() {
        cursor.push(segment.as_os_str());
        match fs::symlink_metadata(&cursor) {
            Ok(stat) => {
                ensure!(
                    !stat.file_type().is_symlink() || (allow_final_symlink && i + 1 == components.len()),
                    "Extractor input may not traverse symlinks: {relative}"
                );
                if i + 1 < components.len() {
                    ensure!(stat.is_dir(), "Extractor input parent must be a directory: {relative}");
                }
            }
            Err(e) if allow_missing && e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(e).with_context(|| format!("Cannot access extractor input {relative}"));
            }
        }
    }
    Ok(cursor)
}

/// Every regular file and symlink below `root` as repository-relative POSIX paths in
/// byte order, which is Git's index order. Directories are walked without
/// following symlinks.
pub fn repository_files(root: &Path) -> Result<Vec<String>> {
    fn walk(directory: &Path, prefix: &str, files: &mut Vec<String>) -> Result<()> {
        for entry in fs::read_dir(directory).with_context(|| format!("Cannot list {}", directory.display()))? {
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|name| anyhow::anyhow!("Repository path is not UTF-8: {name:?}"))?;
            let relative = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
            let kind = entry.file_type()?;
            if kind.is_dir() {
                walk(&entry.path(), &relative, files)?;
            } else if kind.is_file() || kind.is_symlink() {
                files.push(relative);
            }
        }
        Ok(())
    }
    let mut files = vec![];
    walk(root, "", &mut files)?;
    files.sort();
    Ok(files)
}

/// Reads a bounded regular file without following a final symlink.
pub fn read_file(path: &Path, max_bytes: usize) -> Result<Vec<u8>> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    // FILE_FLAG_OPEN_REPARSE_POINT opens a symlink or junction itself, which then
    // fails the regular-file check.
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000);
    }
    let file = options.open(path).with_context(|| format!("Cannot open {}", path.display()))?;
    let metadata = file.metadata()?;
    ensure!(metadata.is_file(), "Not a regular file: {}", path.display());
    ensure!(metadata.len() <= max_bytes as u64, "{} exceeds {max_bytes} bytes", path.display());
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut std::io::Read::take(file, max_bytes as u64 + 1), &mut bytes)?;
    ensure!(
        bytes.len() <= max_bytes,
        "{} exceeded {max_bytes} bytes while reading",
        path.display()
    );
    Ok(bytes)
}

pub fn read_source(root: &Path, relative: &str) -> Result<String> {
    let p = path(root, relative, false, false)?;
    let content = read_file(&p, 32 * 1024 * 1024)?;
    String::from_utf8(content).with_context(|| format!("Cannot read UTF-8 extractor input {relative}"))
}

pub fn read_json(root: &Path, relative: &str) -> Result<Value> {
    parse_json(&read_source(root, relative)?).with_context(|| format!("Cannot read JSON input {relative}"))
}

// These globs intentionally match the original extractor grammar, not shell braces/classes.
pub fn glob(pattern: &str) -> Result<Regex> {
    let mut source = String::from("^");
    let mut chars = pattern.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '*' if chars.peek() == Some(&'*') => {
                chars.next();
                if chars.peek() == Some(&'/') {
                    chars.next();
                    source.push_str("(?:.*/)?");
                } else {
                    source.push_str(".*");
                }
            }
            '*' => source.push_str("[^/]*"),
            '?' => source.push_str("[^/]"),
            _ => source.push_str(&regex::escape(&c.to_string())),
        }
    }
    source.push('$');
    Ok(Regex::new(&source)?)
}

pub fn globs(value: Option<&Value>, label: &str) -> Result<Vec<Regex>> {
    match value {
        None => Ok(vec![]),
        Some(v) => strings(v, label)?.iter().map(|s| glob(s)).collect(),
    }
}

pub fn parent(file: &str) -> &str {
    file.rsplit_once('/').map(|(p, _)| p).filter(|s| !s.is_empty()).unwrap_or(".")
}

pub fn basename(file: &str) -> &str {
    file.rsplit('/').next().unwrap_or(file)
}

/// A private build directory inside the examined revision, removed on drop.
pub struct Scratch(pub PathBuf);

impl Scratch {
    pub fn new(root: &Path, kind: &str) -> Result<Self> {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        for attempt in 0..100 {
            let directory = root.join(format!(".projections-{kind}-{}-{stamp}-{attempt}", std::process::id()));
            match fs::create_dir(&directory) {
                Ok(()) => return Ok(Self(directory)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.into()),
            }
        }
        bail!("Cannot allocate private extractor build directory")
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// [`fs::canonicalize`], without the `\\?\` verbatim prefix Windows adds whenever the
/// ordinary spelling denotes the same path. Tools such as MSBuild can't expand
/// wildcards under verbatim paths, so every path handed to a tool uses this.
pub fn canonical(path: &Path) -> std::io::Result<PathBuf> {
    Ok(simplified(fs::canonicalize(path)?))
}

fn simplified(path: PathBuf) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path;
    };
    let plain = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        if !(rest.len() >= 3 && rest.as_bytes()[1] == b':' && rest.as_bytes()[2] == b'\\') {
            return path;
        }
        rest.to_owned()
    } else {
        return path;
    };
    // The ordinary spelling is limited to MAX_PATH and normalizes some names away.
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4",
        "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let safe = plain.len() < 260
        && plain.split('\\').skip(1).all(|part| {
            let stem = part.split('.').next().unwrap_or_default();
            !part.ends_with(['.', ' ']) && !part.contains('/') && !reserved.iter().any(|name| stem.eq_ignore_ascii_case(name))
        });
    if safe { PathBuf::from(plain) } else { path }
}

#[cfg(test)]
mod canonical_tests {
    use super::*;

    #[test]
    fn verbatim_paths_are_simplified_only_when_equivalent() {
        let simple = |text: &str| simplified(PathBuf::from(text));
        assert_eq!(simple(r"\\?\C:\Users\me\repo"), PathBuf::from(r"C:\Users\me\repo"));
        assert_eq!(simple(r"\\?\UNC\server\share\x"), PathBuf::from(r"\\server\share\x"));
        for kept in [
            r"\\?\C:\Users\me\trailing.",
            r"\\?\C:\Users\me\NUL.txt",
            r"\\?\Volume{0}\x",
            "/usr/local",
        ] {
            assert_eq!(simple(kept), PathBuf::from(kept), "{kept}");
        }
        let long = format!(r"\\?\C:\{}", "a".repeat(300));
        assert_eq!(simple(&long), PathBuf::from(&long));
    }
}
