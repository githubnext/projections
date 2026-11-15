//! `doctor`, `prepare` and `workspace`: what a checkout needs to run its
//! projections, and the workspaces Projections keeps.

use std::{
    io::{self, Write},
    path::Path,
};

use anyhow::Result;
use clap::{Args, Subcommand};
use serde_json::json;

use super::{Execution, install_cancellation, output, reported};
use crate::{doctor, help_text, runtime::Runner};

#[derive(Args)]
#[command(
    long_about = help_text::from_markdown(include_str!("help/prepare.long-about.md")),
    after_help = help_text::from_markdown(include_str!("help/prepare.after-help.md"))
)]
pub struct Prepare {
    /// Prepare the workspace for this commit instead of the working tree
    #[arg(long, value_name = "REVISION")]
    pub revision: Option<String>,
    /// Only this step (repeatable)
    #[arg(long = "step", value_name = "ID")]
    pub steps: Vec<String>,
    /// Run the steps even when their key files are unchanged
    #[arg(long)]
    pub force: bool,
    /// Print the projections.prepare document
    #[arg(long)]
    pub json: bool,
    #[command(flatten)]
    pub execution: Execution,
}

#[derive(Subcommand)]
pub enum Workspace {
    /// The workspaces: strategy, commit, prepared steps and whether one is in use
    List {
        #[arg(long)]
        json: bool,
    },
    /// Remove every workspace no run is using (and its Git worktree registration)
    Clean {
        #[arg(long)]
        json: bool,
    },
}

#[derive(Args)]
#[command(
    long_about = help_text::from_markdown(include_str!("help/doctor.long-about.md"))
)]
pub struct Doctor {
    /// The projections to look at [default: all]
    #[arg(short = 'p', long = "projection", value_name = "ID")]
    pub projections: Vec<String>,
    /// Print the projections.doctor document
    #[arg(long)]
    pub json: bool,
}

/// `doctor`: what this checkout needs to run its projections.
pub fn doctor(directory: &Path, args: Doctor) -> Result<()> {
    let runner = Runner::at_checkout(directory.to_path_buf(), false);
    let report = doctor::doctor(&runner, &args.projections);
    if args.json {
        output(&report, None, 32 * 1024 * 1024)?;
    } else {
        io::stdout().lock().write_all(doctor::text(&report).as_bytes())?;
    }
    reported(report["ok"] == true, String::new)?;
    Ok(())
}

/// `prepare`: runs the environment's prepare steps.
pub fn prepare(directory: &Path, args: Prepare) -> Result<()> {
    let runner = args.execution.runner(directory)?;
    install_cancellation(&runner)?;
    let report = runner.prepare_environment(
        args.revision.as_deref(),
        &crate::environment::Options {
            force: args.force,
            steps: args.steps,
        },
    )?;
    if args.json {
        return output(&report, None, 1024 * 1024);
    }
    let mut text = format!(
        "Prepared {} ({}):\n",
        if report["target"] == "working-tree" {
            "the working tree".to_owned()
        } else {
            format!(
                "the {} workspace for {}",
                report["strategy"].as_str().unwrap_or_default(),
                crate::runtime::short(report["target"].as_str().unwrap_or_default())
            )
        },
        report["root"].as_str().unwrap_or_default()
    );
    for step in report["steps"].as_array().into_iter().flatten() {
        text.push_str(&format!(
            "  {}: {}\n",
            step["id"].as_str().unwrap_or_default(),
            if step["status"] == "current" {
                "up to date (its key files are unchanged)".to_owned()
            } else {
                format!("ran in {:.1} s", step["durationMs"].as_u64().unwrap_or(0) as f64 / 1000.0)
            }
        ));
    }
    for note in report["notes"].as_array().into_iter().flatten() {
        text.push_str(&format!("note: {}\n", note.as_str().unwrap_or_default()));
    }
    io::stdout().lock().write_all(text.as_bytes())?;
    Ok(())
}

/// `workspace list` and `workspace clean`.
pub fn workspace(directory: &Path, command: Workspace) -> Result<()> {
    let runner = Runner::at_checkout(directory.to_path_buf(), false);
    match command {
        Workspace::List { json } => {
            let workspaces = crate::workspaces::list(&runner)?;
            if json {
                return output(
                    &json!({"format": "projections.workspaces", "version": 0,
                    "directory": crate::workspaces::directory(&runner)?, "workspaces": workspaces}),
                    None,
                    1024 * 1024,
                );
            }
            let mut text = String::new();
            if workspaces.is_empty() {
                text.push_str("No workspaces yet: one is made when a toolchain extractor examines a commit that isn't checked out.\n");
            }
            for workspace in &workspaces {
                let prepared: Vec<String> = workspace["prepared"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|step| {
                        format!(
                            "{} {}",
                            step["id"].as_str().unwrap_or_default(),
                            step["status"].as_str().unwrap_or_default()
                        )
                    })
                    .collect();
                text.push_str(&format!(
                    "{}  {}  {}{}{}\n    {}\n",
                    workspace["name"].as_str().unwrap_or_default(),
                    workspace["strategy"].as_str().unwrap_or("?"),
                    workspace["commit"].as_str().map(crate::runtime::short).unwrap_or_default(),
                    if prepared.is_empty() {
                        String::new()
                    } else {
                        format!("  prepared: {}", prepared.join(", "))
                    },
                    if workspace["busy"] == true { "  (in use)" } else { "" },
                    workspace["path"].as_str().unwrap_or_default()
                ));
            }
            io::stdout().lock().write_all(text.as_bytes())?;
            Ok(())
        }
        Workspace::Clean { json } => {
            let removed = crate::workspaces::clean(&runner)?;
            if json {
                return output(&json!({"removed": removed}), None, 1024 * 1024);
            }
            println!(
                "Removed {} workspace{}{}",
                removed.len(),
                if removed.len() == 1 { "" } else { "s" },
                if removed.is_empty() {
                    String::new()
                } else {
                    format!(": {}", removed.join(", "))
                }
            );
            Ok(())
        }
    }
}
