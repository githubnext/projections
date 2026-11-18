//! The `projections` commands: their arguments and what they do. `main.rs`
//! parses the command line and dispatches here; options several commands share,
//! and writing their documents, are here.

mod authoring;
mod canvas;
mod environment;
mod explore;
mod image;
mod review;
mod serve;
mod show;
mod view;
mod view_page;
mod view_process;

pub use authoring::{Check, Extractor, Init, Language, Validate, check, extractor, init, validate};
pub use canvas::{Canvas, canvas};
pub use environment::{Doctor, Prepare, Workspace, doctor, prepare, workspace};
pub use explore::{Adopt, Explore, adopt, explore};
pub use image::{FocusOn, ImageMode, Png, Side, Theme};
pub use review::{Bookmark, PullRequest, bookmark, pull_request};
pub use serve::{Mcp, Serve, mcp, serve};
pub use show::{Compare, Format, List, Show, compare, list, show};
pub use view::{View, ViewCommand, ViewMode, ViewShow, view};

use std::{
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use anyhow::{Result, ensure};
use clap::{Args, ValueEnum};
use serde_json::Value;

use crate::runtime::{DefinitionSource, Runner};

/// Which revision's projection definition explains a comparison
#[derive(Clone, Copy, ValueEnum)]
pub enum Definition {
    /// The first (base) revision's definition
    Base,
    /// The second (head) revision's definition
    Head,
}

impl From<Definition> for DefinitionSource {
    fn from(value: Definition) -> Self {
        match value {
            Definition::Base => DefinitionSource::Base,
            Definition::Head => DefinitionSource::Head,
        }
    }
}

#[derive(Clone, Copy, ValueEnum)]
pub enum ContainerEngine {
    Docker,
    Podman,
}

#[derive(Args)]
#[command(next_help_heading = "Execution")]
pub struct Execution {
    /// Run repository code: the projection's extractor, on every selected revision, and its custom renderer. Review it first
    #[arg(long)]
    pub trust: bool,
    /// Run extractors in this locally prepared container image@sha256; never pulled
    #[arg(long, value_name = "IMAGE")]
    pub container_image: Option<String>,
    #[arg(long, value_enum, requires = "container_image")]
    pub container_engine: Option<ContainerEngine>,
    #[command(flatten)]
    pub sources: Sources,
}

/// Where extractions may come from instead of running an extractor, and where
/// one runs: shared by the commands that extract and by `serve` and `mcp`.
#[derive(Args, Clone)]
#[command(next_help_heading = "Execution")]
pub struct Sources {
    /// Don't read or write the persistent extraction cache
    #[arg(long)]
    pub no_cache: bool,
    /// Reuse extractions of commits from this repository's own CI runs (their projections artifact), downloaded with gh
    #[arg(long)]
    pub ci: bool,
    /// Reuse extractions from a downloaded CI artifact directory (holding projections.artifact.json); repeatable
    #[arg(long, value_name = "DIR")]
    pub artifact: Vec<PathBuf>,
    /// Extract a commit that is this checkout's HEAD in place even when untracked files (such as CI's build output) are present; tracked files must be unmodified
    #[arg(long)]
    pub in_place: bool,
    /// Where a toolchain extractor examines a commit that isn't checked out [default: the user configuration, the environment file's, else automatic]
    #[arg(long, value_enum, value_name = "STRATEGY")]
    pub workspace: Option<WorkspaceStrategy>,
    /// Generate generated values (such as model-written summaries) again instead of reusing the generation store's text for an equal basis
    #[arg(long)]
    pub regenerate: bool,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum WorkspaceStrategy {
    /// A temporary full copy per run
    Fresh,
    /// A persistent linked Git worktree Projections owns, reused and kept prepared
    Worktree,
    /// A worktree seeded with a copy-on-write clone of the checkout
    Clone,
    /// A worktree holding only the definition's scope
    Sparse,
    /// No copies: only the cache, CI artifacts and in-place extraction
    None,
}

impl WorkspaceStrategy {
    fn strategy(self) -> crate::workspaces::Strategy {
        use crate::workspaces::Strategy;
        match self {
            Self::Fresh => Strategy::Fresh,
            Self::Worktree => Strategy::Worktree,
            Self::Clone => Strategy::Clone,
            Self::Sparse => Strategy::Sparse,
            Self::None => Strategy::None,
        }
    }
}

impl Sources {
    fn policy(&self) -> crate::runtime::ExecutionPolicy {
        crate::runtime::ExecutionPolicy {
            cache: !self.no_cache,
            artifacts: self.artifact.clone(),
            download: self.ci,
            in_place: self.in_place,
            workspace: self.workspace.map(WorkspaceStrategy::strategy),
            regenerate: self.regenerate,
        }
    }
}

impl Execution {
    fn runner(&self, directory: &Path) -> Result<Runner> {
        let mut runner = Runner::at_checkout(directory.to_path_buf(), self.trust).with_policy(&self.sources.policy());
        if let Some(image) = &self.container_image {
            runner.set_container(
                match self.container_engine.unwrap_or(ContainerEngine::Docker) {
                    ContainerEngine::Docker => "docker",
                    ContainerEngine::Podman => "podman",
                },
                image,
            )?;
        }
        Ok(runner)
    }
}

/// Writes a JSON document to stdout (compact, for machines), or to a new file:
/// pretty-printed, unless only the compact form fits `maximum` or what reading
/// a saved document accepts.
pub fn output(value: &Value, path: Option<&PathBuf>, maximum: usize) -> Result<()> {
    let compact = || -> Result<Vec<u8>> {
        let mut bytes = serde_json::to_vec(value)?;
        bytes.push(b'\n');
        Ok(bytes)
    };
    let readable = if value["format"] == "projections.extraction" {
        maximum.min(crate::artifact::MAX_ARTIFACT_BYTES)
    } else {
        maximum
    };
    let bytes = match path {
        Some(_) => Some(crate::json_text::pretty(value)?.into_bytes())
            .filter(|bytes| bytes.len() <= readable)
            .map_or_else(compact, Ok)?,
        None => compact()?,
    };
    ensure!(bytes.len() <= maximum, "CLI document exceeds {maximum} bytes");
    match path {
        Some(path) => crate::create_file(path, &bytes),
        None => Ok(io::stdout().lock().write_all(&bytes)?),
    }
}

/// Prints a document as text, or as JSON with `--json`, or writes the JSON to
/// `--output`. In JSON modes notices go to stderr too, beside the document.
fn present(value: &Value, format: &Format, text: impl FnOnce() -> String, notices: &[String]) -> Result<()> {
    if format.json || format.output.is_some() {
        for notice in notices {
            eprintln!("projections: note: {notice}");
        }
        output(value, format.output.as_ref(), 32 * 1024 * 1024)
    } else {
        io::stdout().lock().write_all(text().as_bytes())?;
        Ok(())
    }
}

/// A failure the command's own output already describes (a batch's failed
/// items, failed checks), so `--json` prints no second, error document.
#[derive(Debug)]
pub struct Reported(String);
impl std::fmt::Display for Reported {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}
impl std::error::Error for Reported {}

fn reported(ok: bool, message: impl FnOnce() -> String) -> Result<()> {
    if ok { Ok(()) } else { Err(Reported(message()).into()) }
}

fn batch_failed(value: &Value) -> Result<()> {
    reported(value["failed"] == 0, || {
        format!("{} of the batch's items failed; the others' results are kept", value["failed"])
    })
}

fn install_cancellation(runner: &Runner) -> Result<()> {
    install_cancellation_for(runner.cancel.clone())
}

fn install_cancellation_for(cancel: Arc<AtomicBool>) -> Result<()> {
    let shutdown = crate::signals::Shutdown::new()?;
    tokio::spawn(async move {
        if let Err(error) = shutdown.wait().await {
            eprintln!("projections: shutdown failed: {error:#}");
        }
        cancel.store(true, Ordering::SeqCst);
    });
    Ok(())
}
