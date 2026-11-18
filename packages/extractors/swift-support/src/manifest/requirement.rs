//! Version requirements, normalized as SwiftPM does: `from:` and
//! `.upToNextMajor(from:)` are the range up to the next major version,
//! `.upToNextMinor(from:)` up to the next minor one, and a closed range
//! `a...b` ends just past `b`'s patch.

use anyhow::{Context as _, Result};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Requirement {
    /// `lower..<upper`.
    Range {
        lower: String,
        upper: String,
    },
    Exact(String),
    Branch(String),
    Revision(String),
    /// A local package, used as it is.
    Local,
}

/// The major, minor and patch numbers of a semantic version (`1.2.3-beta.1`).
fn numbers(version: &str) -> Result<[u64; 3]> {
    let core = version.split(['-', '+']).next().unwrap_or(version);
    let parts: Vec<u64> = core
        .split('.')
        .map(str::parse)
        .collect::<Result<_, _>>()
        .with_context(|| format!("`{version}` is not a semantic version"))?;
    let [major, minor, patch] = parts[..] else {
        anyhow::bail!("`{version}` is not a semantic version (major.minor.patch)");
    };
    Ok([major, minor, patch])
}

impl Requirement {
    pub fn up_to_next_major(lower: &str) -> Result<Self> {
        let [major, ..] = numbers(lower)?;
        Ok(Self::range(lower, format!("{}.0.0", major + 1)))
    }

    pub fn up_to_next_minor(lower: &str) -> Result<Self> {
        let [major, minor, _] = numbers(lower)?;
        Ok(Self::range(lower, format!("{major}.{}.0", minor + 1)))
    }

    pub fn half_open(lower: &str, upper: &str) -> Result<Self> {
        numbers(lower)?;
        numbers(upper)?;
        Ok(Self::range(lower, upper.to_owned()))
    }

    /// `lower...upper`, which SwiftPM turns into the range to the next patch.
    pub fn closed(lower: &str, upper: &str) -> Result<Self> {
        numbers(lower)?;
        let [major, minor, patch] = numbers(upper)?;
        Ok(Self::range(lower, format!("{major}.{minor}.{}", patch + 1)))
    }

    pub fn exact(version: &str) -> Result<Self> {
        numbers(version)?;
        Ok(Self::Exact(version.to_owned()))
    }

    fn range(lower: &str, upper: String) -> Self {
        Self::Range {
            lower: lower.to_owned(),
            upper,
        }
    }

    /// The requirement as SwiftPM describes it (`1.1.0..<2.0.0`, `exactly
    /// 1.5.4`, `branch main`); none for a local package.
    pub fn describe(&self) -> Option<String> {
        Some(match self {
            Self::Range { lower, upper } => format!("{lower}..<{upper}"),
            Self::Exact(version) => format!("exactly {version}"),
            Self::Branch(branch) => format!("branch {branch}"),
            Self::Revision(revision) => format!("revision {revision}"),
            Self::Local => return None,
        })
    }
}
