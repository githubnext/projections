//! `show`, `compare` and `list`: a revision or a change through a projection,
//! as text, JSON or a PNG (see `image`).

use std::{
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool},
};

use anyhow::{Context, Result, bail};
use clap::Args;
use serde_json::json;

use super::image::{Png, draw, draw_with, ready_to_draw};
use super::{Definition, Execution, batch_failed, install_cancellation, install_cancellation_for, output, present, reported};
use crate::{
    artifact, help_text, render,
    runtime::{DefinitionSource, Runner},
    workspace,
};

#[derive(Args)]
#[command(next_help_heading = "Output")]
pub struct Format {
    /// Print the JSON document instead of text
    #[arg(long)]
    pub json: bool,
    /// Write the JSON document to a new FILE instead of printing it
    #[arg(long, value_name = "FILE")]
    pub output: Option<PathBuf>,
}

#[derive(Args)]
#[command(
    override_usage = "projections show [OPTIONS] [REVISION]\n       projections show --all [OPTIONS] [REVISION]\n       projections show --from <FILE> [OPTIONS]",
    long_about = help_text::from_markdown(include_str!("help/show.long-about.md")),
    after_help = help_text::from_markdown(include_str!("help/show.after-help.md"))
)]
pub struct Show {
    /// Revision to show: a commit, branch, tag or working-tree [default: working-tree]
    pub revision: Option<String>,
    /// The projection [default: the only one defined]
    #[arg(short = 'p', long = "projection", value_name = "ID", conflicts_with = "all")]
    pub projection: Option<String>,
    /// Show every projection the revision defines, keeping each one's failure
    #[arg(long, conflicts_with_all = ["definition_revision", "image"])]
    pub all: bool,
    /// Apply the definition and component code from this revision, so extractions of several revisions compare
    #[arg(long, value_name = "REVISION")]
    pub definition_revision: Option<String>,
    /// Present a saved extraction or comparison document instead of running extractors; with -p, an extractor's raw output, which the working tree's definition of that projection normalizes, digests and validates
    #[arg(long, value_name = "FILE", conflicts_with_all = ["revision", "all", "definition_revision", "container_image"])]
    pub from: Option<PathBuf>,
    #[command(flatten)]
    pub format: Format,
    #[command(flatten)]
    pub png: Png,
    #[command(flatten)]
    pub execution: Execution,
}

#[derive(Args)]
#[command(
    override_usage = "projections compare [OPTIONS] <BASE>[..<HEAD>]\n       projections compare --all [OPTIONS] <BASE>[..<HEAD>]\n       projections compare --before-extraction <FILE> --after-extraction <FILE> [-p <ID>] [--comparator <FILE>]",
    long_about = help_text::from_markdown(include_str!("help/compare.long-about.md")),
    after_help = help_text::from_markdown(include_str!("help/compare.after-help.md"))
)]
pub struct Compare {
    /// <BASE>[..<HEAD>] or <BASE>...<HEAD>
    #[arg(value_name = "RANGE")]
    pub range: Option<String>,
    /// The projection [default: the only one defined]
    #[arg(short = 'p', long = "projection", value_name = "ID", conflicts_with = "all")]
    pub projection: Option<String>,
    /// Compare every projection either revision defines, keeping each one's failure
    #[arg(long, conflicts_with = "image")]
    pub all: bool,
    /// Which revision's projection definition and component code to apply to both revisions
    #[arg(long, value_enum, default_value = "base")]
    pub definition: Definition,
    /// Apply this revision's definition and component code to both instead, for example working-tree to try uncommitted projection code on real history
    #[arg(long, value_name = "REVISION", conflicts_with_all = ["definition", "all"])]
    pub definition_revision: Option<String>,
    /// Compare two saved extractions instead of running extractors. With -p ID, either may also be extractor output (or a saved extraction edited by hand), made a document with the working tree's definition of ID
    #[arg(long, value_name = "FILE", requires = "after_extraction",
        conflicts_with_all = ["range", "all", "container_image"])]
    pub before_extraction: Option<PathBuf>,
    /// The saved extraction to compare with --before-extraction
    #[arg(long, value_name = "FILE", requires = "before_extraction")]
    pub after_extraction: Option<PathBuf>,
    /// The custom comparator file the saved extractions' definition names [default with -p: the working tree's]
    #[arg(long, value_name = "FILE", requires = "before_extraction")]
    pub comparator: Option<PathBuf>,
    #[command(flatten)]
    pub format: Format,
    #[command(flatten)]
    pub png: Png,
    #[command(flatten)]
    pub execution: Execution,
}

