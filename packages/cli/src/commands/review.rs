//! `bookmark` and `pr`: saved comparisons and pull request reviews.

use std::{
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool},
};

use anyhow::{Context, Result, bail, ensure};
use clap::{Args, Subcommand};

use super::{Definition, Execution, Format, batch_failed, install_cancellation, install_cancellation_for, output, present, reported};
use crate::{
    help_text, pull_request, render,
    runtime::{DefinitionChoice, DefinitionSource, Runner},
};

#[derive(Subcommand)]
pub enum Bookmark {
    /// List the saved comparisons
    List {
        /// The revision whose bookmarks to read
        #[arg(long, default_value = "working-tree")]
        revision: String,
        /// Print the JSON document instead of text
        #[arg(long)]
        json: bool,
    },
    /// Compare saved comparisons, keeping each one's failure
    Run {
        /// Bookmark IDs [default: all]
        ids: Vec<String>,
        /// Which revision's projection definition and component code to apply to both revisions [default: base, or the working tree's when neither revision defines the projection]
        #[arg(long, value_enum)]
        definition: Option<Definition>,
        /// Apply this revision's definition and component code to both instead, for example working-tree to try uncommitted projection code on the saved comparisons
        #[arg(long, value_name = "REVISION", conflicts_with = "definition")]
        definition_revision: Option<String>,
        #[command(flatten)]
        format: Format,
        #[command(flatten)]
        execution: Execution,
    },
}

#[derive(Args)]
#[command(
    long_about = help_text::from_markdown(include_str!("help/pr.long-about.md")),
    after_help = help_text::from_markdown(include_str!("help/pr.after-help.md"))
)]
pub struct PullRequest {
    /// The pull request: a number or URL
    #[arg(value_name = "NUMBER|URL")]
    pub target: String,
    /// The repository: [HOST/]OWNER/REPO [default: from the URL, or this checkout's origin remote]
    #[arg(short = 'R', long = "repo", value_name = "[HOST/]OWNER/REPO")]
    pub repository: Option<String>,
    /// Compare only these projections
    #[arg(long = "id", value_name = "ID")]
    pub ids: Vec<String>,
    /// The parent directory for the isolated acquisition working directory
    #[arg(long, value_name = "DIR")]
    pub cache: Option<PathBuf>,
    #[command(flatten)]
    pub format: Format,
}

/// A pull request target: `(repository, number, host)`.
fn pull_request_target(directory: &Path, target: &str, repository: Option<&str>) -> Result<(String, u64, String)> {
    let split = |repository: &str| -> Result<(String, String)> {
        let parts: Vec<&str> = repository.trim_end_matches('/').split('/').collect();
        match parts[..] {
            [owner, name] => Ok(("github.com".to_owned(), format!("{owner}/{name}"))),
            [host, owner, name] => Ok((host.to_owned(), format!("{owner}/{name}"))),
            _ => bail!("-R takes [HOST/]OWNER/REPO, not {repository}"),
        }
    };
    if let Some(rest) = target.strip_prefix("https://").or_else(|| target.strip_prefix("http://")) {
        let parts: Vec<&str> = rest.trim_end_matches('/').split('/').collect();
        let [host, owner, name, "pull", number, ..] = parts[..] else {
            bail!("Not a pull request URL: {target}");
        };
        ensure!(repository.is_none(), "A pull request URL names its repository; drop -R");
        return Ok((
            format!("{owner}/{name}"),
            number.parse().with_context(|| format!("Not a pull request number: {number}"))?,
            host.to_owned(),
        ));
    }
    let number: u64 = target
        .trim_start_matches('#')
        .parse()
        .with_context(|| format!("Name a pull request by number or URL, not {target}"))?;
    let (host, repository) = match repository {
        Some(repository) => split(repository)?,
        None => {
            let runner = Runner::at_checkout(directory.to_path_buf(), false);
            let root = runner
                .repository_root()
                .context("Name the repository with -R [HOST/]OWNER/REPO, or run this in its checkout")?;
            let remote = runner
                .git_text(&root, &["remote", "get-url", "origin"])
                .context("This checkout has no origin remote; name the repository with -R")?;
            let remote = remote.trim_end_matches(".git");
            let path = remote
                .strip_prefix("git@")
                .map(|rest| rest.replacen(':', "/", 1))
                .or_else(|| {
                    remote
                        .split_once("://")
                        .map(|(_, rest)| rest.rsplit_once('@').map_or(rest, |(_, rest)| rest).to_owned())
                })
                .with_context(|| format!("Can't read a GitHub repository from the origin remote {remote}; name it with -R"))?;
            split(&path)?
        }
    };
    Ok((repository, number, host))
}

/// `pr`: reviews a GitHub pull request without running its code.
pub fn pull_request(directory: &Path, args: PullRequest) -> Result<()> {
    let (repository, number, host) = pull_request_target(directory, &args.target, args.repository.as_deref())?;
    let cancel = Arc::new(AtomicBool::new(false));
    install_cancellation_for(cancel.clone())?;
    let review = pull_request::review(&repository, number, &host, args.cache.as_deref(), &args.ids, cancel)?;
    present(
        &review,
        &args.format,
        || {
            format!(
                "{host}/{repository}#{number}, compared without running its code:\n{}",
                render::batch(&review["comparisons"])
            )
        },
        &[],
    )?;
    reported(review["comparisons"]["failed"] == 0, || {
        format!(
            "{} of the pull request's comparisons failed; execution stays untrusted",
            review["comparisons"]["failed"]
        )
    })?;
    Ok(())
}

/// `bookmark list` and `bookmark run`.
pub fn bookmark(directory: &Path, command: Bookmark) -> Result<()> {
    match command {
        Bookmark::List { revision, json } => {
            let runner = Runner::at_checkout(directory.to_path_buf(), false);
            install_cancellation(&runner)?;
            let value = runner.bookmarks(&revision)?;
            if json {
                return output(&value, None, 1024 * 1024);
            }
            let mut text = String::new();
            for bookmark in value["bookmarks"].as_array().into_iter().flatten() {
                text.push_str(&format!(
                    "  {}: {}{}\n",
                    bookmark["id"].as_str().unwrap_or_default(),
                    bookmark["title"].as_str().or(bookmark["description"].as_str()).unwrap_or_default(),
                    bookmark["before"]
                        .as_str()
                        .zip(bookmark["after"].as_str())
                        .map_or_else(String::new, |(before, after)| format!(" ({before}..{after})")),
                ));
            }
            if text.is_empty() {
                text = "No bookmarks: add them to .projections-bookmarks.json\n".to_owned();
            } else {
                text = format!("Bookmarks:\n{text}");
            }
            io::stdout().lock().write_all(text.as_bytes())?;
            Ok(())
        }
        Bookmark::Run {
            ids,
            definition,
            definition_revision,
            format,
            execution,
        } => {
            let runner = execution.runner(directory)?;
            install_cancellation(&runner)?;
            let choice = match (definition_revision, definition) {
                (Some(revision), _) => DefinitionChoice::Revision(revision),
                (None, Some(definition)) => DefinitionChoice::Side(DefinitionSource::from(definition)),
                (None, None) => DefinitionChoice::Default,
            };
            let value = runner.compare_bookmarks("working-tree", &ids, &choice)?;
            present(&value, &format, || render::batch(&value), &[])?;
            batch_failed(&value)
        }
    }
}
