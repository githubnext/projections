//! `explore` and `adopt`: finding the projections that apply, and keeping them.

use std::{
    io::{self, IsTerminal, Write},
    path::Path,
};

use anyhow::{Result, ensure};
use clap::Args;
use serde_json::{Value, json};

use super::{install_cancellation, output};
use crate::{help_text, runtime::Runner};

#[derive(Args)]
#[command(
    long_about = help_text::from_markdown(include_str!("help/explore.long-about.md")),
    after_help = help_text::from_markdown(include_str!("help/explore.after-help.md"))
)]
pub struct Explore {
    /// Print only the candidates
    #[arg(long, conflicts_with = "sweep")]
    pub list: bool,
    /// Try the candidates (and the projections already adopted) on recent changes and print what each shows
    #[arg(long)]
    pub sweep: bool,
    /// With --sweep, the projections to try [default: the candidates and adopted projections]
    #[arg(short = 'p', long = "projection", value_name = "ID", requires = "sweep")]
    pub projections: Vec<String>,
    /// The recent changes to sweep: merges into the current branch when it takes changes by merging, else first-parent commits (1-100)
    #[arg(long, value_name = "N", default_value_t = crate::sweep::DEFAULT_LAST as u16, value_parser = clap::value_parser!(u16).range(1..=100))]
    pub last: u16,
    /// Extractor processes to run at once
    #[arg(long, value_name = "N", default_value_t = crate::sweep::DEFAULT_CONCURRENCY as u8, value_parser = clap::value_parser!(u8).range(1..=8))]
    pub concurrency: u8,
    /// With --list or --sweep, print JSON
    #[arg(long)]
    pub json: bool,
    /// With --sweep, let candidates and projections that run repository code run
    #[arg(long, requires = "sweep")]
    pub trust: bool,
}

pub async fn explore(directory: &Path, args: Explore) -> Result<()> {
    let runner = Runner::at_checkout(directory.to_path_buf(), false);
    let root = runner.repository_root()?;
    let candidates = crate::explore::candidates(&runner, &root)?;
    if args.sweep {
        return explore_sweep(&root, args, candidates);
    }
    if args.list && args.json {
        return output(
            &json!({"format": "projections.explore", "version": 0, "candidates": candidates}),
            None,
            32 * 1024 * 1024,
        );
    }
    let mut out = io::stdout().lock();
    out.write_all(crate::explore::text(&candidates).as_bytes())?;
    if !args.list {
        writeln!(
            out,
            "Run `projections explore --sweep` to try them on recent changes, or `projections adopt <id>...` to keep the useful ones."
        )?;
    }
    Ok(())
}

#[derive(Args)]
#[command(
    about = "Keep explored projections: write their definitions and bookmark their best changes",
    long_about = help_text::from_markdown(include_str!("help/adopt.long-about.md")),
    after_help = help_text::from_markdown(include_str!("help/adopt.after-help.md"))
)]
pub struct Adopt {
    /// The candidates to adopt (see projections explore --list)
    #[arg(value_name = "ID", required = true)]
    pub projections: Vec<String>,
    /// Bookmark each projection's N most-changed recent changes (0 sweeps nothing)
    #[arg(long, value_name = "N", default_value_t = 3, value_parser = clap::value_parser!(u8).range(0..=20))]
    pub bookmarks: u8,
    /// The recent changes to look for them in (1-100)
    #[arg(long, value_name = "N", default_value_t = crate::sweep::DEFAULT_LAST as u16, value_parser = clap::value_parser!(u16).range(1..=100))]
    pub last: u16,
    /// Print what would be written, writing nothing
    #[arg(long)]
    pub dry_run: bool,
    /// Let candidates that run repository code extract, to find their bookmarks
    #[arg(long)]
    pub trust: bool,
    /// Print the result as JSON
    #[arg(long)]
    pub json: bool,
}

