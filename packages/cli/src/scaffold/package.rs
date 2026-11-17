//! Where a custom renderer's `@githubnext/projections` comes from: the GitHub
//! release of this CLI's version, a directory of `npm pack` tarballs, or the
//! source checkout of a development build; and whether a renderer package's
//! version is this CLI's.

use super::{Report, VERSION};
use anyhow::{Context, Result, ensure};
use serde_json::{Map, Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

/// A directory holding an `npm pack` tarball of `@githubnext/projections`
/// (such as one built from a Git submodule), which custom renderers then
/// install from instead of the release.
pub const RENDERER_PACKAGES_VARIABLE: &str = "PROJECTIONS_RENDERER_PACKAGES";
/// The one npm package custom renderers depend on, released with the same
/// version as this CLI. Until npm publishing is approved, each GitHub release
/// attaches its `npm pack` tarball, which renderers depend on by URL.
pub const RENDERER_PACKAGE: &str = "@githubnext/projections";
/// Where GitHub releases' assets download from.
const RELEASES: &str = "https://github.com/githubnext/projections/releases/download";
/// Where `npm run tools -- install` packs `@githubnext/projections` in a source
/// checkout, relative to it. The name never changes, so `file:` references to it
/// stay valid across updates.
pub const CHECKOUT_TARBALL: &str = "dist/dogfood/githubnext-projections.tgz";

/// The source checkout a development build runs from: the checkout this
/// executable was built from (`packages/cli/`'s grandparent at compile time), when the running
/// executable is inside it (`packages/cli/dist/` or `target/`, possibly through a symlink
/// such as `~/.local/bin/projections`) and it still holds the package. Released
/// executables, built elsewhere and installed outside any checkout, have none.
pub fn source_checkout() -> Option<PathBuf> {
    let executable = projections_extractor_sdk::canonical(&std::env::current_exe().ok()?).ok()?;
    checkout_for(&executable, Path::new(env!("CARGO_MANIFEST_DIR")))
}

pub(super) fn checkout_for(executable: &Path, cli_directory: &Path) -> Option<PathBuf> {
    // Without Windows' \\?\ prefix, which a file: specifier can't hold.
    let root = projections_extractor_sdk::canonical(cli_directory.parent()?.parent()?).ok()?;
    if !executable.starts_with(root.join("packages").join("cli").join("dist")) && !executable.starts_with(root.join("target")) {
        return None;
    }
    let manifest: Value = serde_json::from_str(&fs::read_to_string(root.join("packages").join("sdk").join("package.json")).ok()?).ok()?;
    (manifest["name"] == RENDERER_PACKAGE).then_some(root)
}

/// A `file:` specifier for `to` from the directory `from` (both absolute): relative
/// when they share a directory below the filesystem root (a project next to the
/// checkout), else absolute. Always `/`-separated.
pub fn file_specifier(from: &Path, to: &Path) -> String {
    use std::path::Component;
    let (from, to) = (without_verbatim_prefix(from), without_verbatim_prefix(to));
    let from: Vec<Component> = from.components().collect();
    let to: Vec<Component> = to.components().collect();
    let roots = from.iter().take_while(|part| !matches!(part, Component::Normal(_))).count();
    let common = from.iter().zip(&to).take_while(|(a, b)| a == b).count();
    let name = |part: &Component| part.as_os_str().to_string_lossy().replace('\\', "/");
    if common > roots {
        let mut parts = vec!["..".to_owned(); from.len() - common];
        parts.extend(to[common..].iter().map(name));
        format!("file:{}", parts.join("/"))
    } else {
        let root: String = to[..roots.min(to.len())].iter().map(name).collect();
        let rest: Vec<String> = to[roots.min(to.len())..].iter().map(name).collect();
        format!("file:{root}{}", rest.join("/"))
    }
}

/// `path` without the `\\?\` prefix Windows' canonical paths have before a drive letter, so a
/// path spelled either way compares and prints as the drive path a `file:` specifier holds.
fn without_verbatim_prefix(path: &Path) -> PathBuf {
    match path.to_str().and_then(|text| text.strip_prefix(r"\\?\")) {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}

/// `npm pack`'s file name for `@githubnext/projections` at `version`.
fn tarball_name(version: &str) -> String {
    format!("{}-{version}.tgz", RENDERER_PACKAGE.trim_start_matches('@').replace('/', "-"))
}

/// The URL of `@githubnext/projections`'s tarball attached to the release of
/// `version`: what a renderer's `package.json` depends on.
pub fn release_tarball(version: &str) -> String {
    format!("{RELEASES}/v{version}/{}", tarball_name(version))
}

/// Where a custom renderer's `@githubnext/projections` comes from.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum PackageSource {
    /// The tarball attached to this CLI's release.
    #[default]
    Release,
    /// A tarball in the directory `PROJECTIONS_RENDERER_PACKAGES` names.
    Directory,
    /// The tarball `npm run tools -- install` packs in this development build's
    /// source checkout.
    Checkout { tarball: PathBuf, specifier: String },
}

/// The custom renderer's `package.json`, installing `@githubnext/projections`
/// from a local tarball when `PROJECTIONS_RENDERER_PACKAGES` names a directory
/// holding it, else from a development build's source checkout (`package` is the
/// renderer package's directory), else from this CLI's release (the template's
/// dependency).
pub(super) fn renderer_manifest(template: &str, checkout: Option<&Path>, package: &Path, report: &mut Report) -> Result<String> {
    let Some(directory) = std::env::var_os(RENDERER_PACKAGES_VARIABLE) else {
        let Some(checkout) = checkout else {
            return Ok(template.to_owned());
        };
        let tarball = checkout.join(CHECKOUT_TARBALL);
        let specifier = file_specifier(package, &tarball);
        let mut manifest: Value = serde_json::from_str(template)?;
        manifest["dependencies"][RENDERER_PACKAGE] = json!(specifier);
        report.renderer_package = PackageSource::Checkout { tarball, specifier };
        return crate::json_text::render(&manifest, Some(template), &[]);
    };
    let directory = projections_extractor_sdk::canonical(Path::new(&directory))
        .with_context(|| format!("{RENDERER_PACKAGES_VARIABLE} must name a directory holding an npm pack tarball"))?;
    let mut manifest: Value = serde_json::from_str(template)?;
    let file = tarball_name(VERSION);
    let tarball = directory.join(&file);
    ensure!(
        tarball.is_file(),
        "{} has no {file}; create it with npm pack --workspace packages/sdk",
        directory.display()
    );
    let source = json!(format!("file:{}", tarball.to_string_lossy().replace('\\', "/")));
    manifest["dependencies"][RENDERER_PACKAGE] = source.clone();
    let mut overrides = Map::new();
    overrides.insert(RENDERER_PACKAGE.to_owned(), source);
    manifest["overrides"] = Value::Object(overrides);
    report.renderer_package = PackageSource::Directory;
    crate::json_text::render(&manifest, Some(template), &["dependencies", "overrides"])
}

/// The `@githubnext/projections` version the renderer package in `package`
/// uses: the one installed in its `node_modules`, else the one its dependency
/// names (a versioned tarball, such as a release's, or a version range).
/// `None` when it has no such dependency, or depends on an unversioned tarball
/// (a development build's) that isn't installed.
pub fn renderer_package_version(package: &Path) -> Option<String> {
    let read = |path: PathBuf| -> Option<Value> { serde_json::from_str(&fs::read_to_string(path).ok()?).ok() };
    let installed = package.join("node_modules").join(RENDERER_PACKAGE).join("package.json");
    if let Some(version) = read(installed).and_then(|manifest| manifest["version"].as_str().map(str::to_owned)) {
        return Some(version);
    }
    let manifest = read(package.join("package.json"))?;
    let specifier = ["dependencies", "devDependencies"]
        .iter()
        .find_map(|field| manifest[field][RENDERER_PACKAGE].as_str())?;
    let prefix = tarball_name("");
    let prefix = prefix.trim_end_matches(".tgz");
    let version = match specifier.rsplit(['/', '\\', ':']).next() {
        Some(file) if file.ends_with(".tgz") => file.strip_prefix(prefix)?.strip_suffix(".tgz")?,
        _ => specifier.trim_start_matches(['^', '~', '=', 'v']),
    };
    let numeric = version.split(['-', '+']).next()?.split('.').collect::<Vec<_>>();
    (numeric.len() == 3
        && numeric
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit())))
    .then(|| version.to_owned())
}

/// A version without a development build's suffix: `npm run tools -- install`
/// packs `0.2.0-dev.<commit>` from a checkout whose CLI is `0.2.0`.
fn released(version: &str) -> &str {
    version.split_once("-dev.").map_or(version, |(release, _)| release)
}

/// Why the renderer package in `package` (shown as `shown`) needs updating,
/// when its `@githubnext/projections` isn't this CLI's version: the two
/// release together.
pub fn version_mismatch(package: &Path, shown: &str) -> Option<String> {
    let version = renderer_package_version(package)?;
    (released(&version) != released(VERSION)).then(|| {
        format!(
            "{shown} uses {RENDERER_PACKAGE} {version}, but this projections is {VERSION}; they release together, so depend on {} and run npm install there (projections help init)",
            release_tarball(VERSION)
        )
    })
}