#[derive(Args)]
pub struct List {
    /// The revision whose definitions to list
    #[arg(long, default_value = "working-tree")]
    pub revision: String,
    /// Print the JSON document instead of text
    #[arg(long)]
    pub json: bool,
}

/// The projection a command applies to: the one named, or the only one defined.
pub(super) fn projection(runner: &Runner, named: Option<String>, reference: &str) -> Result<String> {
    if let Some(id) = named {
        return Ok(id);
    }
    let definitions = runner.discover(reference)?;
    let ids: Vec<&str> = definitions.iter().filter_map(|definition| definition["id"].as_str()).collect();
    match ids[..] {
        [id] => Ok(id.to_owned()),
        _ => bail!("Choose a projection with -p: {} defines {}", reference, ids.join(", ")),
    }
}

pub async fn show(directory: &Path, args: Show) -> Result<()> {
    ready_to_draw(&args.png, args.from.is_none().then_some(false))?;
    if let Some(file) = &args.from {
        let document = match &args.projection {
            Some(id) => Runner::at_checkout(directory.to_path_buf(), false).supplied(id, file)?,
            None => artifact::read_document(file)?,
        };
        let text = || {
            if document["format"] == "projections.comparison" {
                render::comparison(&document, &[])
            } else {
                render::extraction(&document)
            }
        };
        present(&document, &args.format, text, &[])?;
        // Nothing is extracted; --trust lets the definition's custom renderer draw the image.
        let runner = Runner::at_checkout(directory.to_path_buf(), args.execution.trust);
        let cancel = Arc::new(AtomicBool::new(false));
        install_cancellation_for(cancel.clone())?;
        return draw(&args.png, document, &runner, DefinitionSource::Base, cancel).await;
    }
    let runner = args.execution.runner(directory)?;
    install_cancellation(&runner)?;
    let reference = args.revision.as_deref().unwrap_or("working-tree");
    if args.all {
        let value = runner.show_all(reference, &[])?;
        present(&value, &args.format, || render::batch(&value), &[])?;
        return batch_failed(&value);
    }
    let id = projection(&runner, args.projection, args.definition_revision.as_deref().unwrap_or(reference))?;
    let value = runner.show(&id, reference, args.definition_revision.as_deref())?;
    let notices: Vec<String> = artifact::missing_input_notice(&value).into_iter().collect();
    present(&value, &args.format, || render::extraction(&value), &notices)?;
    draw(&args.png, value, &runner, DefinitionSource::Base, runner.cancel.clone()).await
}

pub async fn compare(directory: &Path, args: Compare) -> Result<()> {
    if let Some(before) = &args.before_extraction {
        return compare_saved(directory, &args, before).await;
    }
    ready_to_draw(&args.png, Some(true))?;
    let range = args
        .range
        .context("Name the revisions to compare: projections compare <BASE>[..<HEAD>]; one revision compares with the working tree")?;
    let runner = args.execution.runner(directory)?;
    install_cancellation(&runner)?;
    let source = DefinitionSource::from(args.definition);
    let (before, after) = runner.resolve_range(&range)?;
    if args.all {
        let value = runner.compare_all(&before, &after, &[], source)?;
        present(&value, &args.format, || render::batch(&value), &[])?;
        return batch_failed(&value);
    }
    let id = projection(
        &runner,
        args.projection,
        match &args.definition_revision {
            Some(revision) => revision,
            None if source == DefinitionSource::Base => &before,
            None => &after,
        },
    )?;
    let compared = match &args.definition_revision {
        Some(revision) => runner.compare_using(&id, &before, &after, revision)?,
        None => runner.compare_with(&id, &before, &after, source)?,
    };
    present(
        &compared.document,
        &args.format,
        || render::comparison(&compared.document, &compared.notices),
        &compared.notices,
    )?;
    // The image serves the renderer of a commit (or the working tree), not a symbolic ref.
    let definition_revision = match args.definition_revision.as_deref() {
        Some("working-tree") => Some("working-tree".to_owned()),
        Some(reference) => Some(runner.resolve(&runner.repository_root()?, reference)?),
        None => None,
    };
    draw_with(
        &args.png,
        compared.document,
        &runner,
        source,
        definition_revision,
        runner.cancel.clone(),
    )
    .await
}

