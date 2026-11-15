//! Finding the installed browser.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};

/// Executable names searched on `PATH`, most specific first.
const PATH_NAMES: &[&str] = if cfg!(windows) {
    &["chrome.exe", "msedge.exe", "chromium.exe"]
} else {
    &[
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
        "microsoft-edge-stable",
        "msedge",
        "chrome",
    ]
};

/// Standard install locations outside `PATH`.
fn installed_locations() -> Vec<PathBuf> {
    let mut locations = Vec::new();
    if cfg!(target_os = "macos") {
        let applications = [
            "Google Chrome.app/Contents/MacOS/Google Chrome",
            "Chromium.app/Contents/MacOS/Chromium",
            "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        ];
        let mut roots = vec![PathBuf::from("/Applications")];
        if let Some(home) = std::env::var_os("HOME") {
            roots.push(PathBuf::from(home).join("Applications"));
        }
        for root in roots {
            for application in applications {
                locations.push(root.join(application));
            }
        }
    } else if cfg!(windows) {
        let suffixes = [
            "Google\\Chrome\\Application\\chrome.exe",
            "Microsoft\\Edge\\Application\\msedge.exe",
            "Chromium\\Application\\chrome.exe",
        ];
        for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Some(root) = std::env::var_os(variable) {
                for suffix in suffixes {
                    locations.push(PathBuf::from(&root).join(suffix));
                }
            }
        }
    } else {
        for path in [
            "/opt/google/chrome/chrome",
            "/opt/microsoft/msedge/msedge",
            "/usr/lib/chromium/chromium",
            "/snap/bin/chromium",
        ] {
            locations.push(PathBuf::from(path));
        }
    }
    locations
}

fn executable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    metadata.is_file()
}

/// Finds the browser: `explicit` (`--browser`), else `PROJECTIONS_BROWSER`,
/// else Chrome, Chromium or Edge on `PATH` or in a standard install location.
pub fn find(explicit: Option<&Path>) -> Result<PathBuf> {
    if let Some(path) = explicit {
        ensure!(executable(path), "--browser {} is not an executable file", path.display());
        return Ok(path.to_owned());
    }
    if let Some(value) = std::env::var_os("PROJECTIONS_BROWSER").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(value);
        ensure!(
            executable(&path),
            "PROJECTIONS_BROWSER={} is not an executable file",
            path.display()
        );
        return Ok(path);
    }
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            for name in PATH_NAMES {
                let candidate = directory.join(name);
                if executable(&candidate) {
                    return Ok(candidate);
                }
            }
        }
    }
    installed_locations()
        .into_iter()
        .find(|candidate| executable(candidate))
        .context(
            "No Chrome, Chromium or Microsoft Edge was found. Install one, or name its executable with --browser <PATH> (or the PROJECTIONS_BROWSER environment variable)",
        )
}
