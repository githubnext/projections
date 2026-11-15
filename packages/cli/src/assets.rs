use anyhow::{Context, Result, bail};
use std::path::PathBuf;

include!(concat!(env!("OUT_DIR"), "/inspector-assets.rs"));

pub struct InspectorAssets {
    pub path: PathBuf,
    _temporary: Option<tempfile::TempDir>,
}

fn directory(variable: &str) -> Result<PathBuf> {
    let value = std::env::var_os(variable).context("Missing asset directory override")?;
    let path = PathBuf::from(value)
        .canonicalize()
        .with_context(|| format!("{variable} must identify an existing asset directory"))?;
    if !path.is_dir() {
        bail!("{variable} must identify a directory");
    }
    Ok(path)
}

pub fn inspector_assets() -> Result<InspectorAssets> {
    if std::env::var_os("PROJECTIONS_INSPECTOR_ASSETS").is_some() {
        return Ok(InspectorAssets {
            path: directory("PROJECTIONS_INSPECTOR_ASSETS")?,
            _temporary: None,
        });
    }
    if !INSPECTOR.iter().any(|(name, _)| *name == "mount.js") {
        bail!(
            "Inspector browser assets were not included in this build. Explicitly build the browser client before rebuilding the native CLI; no Node/server fallback or implicit build is performed"
        )
    }
    let temporary = tempfile::Builder::new().prefix("projections-inspector-assets-").tempdir()?;
    for (name, bytes) in INSPECTOR {
        let path = temporary.path().join(name);
        std::fs::create_dir_all(path.parent().context("Missing asset parent")?)?;
        std::fs::write(path, bytes)?;
    }
    Ok(InspectorAssets {
        path: temporary.path().to_owned(),
        _temporary: Some(temporary),
    })
}

/// One Inspector asset by its path (for example `renderers/index.json`): from
/// `PROJECTIONS_INSPECTOR_ASSETS` when set, else embedded at build time.
pub fn inspector_asset(name: &str) -> Option<Vec<u8>> {
    if std::env::var_os("PROJECTIONS_INSPECTOR_ASSETS").is_some() {
        return std::fs::read(directory("PROJECTIONS_INSPECTOR_ASSETS").ok()?.join(name)).ok();
    }
    INSPECTOR.iter().find(|(path, _)| *path == name).map(|(_, bytes)| bytes.to_vec())
}

/// The default comparator module embedded at build time, if it was built.
pub fn default_comparator_module() -> Option<&'static [u8]> {
    DEFAULT_COMPARATOR
}

/// The rules comparator module embedded at build time, if it was built.
pub fn rules_comparator_module() -> Option<&'static [u8]> {
    RULES_COMPARATOR
}

/// The viewer's MCP App page (`ui://projections/viewer`) embedded at build time, if it was built.
pub fn mcp_app() -> Option<&'static str> {
    MCP_APP
}

/// Whether this build embeds the extractor helpers (a distribution build).
pub fn embedded_helpers() -> bool {
    !HELPERS.is_empty()
}

/// The MIT license and the complete third-party notices for everything this
/// executable embeds, or `None` for a build without the Inspector client, whose
/// notices file covers the native CLI, the engines and the browser assets.
pub fn licenses() -> Option<String> {
    let notices = INSPECTOR.iter().find(|(name, _)| *name == "THIRD_PARTY_NOTICES.txt")?.1;
    Some(format!(
        "{}\n{}",
        include_str!("../../../LICENSE"),
        String::from_utf8_lossy(notices)
    ))
}

/// The embedded helpers unpacked under the cache base `cache` (default: the
/// per-user cache), or `None` for a source build.
pub fn collector_directory_in(cache: Option<&std::path::Path>) -> Result<Option<PathBuf>> {
    if HELPERS.is_empty() {
        return Ok(None);
    }
    let base = match cache {
        Some(cache) => cache.to_owned(),
        None => crate::cache::base()?,
    };
    // Verified on every use, so a long-running Inspector never runs an altered helper.
    let path = crate::cache::unpack(&base, env!("CARGO_PKG_VERSION"), HELPERS)
        .context("Cannot prepare the extractor helpers embedded in this executable")?;
    Ok(Some(path))
}

/// Overrides the extractor helper directory.
pub const COLLECTOR_ASSETS: &str = "PROJECTIONS_COLLECTOR_ASSETS";

/// The explicit helper directory, `PROJECTIONS_COLLECTOR_ASSETS`, if set.
pub fn collector_override() -> Result<Option<PathBuf>> {
    if std::env::var_os(COLLECTOR_ASSETS).is_some() {
        directory(COLLECTOR_ASSETS).map(Some)
    } else {
        Ok(None)
    }
}