pub fn adopt(directory: &Path, args: Adopt) -> Result<()> {
    use crate::{explore, onboard, sweep};
    let runner = Runner::at_checkout(directory.to_path_buf(), args.trust);
    install_cancellation(&runner)?;
    let root = runner.repository_root()?;
    let candidates = explore::candidates(&runner, &root)?;
    // Fails early on an unknown or adopted ID, before any sweep.
    onboard::adopt(&root, &candidates, &args.projections, &[], None, true)?;
    let mut highlights = Vec::new();
    let mut notes = Vec::new();
    if args.bookmarks > 0 {
        let changes = sweep::changes(&runner, &root, usize::from(args.last))?;
        if !changes.is_empty() {
            let trial = Runner::new(root.clone(), args.trust).with_trials(explore::trials(&candidates))?;
            install_cancellation(&trial)?;
            let rows = std::sync::Mutex::new(Vec::new());
            let cells = std::sync::Mutex::new(Vec::new());
            let cache = sweep::Cache::default();
            sweep::run(
                &trial,
                sweep::Request {
                    projections: args.projections.clone(),
                    changes: changes.clone(),
                    cache: &cache,
                    concurrency: sweep::DEFAULT_CONCURRENCY,
                },
                &|row| rows.lock().unwrap().push(row),
                &|cell| cells.lock().unwrap().push(cell.value),
            )?;
            let cells = cells.into_inner().unwrap();
            for row in rows.into_inner().unwrap() {
                let id = row["projection"].as_str().unwrap_or_default();
                if row["status"] != "ready" {
                    notes.push(format!("{id} has no bookmarks: {}", row["error"].as_str().unwrap_or_default()));
                    continue;
                }
                let found = onboard::bookmarks::highlights(id, &changes, &cells, usize::from(args.bookmarks));
                if found.is_empty() {
                    notes.push(format!(
                        "{id} showed no change in the last {} changes, so nothing was bookmarked",
                        changes.len()
                    ));
                }
                highlights.extend(found);
            }
        }
    }
    let result = onboard::adopt(&root, &candidates, &args.projections, &highlights, None, args.dry_run)?;
    if args.json {
        let mut result = result;
        result["notes"] = json!(notes);
        return output(&result, None, 32 * 1024 * 1024);
    }
    let mut text = onboard::text(&result, args.dry_run);
    for note in notes {
        text.push_str(&format!("note: {note}\n"));
    }
    text.push_str(if args.dry_run {
        "\nNothing was written. Adopt them: rerun without --dry-run.\n"
    } else {
        "\nCommit these files. See one in the viewer: `projections view show -p <id> --open`. Add them to CI with your coding agent: `projections help agents ci`.\n"
    });
    io::stdout().lock().write_all(text.as_bytes())?;
    Ok(())
}

/// `explore --sweep`: each projection across recent changes, in the terminal.
fn explore_sweep(root: &Path, args: Explore, candidates: Vec<Value>) -> Result<()> {
    use crate::sweep;
    let runner = Runner::new(root.to_path_buf(), args.trust).with_trials(crate::explore::trials(&candidates))?;
    install_cancellation(&runner)?;
    let projections = if args.projections.is_empty() {
        sweep::projections(&runner, &candidates)?
    } else {
        args.projections
    };
    let changes = sweep::changes(&runner, root, usize::from(args.last))?;
    ensure!(
        !changes.is_empty(),
        "This repository has no changes to sweep yet: it needs at least two commits"
    );
    let cache = sweep::Cache::default();
    let progress = !args.json && io::stderr().is_terminal();
    let rows = std::sync::Mutex::new(Vec::new());
    let cells = std::sync::Mutex::new(Vec::new());
    sweep::run(
        &runner,
        sweep::Request {
            projections,
            changes: changes.clone(),
            cache: &cache,
            concurrency: usize::from(args.concurrency),
        },
        &|row| rows.lock().unwrap().push(row),
        &|cell| {
            let mut cells = cells.lock().unwrap();
            cells.push(cell.value);
            if progress {
                let ready = rows.lock().unwrap().iter().filter(|row| row["status"] == "ready").count();
                eprint!("\rSwept {} of {}", cells.len(), ready * changes.len());
            }
        },
    )?;
    if progress {
        eprintln!();
    }
    let (rows, cells) = (rows.into_inner().unwrap(), cells.into_inner().unwrap());
    if args.json {
        // Rows best signal first, each ready one with its signal.
        let rows: Vec<Value> = sweep::signal::ranked(&rows, &cells.iter().collect::<Vec<_>>())
            .into_iter()
            .map(|(row, tally)| {
                let mut row = row.clone();
                if let Some(tally) = tally {
                    row["signal"] = json!(tally.signal.name());
                    row["changed"] = json!(tally.changed);
                }
                row
            })
            .collect();
        return output(
            &json!({"format": "projections.sweep", "version": 0,
                "changes": changes.iter().map(sweep::Change::json).collect::<Vec<_>>(),
                "projections": rows, "cells": cells}),
            None,
            32 * 1024 * 1024,
        );
    }
    io::stdout().lock().write_all(sweep::text(&changes, &rows, &cells).as_bytes())?;
    println!("\nSee and tune them on these changes: projections explore. Keep the useful ones: projections adopt <id>...");
    Ok(())
}
