//! A Swift package manifest's package graph: its products, targets, target
//! dependencies and package dependencies. [`statics::read`] reads it from
//! `Package.swift` without running anything; [`dump::read`] from the JSON
//! `swift package dump-package` prints. Both give the same [`Manifest`].

pub mod dump;
mod requirement;
pub mod statics;

pub use requirement::Requirement;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Manifest {
    pub name: String,
    /// The `// swift-tools-version:` the manifest declares, when read statically.
    pub tools_version: Option<String>,
    pub products: Vec<Product>,
    pub dependencies: Vec<Dependency>,
    pub targets: Vec<Target>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Product {
    pub name: String,
    /// `library`, `executable`, `plugin` or `macro`.
    pub kind: String,
    /// A library's `automatic`, `static` or `dynamic` linkage.
    pub linkage: Option<String>,
    pub targets: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dependency {
    /// SwiftPM's package identity: the last component of its URL or path
    /// without `.git`, or its registry ID, lowercased.
    pub identity: String,
    /// The name an old manifest gives it (`.package(name:url:…)`).
    pub name: Option<String>,
    pub source: Source,
    pub requirement: Requirement,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Source {
    /// A Git repository: a URL, or a local repository's path.
    Repository(String),
    /// A local directory, relative to the package's root.
    Local(String),
    /// A package registry ID, `scope.name`.
    Registry(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    pub name: String,
    /// `regular`, `executable`, `test`, `system`, `binary`, `plugin` or `macro`.
    pub kind: String,
    /// The directory or artifact it declares, if any.
    pub path: Option<String>,
    pub dependencies: Vec<TargetDependency>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TargetDependency {
    pub kind: DependencyKind,
    pub name: String,
    pub condition: Condition,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DependencyKind {
    /// A target, or a product named like its package.
    ByName,
    Target,
    /// A product of the package the manifest names, when it names one.
    Product {
        package: Option<String>,
    },
}

/// When a dependency applies: on these platforms (lowercased, as SwiftPM
/// writes them: `linux`, `macos`) and with these package traits enabled.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Condition {
    pub platforms: Vec<String>,
    pub traits: Vec<String>,
}

impl Condition {
    pub fn is_empty(&self) -> bool {
        self.platforms.is_empty() && self.traits.is_empty()
    }
}

/// SwiftPM's identity for a package at `location`, a URL or a path.
pub fn identity(location: &str) -> String {
    let trimmed = location.trim_end_matches('/');
    let last = trimmed.rsplit(['/', '\\', ':']).next().unwrap_or(trimmed);
    last.strip_suffix(".git").unwrap_or(last).to_lowercase()
}

/// Why a manifest can't be read without running it.
#[derive(Debug)]
pub struct Unsupported {
    pub line: Option<usize>,
    pub message: String,
}

impl std::fmt::Display for Unsupported {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.line {
            Some(line) => write!(f, "line {line}: {}", self.message),
            None => f.write_str(&self.message),
        }
    }
}

impl std::error::Error for Unsupported {}
