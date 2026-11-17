//! Workspaces: where a toolchain extractor examines a commit that isn't checked
//! out, the only case that needs files on disk. A repository and machine choose
//! a strategy (`--workspace`, the user config file, the environment file's
//! `workspace.strategy`, else automatically):
//!
//! - `fresh`: a temporary full copy per run (tiny repositories);
//! - `worktree`: a persistent linked Git worktree that Projections owns, under
//!   the per-user cache; switching revisions rewrites only changed files and
//!   keeps ignored ones (prepared dependencies, build caches);
//! - `clone`: a worktree seeded with a copy-on-write clone of the checkout
//!   (APFS `clonefile`, btrfs/XFS reflink), so installed dependencies come along
//!   nearly free; falls back to `worktree` where the filesystem can't clone;
//! - `sparse`: a worktree holding only the definition's scope;
//! - `none`: no copies; such an extraction fails, saying what to do instead.
//!
//! Each strategy has up to [`SLOTS`] slots per repository, each locked by an OS
//! file lock while a run uses it, so concurrent runs never share one.

use crate::runtime::Runner;
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

mod lease;

pub use lease::{Lease, clean, lease, list};

/// Slots per strategy and repository.
pub const SLOTS: usize = 4;

/// A workspace strategy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Strategy {
    Fresh,
    Worktree,
    Clone,
    Sparse,
    None,
}

impl Strategy {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "fresh" => Self::Fresh,
            "worktree" => Self::Worktree,
            "clone" => Self::Clone,
            "sparse" => Self::Sparse,
            "none" => Self::None,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fresh => "fresh",
            Self::Worktree => "worktree",
            Self::Clone => "clone",
            Self::Sparse => "sparse",
            Self::None => "none",
        }
    }
}

/// A chosen strategy and why, for provenance notes and `projections doctor`.
#[derive(Clone, Debug)]
pub struct Choice {
    pub strategy: Strategy,
    /// `flag`, `config`, `environment` or `automatic`.
    pub source: &'static str,
    pub reason: String,
}

/// The per-user configuration file's directory: `PROJECTIONS_CONFIG_DIR`,
/// otherwise `%APPDATA%\projections` on Windows, `~/Library/Application
/// Support/projections` on macOS and `$XDG_CONFIG_HOME/projections` (default
/// `~/.config/projections`) elsewhere.
pub fn config_directory() -> Option<PathBuf> {
    let absolute = |name: &str| std::env::var_os(name).map(PathBuf::from).filter(|path| path.is_absolute());
    if let Some(directory) = absolute("PROJECTIONS_CONFIG_DIR") {
        return Some(directory);
    }
    let base = if cfg!(windows) {
        absolute("APPDATA")
    } else if cfg!(target_os = "macos") {
        absolute("HOME").map(|home| home.join("Library").join("Application Support"))
    } else {
        absolute("XDG_CONFIG_HOME").or_else(|| absolute("HOME").map(|home| home.join(".config")))
    };
    base.map(|base| base.join("projections"))
}

/// The user configuration (`config.json`), or `{}`:
/// `{"workspace"?: STRATEGY, "ci"?: bool, "repositories"?: {"/abs/checkout": {"workspace"?, "ci"?}}}`.
pub fn config() -> Result<Value> {
    let Some(directory) = config_directory() else {
        return Ok(json!({}));
    };
    let path = directory.join("config.json");
    let Ok(bytes) = fs::read(&path) else {
        return Ok(json!({}));
    };
    let value = crate::artifact::parse(std::str::from_utf8(&bytes)?).with_context(|| format!("Invalid {}", path.display()))?;
    ensure!(value.is_object(), "{} must hold an object", path.display());
    Ok(value)
}

/// A setting for the checkout at `root` from the user configuration: the
/// repository's own entry first, then the global one.
pub fn setting(config: &Value, root: &Path, name: &str) -> Option<Value> {
    let repository = config["repositories"]
        .as_object()
        .and_then(|repositories| {
            repositories
                .iter()
                .find(|(path, _)| projections_extractor_sdk::canonical(Path::new(path)).is_ok_and(|path| path == root))
        })
        .map(|(_, settings)| settings[name].clone())
        .filter(|value| !value.is_null());
    repository.or_else(|| Some(config[name].clone()).filter(|value| !value.is_null()))
}

