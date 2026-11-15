//! The repository's own `dotnet`, and the environment .NET extraction runs it
//! with: shared by the helper-based extractors and `nuget-dependencies`'
//! restores.

use anyhow::{Context as _, Result};
use projections_extractor_sdk::{Context, execute, input, path, strings};
use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// The `dotnet` an extraction runs and the environment it runs it with.
pub struct Dotnet {
    pub executable: String,
    pub env: BTreeMap<String, String>,
    /// The variables the definition grants (`execution.environment`) that this process received.
    granted: BTreeMap<String, String>,
}

impl Dotnet {
    /// `inputs.dotnet` (default `dotnet` on `PATH`); a relative path with a
    /// separator is the revision's own file.
    pub fn executable(cx: &Context) -> Result<String> {
        let configured = input(cx.definition(), "dotnet", Some("dotnet"))?;
        Ok(if configured.contains(['/', '\\']) && !Path::new(configured).is_absolute() {
            path(cx.root(), configured, false, false)?.to_string_lossy().into_owned()
        } else {
            configured.to_owned()
        })
    }

    /// The configured `dotnet` with a private CLI home under `scratch` (unless
    /// the definition grants `DOTNET_CLI_HOME`), no telemetry, logo or node
    /// reuse, and the `DOTNET_ROOT` of an absolute executable.
    pub fn new(cx: &Context, scratch: &Path) -> Result<Self> {
        let executable = Self::executable(cx)?;
        let mut env = BTreeMap::from([
            ("DOTNET_CLI_TELEMETRY_OPTOUT".into(), "1".into()),
            ("DOTNET_NOLOGO".into(), "1".into()),
            ("MSBUILDDISABLENODEREUSE".into(), "1".into()),
            ("DOTNET_CLI_HOME".into(), scratch.join("home").to_string_lossy().into_owned()),
        ]);
        let forwarded = cx.environment(&["SystemRoot".into(), "DOTNET_ROOT".into()]);
        for name in ["SystemRoot", "DOTNET_ROOT"] {
            if let Some(value) = forwarded.get(name) {
                env.insert(name.into(), value.clone());
            }
        }
        let names = cx.definition()["execution"]
            .get("environment")
            .map(|v| strings(v, "execution.environment"))
            .transpose()?
            .unwrap_or_default();
        let granted = cx.environment(&names);
        if let Some(value) = granted.get("DOTNET_CLI_HOME") {
            env.insert("DOTNET_CLI_HOME".into(), value.clone());
        }
        if Path::new(&executable).is_absolute() {
            env.insert(
                "DOTNET_ROOT".into(),
                Path::new(&executable).parent().unwrap().to_string_lossy().into_owned(),
            );
        }
        Ok(Self { executable, env, granted })
    }

    /// Restores of the project in `directory` use the granted `NUGET_PACKAGES`,
    /// else the folder [`packages`] chooses.
    pub fn use_packages(&mut self, cx: &Context, directory: &Path, scratch: &Path) -> Result<()> {
        let packages = match self.granted.get("NUGET_PACKAGES") {
            Some(packages) => Some(PathBuf::from(packages)),
            None => packages(cx, directory, &self.executable, &self.env, scratch)?,
        };
        if let Some(packages) = packages {
            self.env.insert("NUGET_PACKAGES".into(), packages.to_string_lossy().into_owned());
        }
        Ok(())
    }

    /// Runs `dotnet` with `args` in `cwd` (it requires trust), reporting a
    /// missing SDK as the requirement it is.
    pub fn run(&self, cx: &Context, cwd: &Path, args: Vec<String>, stdin: Option<&str>) -> Result<String> {
        let mut argv = vec![self.executable.clone()];
        argv.extend(args);
        execute(cx, cwd, argv, stdin, self.env.clone(), true).map_err(|error| unavailable(error, &self.executable))
    }
}

/// The NuGet global packages folder for application restores, unless NuGet should
/// choose it itself (`None`). The repository's own NuGet configuration wins: when a
/// `nuget.config` above the project sets `globalPackagesFolder`, nothing is set, so
/// NuGet uses it. Otherwise restores reuse the user's folder, as the user's own
/// builds do: `NUGET_PACKAGES`, else `.nuget/packages` under the NuGet home
/// (`DOTNET_CLI_HOME`, else `HOME`/`USERPROFILE`). A project's `RestorePackagesPath`
/// still overrides any of these. Without any home, restores use a private folder.
fn packages(cx: &Context, directory: &Path, executable: &str, env: &BTreeMap<String, String>, scratch: &Path) -> Result<Option<PathBuf>> {
    let user = cx.environment(&[
        "NUGET_PACKAGES".into(),
        "DOTNET_CLI_HOME".into(),
        "HOME".into(),
        "USERPROFILE".into(),
    ]);
    let set = |name: &str| user.get(name).filter(|value| !value.is_empty());
    // NuGet itself lets NUGET_PACKAGES override configuration.
    if let Some(packages) = set("NUGET_PACKAGES") {
        return Ok(Some(PathBuf::from(packages)));
    }
    if repository_packages(cx, directory, executable, env)? {
        return Ok(None);
    }
    let home = set("DOTNET_CLI_HOME").or_else(|| if cfg!(windows) { set("USERPROFILE") } else { set("HOME") });
    Ok(Some(match home {
        Some(home) => Path::new(home).join(".nuget").join("packages"),
        None => scratch.join("packages"),
    }))
}

/// Asks NuGet, from the project directory and without user-level configuration,
/// whether the repository's configuration sets `globalPackagesFolder`; NuGet applies
/// its own rules for `nuget.config` discovery, `<clear />` and relative paths.
fn repository_packages(cx: &Context, directory: &Path, executable: &str, env: &BTreeMap<String, String>) -> Result<bool> {
    let output = execute(
        cx,
        directory,
        vec![
            executable.into(),
            "nuget".into(),
            "locals".into(),
            "global-packages".into(),
            "--list".into(),
        ],
        None,
        env.clone(),
        true,
    )
    .map_err(|error| unavailable(error, executable))?;
    let folder = output
        .lines()
        .find_map(|line| line.trim().strip_prefix("global-packages:"))
        .map(|folder| PathBuf::from(folder.trim().trim_end_matches(['/', '\\'])))
        .context("`dotnet nuget locals global-packages --list` did not report a folder")?;
    let home = env
        .get("DOTNET_CLI_HOME")
        .context("DOTNET_CLI_HOME is always set for .NET extraction")?;
    Ok(folder != Path::new(home).join(".nuget").join("packages"))
}

/// Replaces a failure to start `dotnet` with the explicit runtime requirement.
pub(crate) fn unavailable(error: anyhow::Error, executable: &str) -> anyhow::Error {
    let missing = error.chain().any(|cause| {
        cause
            .downcast_ref::<std::io::Error>()
            .is_some_and(|e| matches!(e.kind(), ErrorKind::NotFound | ErrorKind::PermissionDenied))
    });
    if missing {
        error.context(format!(
            ".NET extraction requires the repository's .NET SDK (8.0 or newer); `{executable}` could not be run. Install it in CI (for example with actions/setup-dotnet) or set inputs.dotnet to its executable"
        ))
    } else {
        error
    }
}
