//! The package and the local packages it depends on inside the project, each
//! with its manifest.

use crate::join;
use anyhow::{Context as _, Result, anyhow};
use projections_extractor_sdk::{Context, Scratch, basename, parent, path, run};
use projections_extractor_swift_support::manifest::{Manifest, Source, dump, statics};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Debug)]
pub(crate) enum Mode<'a> {
    /// Read `Package.swift` without running it.
    Static,
    /// Run `swift package dump-package` for each package.
    DumpPackage { swift: &'a str },
    /// Import the root package's dump-package output; local packages are read statically.
    Imported(&'a str),
}

pub(crate) struct Package {
    /// The package's project-relative directory; empty for the project's root.
    pub dir: String,
    /// Its directory relative to the root package's: `.` for the root package.
    pub place: String,
    pub manifest: Manifest,
    /// How its manifest was read: `static`, `dump-package` or `imported`.
    pub how: &'static str,
}

impl Package {
    /// The directory as IDs show it, relative to the root package's.
    pub fn place(&self) -> &str {
        &self.place
    }

    pub fn describe(&self) -> Value {
        json!({"path": if self.dir.is_empty() { "." } else { &self.dir }, "name": self.manifest.name, "toolsVersion": self.manifest.tools_version, "manifest": self.how})
    }
}

/// The package in `root` and, breadth first, every local package it depends on
/// that is inside the project.
pub(crate) fn read(cx: &Context, root: &str, mode: &Mode) -> Result<Vec<Package>> {
    let mut queue = VecDeque::from([root.to_owned()]);
    let mut seen = BTreeSet::new();
    let mut packages = Vec::new();
    while let Some(dir) = queue.pop_front() {
        if !seen.insert(dir.clone()) {
            continue;
        }
        let (manifest, how) = match mode {
            Mode::Imported(file) if dir == root => (
                dump::read(&cx.read_json(file)?).with_context(|| format!("{file} isn't dump-package output"))?,
                "imported",
            ),
            Mode::DumpPackage { swift } => (dumped(cx, &dir, swift)?, "dump-package"),
            _ => (statically(cx, &dir)?, "static"),
        };
        for dependency in &manifest.dependencies {
            if let Source::Local(path) = &dependency.source
                && let Some(local) = local_dir(&dir, path)
                && cx.exists(&join(&local, "Package.swift"))?
            {
                queue.push_back(local);
            }
        }
        let place = relative(&dir, root);
        packages.push(Package { dir, place, manifest, how });
    }
    Ok(packages)
}

fn statically(cx: &Context, dir: &str) -> Result<Manifest> {
    let file = join(dir, "Package.swift");
    let source = cx.read_source(&file)?;
    statics::read(&source).map_err(|error| {
        anyhow!(
            "{file} {error}. Reading the manifest without running it can't follow that: set `inputs.manifest` to \"dump-package\" \
             to have SwiftPM evaluate it (requires --trust), or import `swift package dump-package` output with `inputs.manifestJsonPath`"
        )
    })
}

/// SwiftPM's own evaluation of the manifest in `dir`, which compiles and runs it.
fn dumped(cx: &Context, dir: &str, swift: &str) -> Result<Manifest> {
    cx.require_trust()?;
    let root = cx.root();
    let package = path(root, if dir.is_empty() { "." } else { dir }, false, false)?;
    let scratch = Scratch::new(root, "swiftpm")?;
    let argv = [swift, "package", "--package-path"]
        .map(str::to_owned)
        .into_iter()
        .chain([
            package.to_string_lossy().into_owned(),
            "--scratch-path".into(),
            scratch.0.to_string_lossy().into_owned(),
        ])
        .chain(["dump-package".to_owned()])
        .collect();
    let document = run(cx, &package, argv, None, BTreeMap::new())?;
    dump::read(&document).with_context(|| format!("`swift package dump-package` for {}", join(dir, "Package.swift")))
}

/// The project-relative directory a local dependency's `path` names from the
/// package in `dir`, when it's inside the project.
pub(crate) fn local_dir(dir: &str, path: &str) -> Option<String> {
    if path.starts_with('/') {
        return None;
    }
    let mut parts: Vec<&str> = dir.split('/').filter(|part| !part.is_empty() && *part != ".").collect();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    Some(parts.join("/"))
}

/// `dir` relative to `root`, both project-relative: `.` when they're the same.
fn relative(dir: &str, root: &str) -> String {
    let split = |path: &str| {
        path.split('/')
            .filter(|part| !part.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };
    let (dir, root) = (split(dir), split(root));
    let common = dir.iter().zip(&root).take_while(|(a, b)| a == b).count();
    let mut parts = vec!["..".to_owned(); root.len() - common];
    parts.extend(dir[common..].iter().cloned());
    if parts.is_empty() { ".".into() } else { parts.join("/") }
}

/// What reading the manifests statically leaves out: version-specific
/// manifests (`Package@swift-6.0.swift`) a matching toolchain uses instead.
pub(crate) fn limitations(cx: &Context, packages: &[Package]) -> Result<Vec<String>> {
    let mut limitations = Vec::new();
    for package in packages.iter().filter(|package| package.how == "static") {
        let variants: Vec<&str> = cx
            .files()?
            .iter()
            .filter(|file| parent(file) == package.dir && basename(file).starts_with("Package@swift-") && file.ends_with(".swift"))
            .map(|file| basename(file))
            .collect();
        if !variants.is_empty() {
            limitations.push(format!(
                "{} also has {}, which SwiftPM uses instead of Package.swift with a matching toolchain; set `inputs.manifest` to \"dump-package\" to read the one it picks.",
                if package.dir.is_empty() { "." } else { &package.dir },
                variants.join(", ")
            ));
        }
    }
    Ok(limitations)
}