/// `compare --before-extraction FILE --after-extraction FILE`: two saved
/// extractions (or, with `-p ID`, extractor output) compared without running
/// an extractor.
async fn compare_saved(directory: &Path, args: &Compare, before: &Path) -> Result<()> {
    ready_to_draw(&args.png, Some(true))?;
    // Nothing is extracted; --trust lets the definition's custom renderer draw the image.
    let runner = Runner::at_checkout(directory.to_path_buf(), args.execution.trust);
    let id = args.projection.as_deref();
    let before = runner.saved_or_supplied(id, before)?;
    let after = runner.saved_or_supplied(id, args.after_extraction.as_deref().context("Missing after extraction")?)?;
    // The comparator file: as given, else (with -p) the one the working tree's definition names.
    let comparator = match (&args.comparator, artifact::custom_comparator(&before["provenance"]["definition"])) {
        (Some(path), _) => Some((artifact::read_artifact(path, 64 * 1024 * 1024)?, path.display().to_string())),
        (None, Some(path)) if id.is_some() => {
            let file = runner.repository_root()?.join(crate::project::resolve(path)?);
            Some((artifact::read_artifact(&file, 64 * 1024 * 1024)?, path.to_owned()))
        }
        (None, _) => None,
    };
    let value = artifact::compare_extractions_from(
        &before,
        &after,
        comparator.as_ref().map(|(bytes, _)| bytes.as_slice()),
        comparator.as_ref().map(|(_, file)| file.as_str()),
    )?;
    present(&value, &args.format, || render::comparison(&value, &[]), &[])?;
    let cancel = Arc::new(AtomicBool::new(false));
    install_cancellation_for(cancel.clone())?;
    draw(&args.png, value, &runner, DefinitionSource::Base, cancel).await
}

pub fn list(directory: &Path, args: List) -> Result<()> {
    let runner = Runner::at_checkout(directory.to_path_buf(), false);
    install_cancellation(&runner)?;
    let mut value = runner.list(&args.revision)?;
    let defaults = args.revision == "working-tree" && !workspace::authored(&runner.repository_root()?);
    value["defaults"] = json!(defaults);
    let invalid = value["invalid"].as_array().cloned().unwrap_or_default();
    // Invalid definition files are listed with their diagnostics, beside the valid ones, and fail the command.
    let failure = || {
        format!(
            "{} definition file{} invalid",
            invalid.len(),
            if invalid.len() == 1 { " is" } else { "s are" }
        )
    };
    if args.json {
        output(&value, None, 32 * 1024 * 1024)?;
        return reported(invalid.is_empty(), failure);
    }
    let mut text = if defaults {
        "This repository defines no projections yet, so the built-in defaults apply. Make one with projections init <id>.\n".to_owned()
    } else {
        String::new()
    };
    text.push_str(&format!(
        "Projections at {}:\n",
        render::revision(&json!({"provenance": {"revision": value["revision"]}}))
    ));
    for projection in value["projections"].as_array().into_iter().flatten() {
        let renderer = &projection["renderer"];
        text.push_str(&format!(
            "  {}: {} (renderer {}){}{}\n",
            projection["id"].as_str().unwrap_or_default(),
            projection["title"].as_str().unwrap_or_default(),
            renderer.as_str().or(renderer["bundle"].as_str()).unwrap_or_default(),
            if projection["requiresTrust"] == true {
                "; runs repository code, requires --trust"
            } else {
                ""
            },
            if projection["rendererRequiresTrust"] == true {
                "; its custom renderer differs from the default branch's and requires --trust"
            } else {
                ""
            }
        ));
    }
    for failure in &invalid {
        text.push_str(&format!(
            "  {}: invalid: {}\n",
            failure["id"].as_str().unwrap_or("?"),
            crate::runtime::invalid_summary(failure)
        ));
    }
    io::stdout().lock().write_all(text.as_bytes())?;
    reported(invalid.is_empty(), failure)
}
