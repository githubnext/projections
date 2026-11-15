use serde_json::Value;

/// Whether an extractor can execute ecosystem tools or repository code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trust {
    None,
    WhenExecutingTools,
}

impl Trust {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::WhenExecutingTools => "when-executing-tools",
        }
    }
}

/// What an extractor needs of the examined revision.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    /// Only file reads through the [`crate::Context`] (`files`, `entry`,
    /// `read_source`): the runner may serve them from Git objects, with nothing
    /// on disk, and enforce a scope.
    Files,
    /// A directory holding the revision, for tools that read it themselves.
    Checkout,
}

impl Access {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Files => "files",
            Self::Checkout => "checkout",
        }
    }
}

/// How reproducible an extractor's output is, like a test's: declared and
/// descriptive, never enforced. `projections check` measures it by rerunning.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Determinism {
    /// A function of the revision's files alone: the same tree always gives the
    /// same extraction, so it is cached by tree and a rerun must match.
    Pure,
    /// The files plus the toolchain and installed dependencies: reproducible
    /// within one environment, so it is cached only within the same environment
    /// fingerprint. The default for custom extractors.
    Environmental,
    /// Live or varying data, such as timings or coverage: each run is an
    /// observation, never reused silently.
    Observed,
}

impl Determinism {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pure => "pure",
            Self::Environmental => "environmental",
            Self::Observed => "observed",
        }
    }

    /// The class named `value`.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pure" => Some(Self::Pure),
            "environmental" => Some(Self::Environmental),
            "observed" => Some(Self::Observed),
            _ => None,
        }
    }
}

/// The catalog entry an extractor publishes about itself.
#[derive(Clone, Debug)]
pub struct Descriptor {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub schema: &'static str,
    pub renderer: &'static str,
    pub trust: Trust,
    /// Whether it only reads files through the Context, or needs a checkout.
    pub access: Access,
    /// How reproducible its output is.
    pub determinism: Determinism,
    /// Input name to human-readable description.
    pub inputs: Value,
    /// Inputs written into a newly initialized definition, if any.
    pub template_inputs: Option<Value>,
    /// Repository-relative glob patterns (`*` within a path segment, `**/`
    /// any directories) whose matching files mean the extractor may apply,
    /// so `projections explore` can propose it. Empty: never proposed.
    pub detects: &'static [&'static str],
}
