//! The per-project record of a running viewer, so `projections view …`
//! subcommands and `projections mcp` find it: its URL (with the token), its
//! process and whether it runs repository code. It lives in the per-user
//! cache, owner-only, never in the repository. A record outlives a viewer that
//! was killed or a machine that restarted: [`live`] checks its process and its
//! URL before anything trusts it, and removes it when either is gone.

use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, Result};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

/// A running viewer, as its record says.
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    /// The page's URL, `http://127.0.0.1:PORT/TOKEN/`.
    pub url: String,
    pub pid: u32,
    pub trust: bool,
}

impl Record {
    pub fn json(&self) -> Value {
        json!({"format": "projections.viewer", "version": 1, "url": self.url, "pid": self.pid, "trust": self.trust})
    }

    /// Its port and token, so a viewer that replaces it can keep its URL.
    pub fn address(&self) -> Option<(u16, String)> {
        let rest = self.url.strip_prefix("http://127.0.0.1:")?;
        let (port, token) = rest.split_once('/')?;
        let token = token.trim_end_matches('/');
        if token.is_empty() || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        Some((port.parse().ok()?, token.to_owned()))
    }

    fn parse(value: &Value) -> Option<Self> {
        if value["format"] != "projections.viewer" || value["version"] != 1 {
            return None;
        }
        Some(Self {
            url: value["url"].as_str()?.to_owned(),
            pid: u32::try_from(value["pid"].as_u64()?).ok()?,
            trust: value["trust"].as_bool()?,
        })
    }
}

/// The record's file for the project `project` (its directory relative to the repository, empty for the root) of the
/// repository at `root`, under `base`. A viewer serves one project's definitions, so each project has its own.
pub fn path_in(base: &Path, root: &Path, project: &str) -> PathBuf {
    let key = if project.is_empty() {
        root.to_string_lossy().into_owned()
    } else {
        format!("{}\n{project}", root.to_string_lossy())
    };
    let digest = Sha256::digest(key.as_bytes());
    let name: String = digest[..16].iter().map(|byte| format!("{byte:02x}")).collect();
    base.join("views").join(format!("{name}.json"))
}

fn path(root: &Path) -> Result<PathBuf> {
    Ok(path_in(&crate::cache::base()?, root, crate::project::prefix()))
}

/// The record for `root`, if there is one.
pub fn read(root: &Path) -> Option<Record> {
    let bytes = std::fs::read(path(root).ok()?).ok()?;
    Record::parse(&serde_json::from_slice(&bytes).ok()?)
}

/// Records the viewer for `root`, replacing any earlier record.
pub fn write(root: &Path, record: &Record) -> Result<()> {
    let file = path(root)?;
    let directory = file.parent().context("The viewer record has no directory")?;
    crate::cache::private_directory(directory.parent().unwrap_or(directory))?;
    crate::cache::private_directory(directory)?;
    let temporary = directory.join(format!(".{}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&temporary);
    crate::create_file(&temporary, &serde_json::to_vec(&record.json())?)?;
    std::fs::rename(&temporary, &file).with_context(|| format!("Cannot record the viewer in {}", file.display()))
}

/// Removes the record for `root` when it is still `url`'s, as a viewer does when it stops.
pub fn remove(root: &Path, url: &str) {
    if read(root).is_some_and(|record| record.url == url)
        && let Ok(file) = path(root)
    {
        let _ = std::fs::remove_file(file);
    }
}

/// The viewer recorded for `root` when it is running: its process is alive, and it answers at its URL as that
/// process within `limit`. Otherwise the record is stale (its process was killed, or the machine restarted and another
/// process has its port) and is removed, so a new viewer replaces it.
pub async fn live(root: &Path, limit: Duration) -> Option<Record> {
    let record = read(root)?;
    if process_alive(record.pid) && answers(&record, limit).await {
        return Some(record);
    }
    remove(root, &record.url);
    None
}

/// Whether the viewer answers at its URL, as the process its record names.
async fn answers(record: &Record, limit: Duration) -> bool {
    match super::client::request(&record.url, "GET", "control/state", None, limit).await {
        Ok(response) if response.status == 200 => response
            .json()
            .is_ok_and(|state| state["pid"].as_u64().is_none_or(|pid| pid == u64::from(record.pid))),
        _ => false,
    }
}

/// Whether the process `pid` is running.
pub fn process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let Ok(pid) = libc::pid_t::try_from(pid) else {
            return false;
        };
        // Signal 0 checks without signalling; EPERM means it runs as another user.
        pid > 0 && (unsafe { libc::kill(pid, 0) } == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM))
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, STILL_ACTIVE},
            System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
        };
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return false;
        }
        let mut code = 0u32;
        let read = unsafe { GetExitCodeProcess(handle, &mut code) } != 0;
        unsafe { CloseHandle(handle) };
        read && code == STILL_ACTIVE as u32
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_round_trip_and_reject_other_documents() {
        let record = Record {
            url: "http://127.0.0.1:1/t/".into(),
            pid: 7,
            trust: true,
        };
        assert_eq!(Record::parse(&record.json()), Some(record));
        assert_eq!(Record::parse(&json!({"format": "other"})), None);
    }

    #[test]
    fn a_record_names_its_port_and_token() {
        let record = |url: &str| Record {
            url: url.into(),
            pid: 7,
            trust: false,
        };
        assert_eq!(record("http://127.0.0.1:4100/ab12/").address(), Some((4100, "ab12".to_owned())));
        assert_eq!(record("http://127.0.0.1:4100/../").address(), None);
        assert_eq!(record("http://example.com:4100/ab12/").address(), None);
    }

    #[test]
    fn only_running_processes_are_alive() {
        assert!(process_alive(std::process::id()));
        let mut child = std::process::Command::new(if cfg!(windows) { "cmd" } else { "true" })
            .args(if cfg!(windows) { &["/C", "exit"][..] } else { &[][..] })
            .spawn()
            .unwrap();
        let pid = child.id();
        child.wait().unwrap();
        assert!(!process_alive(pid), "a process that exited");
    }

    #[test]
    fn each_repository_and_project_has_its_own_record() {
        let base = Path::new("/cache");
        let a = path_in(base, Path::new("/src/a"), "");
        assert_ne!(a, path_in(base, Path::new("/src/b"), ""));
        assert_ne!(a, path_in(base, Path::new("/src/a"), "opensource"));
        assert_ne!(path_in(base, Path::new("/src/a"), "x"), path_in(base, Path::new("/src/a"), "y"));
        assert!(a.starts_with("/cache/views"));
    }
}
