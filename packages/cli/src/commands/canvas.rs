//! `canvas install`: the GitHub Copilot app canvas extension that shows the viewer.

use std::path::Path;

use anyhow::{Context, Result, ensure};
use clap::Subcommand;

use crate::{help_text, runtime::Runner};

#[derive(Subcommand)]
pub enum Canvas {
    /// Write the Projections canvas extension to .github/extensions/projections/extension.mjs
    #[command(
        long_about = help_text::from_markdown(include_str!("help/canvas-install.long-about.md"))
    )]
    Install {
        /// Replace an existing extension file
        #[arg(long)]
        force: bool,
    },
}

/// The Copilot canvas extension, as `projections canvas install` writes it.
const CANVAS_EXTENSION: &str = include_str!("../../../integrations/copilot-canvas/extension.mjs");

/// `canvas install`: writes the canvas extension into the repository.
pub fn canvas(directory: &Path, command: Canvas) -> Result<()> {
    let Canvas::Install { force } = command;
    let root = Runner::at_checkout(directory.to_path_buf(), false).repository_root()?;
    let folder = root.join(".github/extensions/projections");
    let file = folder.join("extension.mjs");
    if let Ok(existing) = std::fs::read_to_string(&file) {
        if existing == CANVAS_EXTENSION {
            println!("{} is up to date.", file.display());
            return Ok(());
        }
        ensure!(force, "{} exists; replace it with --force", file.display());
    }
    std::fs::create_dir_all(&folder).with_context(|| format!("Cannot create {}", folder.display()))?;
    std::fs::write(&file, CANVAS_EXTENSION).with_context(|| format!("Cannot write {}", file.display()))?;
    println!(
        "Wrote {}.\nThe GitHub Copilot app loads it for this repository (reload extensions, or start a new session): its \"projections\" canvas shows the viewer. Commit it to share it.",
        file.display()
    );
    Ok(())
}
