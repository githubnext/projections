//! `serve --stdio` and `mcp`: the Inspector service for an editor, and the
//! agent tools for a coding agent.

use std::path::{Path, PathBuf};

use anyhow::{Result, bail};
use clap::Args;

use super::Sources;
use crate::{artifact, assets, help_text, runtime::Runner, service};

#[derive(Args)]
#[command(
    long_about = help_text::from_markdown(include_str!("help/serve.long-about.md")),
    after_help = help_text::from_markdown(include_str!("help/serve.after-help.md"))
)]
pub struct Serve {
    /// Speak JSON-RPC 2.0 over standard input and output, one message per line (required: the only transport)
    #[arg(long)]
    pub stdio: bool,
    /// Let it run repository code (custom extractors and renderers) and write repository files; with --fixtures, the renderer bundles the scenarios name
    #[arg(long, conflicts_with = "document")]
    pub trust: bool,
    /// Present a saved extraction, comparison or pull request review instead of the repository, running nothing
    #[arg(long, value_name = "FILE", conflicts_with = "fixtures")]
    pub document: Option<PathBuf>,
    /// Serve projections.scenarios documents (or directories holding scenarios.json) for developing a renderer or comparator, instead of a repository; runs no extractors
    #[arg(long, value_name = "PATH", num_args = 1..)]
    pub fixtures: Vec<PathBuf>,
    /// With --fixtures, renderer bundle directories (index.html and renderer.json), or packages whose package.json names one in projections.renderer
    #[arg(long, value_name = "DIR", num_args = 1.., requires = "fixtures")]
    pub renderer: Vec<PathBuf>,
    #[command(flatten)]
    pub sources: Sources,
}

#[derive(Args)]
#[command(
    long_about = help_text::from_markdown(include_str!("help/mcp.long-about.md")),
    after_help = help_text::from_markdown(include_str!("help/mcp.after-help.md"))
)]
pub struct Mcp {
    /// Let the tools run repository code (custom extractors) and write repository files outside an explore session. Review the projections' code first
    #[arg(long)]
    pub trust: bool,
    #[command(flatten)]
    pub sources: Sources,
}

/// `serve --stdio`: the Inspector API for an editor extension, over standard
/// input and output.
pub async fn serve(directory: &Path, args: Serve) -> Result<()> {
    if !args.stdio {
        bail!(
            "serve needs --stdio: it speaks JSON-RPC over standard input and output to the editor extension that starts it, and has no other transport"
        );
    }
    let client = assets::inspector_assets()?;
    // A saved document, or renderer scenarios: no repository, nothing runs.
    if args.document.is_some() || !args.fixtures.is_empty() {
        let document = args.document.as_deref().map(artifact::read_document).transpose()?;
        let options = service::InspectorOptions {
            repo: std::env::current_dir()?,
            trust: false,
            document,
            custom_renderers: false,
            assets: client.path.clone(),
            fixtures: (!args.fixtures.is_empty()).then_some(service::FixturesOptions {
                sources: args.fixtures,
                renderers: args.renderer,
                trust: args.trust,
            }),
            executable: None,
            explore: None,
            candidates: Vec::new(),
            execution: Default::default(),
        };
        return crate::stdio::serve(options).await;
    }
    crate::stdio::serve(repository_options(directory, args.trust, &client.path, &args.sources)?).await
}

/// The service for the repository at `directory`, as `serve --stdio` and `mcp` present it.
pub(super) fn repository_options(directory: &Path, trust: bool, assets: &Path, sources: &Sources) -> Result<service::InspectorOptions> {
    let runner = Runner::at_checkout(directory.to_path_buf(), false);
    let root = runner.repository_root()?;
    // Explore's candidates, which the Explore view sweeps, opens and adopts.
    let candidates = crate::explore::candidates(&runner, &root).unwrap_or_else(|error| {
        eprintln!("projections: no explore candidates: {error:#}");
        Vec::new()
    });
    // While the working tree defines no projections of its own, it is an
    // explore session: the candidates `projections explore` lists are trial
    // definitions it lists, and adopting writes without --trust. Otherwise the Inspector lists only the repository's own
    // projections, and a candidate only when the Explore view opens it.
    let explore = (!crate::workspace::authored(&root)).then(|| candidates.clone());
    Ok(service::InspectorOptions {
        repo: root,
        trust,
        document: None,
        custom_renderers: false,
        assets: assets.to_path_buf(),
        fixtures: None,
        executable: None,
        explore,
        candidates,
        execution: sources.policy(),
    })
}

/// `mcp`: the agent tools for a coding agent, as an MCP server over standard input and output.
pub async fn mcp(directory: &Path, args: Mcp) -> Result<()> {
    let client = assets::inspector_assets()?;
    crate::mcp::serve(repository_options(directory, args.trust, &client.path, &args.sources)?).await
}