/// Chooses a strategy: `flag`, else the user configuration, else the
/// environment file's, else automatically from the repository's size, free
/// disk space and copy-on-write support.
pub fn choose(runner: &Runner, flag: Option<Strategy>, environment: Option<&str>) -> Result<Choice> {
    if let Some(strategy) = flag {
        return Ok(Choice {
            strategy,
            source: "flag",
            reason: "chosen with --workspace".into(),
        });
    }
    let root = runner.repository_root()?;
    if let Some(value) = setting(&config()?, &root, "workspace") {
        let name = value.as_str().unwrap_or_default();
        let strategy =
            Strategy::parse(name).with_context(|| format!("The user configuration names an unknown workspace strategy {name}"))?;
        return Ok(Choice {
            strategy,
            source: "config",
            reason: format!(
                "chosen in {}",
                config_directory()
                    .map(|directory| directory.join("config.json").display().to_string())
                    .unwrap_or_default()
            ),
        });
    }
    if let Some(name) = environment
        && let Some(strategy) = Strategy::parse(name)
    {
        return Ok(Choice {
            strategy,
            source: "environment",
            reason: "the repository's environment file chooses it".into(),
        });
    }
    automatic(runner)
}

/// The automatic choice: `fresh` for a tiny repository, `worktree` when free
/// disk space is at least four times the tracked size, else `clone` where the
/// filesystem supports copy-on-write, else `none`.
pub fn automatic(runner: &Runner) -> Result<Choice> {
    let root = runner.repository_root()?;
    let listed = runner.git(&root, &["ls-tree", "-r", "-l", "-z", "HEAD"], None, 256 * 1024 * 1024)?;
    let (mut files, mut bytes) = (0u64, 0u64);
    for line in std::str::from_utf8(&listed)?.split('\0').filter(|line| !line.is_empty()) {
        files += 1;
        bytes += line
            .split('\t')
            .next()
            .and_then(|record| record.split_whitespace().nth(3))
            .and_then(|size| size.parse::<u64>().ok())
            .unwrap_or(0);
    }
    let size = format!("{files} files, {:.1} MiB tracked", bytes as f64 / 1_048_576.0);
    if files < 2_000 && bytes < 20 * 1024 * 1024 {
        return Ok(Choice {
            strategy: Strategy::Fresh,
            source: "automatic",
            reason: format!("a small repository ({size}): a fresh copy per run is cheap"),
        });
    }
    let base = runner.cache_base()?;
    let free = free_space(base.ancestors().find(|path| path.exists()).unwrap_or(&root));
    match free {
        Some(free) if free >= bytes.saturating_mul(4) => Ok(Choice {
            strategy: Strategy::Worktree,
            source: "automatic",
            reason: format!("{size}; {:.0} GiB free", free as f64 / 1_073_741_824.0),
        }),
        _ if clones(&root) => Ok(Choice {
            strategy: Strategy::Clone,
            source: "automatic",
            reason: format!("{size}, with little free disk space; the filesystem clones copy-on-write"),
        }),
        _ => Ok(Choice {
            strategy: Strategy::None,
            source: "automatic",
            reason: format!("{size}, with too little free disk space for a second copy"),
        }),
    }
}

/// Free bytes on the filesystem holding `path`.
#[cfg(unix)]
pub fn free_space(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    (unsafe { libc::statvfs(path.as_ptr(), &mut stat) } == 0).then(|| stat.f_bavail as u64 * stat.f_frsize as u64)
}

#[cfg(not(unix))]
pub fn free_space(_path: &Path) -> Option<u64> {
    None
}

/// Copies `source` to `target` copy-on-write, or fails.
fn clone_file(source: &Path, target: &Path) -> Result<()> {
    let argv: Vec<String> = if cfg!(target_os = "macos") {
        vec!["cp".into(), "-c".into(), "-R".into()]
    } else if cfg!(target_os = "linux") {
        vec!["cp".into(), "-R".into(), "--reflink=always".into()]
    } else {
        bail!("Copy-on-write clones need macOS (APFS) or Linux (btrfs, XFS)");
    };
    let status = std::process::Command::new(&argv[0])
        .args(&argv[1..])
        .arg(source)
        .arg(target)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()?;
    ensure!(status.success(), "The filesystem can't clone {}", source.display());
    Ok(())
}

/// Whether the checkout's filesystem clones copy-on-write.
pub fn clones(root: &Path) -> bool {
    let Ok(probe) = tempfile::Builder::new()
        .prefix(".projections-clone-probe-")
        .tempdir_in(if root.join(".git").is_dir() {
            root.join(".git")
        } else {
            root.to_path_buf()
        })
    else {
        return false;
    };
    let source = probe.path().join("source");
    fs::write(&source, b"probe").is_ok() && clone_file(&source, &probe.path().join("target")).is_ok()
}

/// This repository's workspaces directory.
pub fn directory(runner: &Runner) -> Result<PathBuf> {
    Ok(runner
        .cache_base()?
        .join("workspaces")
        .join(crate::extraction_cache::repository_name(&runner.common_directory()?)))
}
