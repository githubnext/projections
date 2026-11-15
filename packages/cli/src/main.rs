use anyhow::{Context, Result};
use clap::{CommandFactory, Parser, Subcommand};
use projections_cli::commands::{
    self, Adopt, Bookmark, Canvas, Check, Compare, Doctor, Explore, Extractor, Init, List, Mcp, Prepare, PullRequest, Reported, Serve,
    Show, Validate, View, Workspace, output,
};
use projections_cli::{assets, diagnostics, help_text, scaffold};
use std::{
    io::{self, Write},
    path::{Path, PathBuf},
};

const HELP: &str = "\
{about-with-newline}
{usage-heading} {usage}

Get started:
  explore     Find the projections that apply here and try them on recent changes
  adopt       Keep explored projections: write their definitions and bookmark their best changes

Build a projection of your codebase:
  init        Scaffold a projection, or add a part to one, and the agent skill
  check       Verify projections end to end: extraction, comparison and renderer checks
  doctor      Show what this checkout needs to run its projections, running nothing

Look at a codebase:
  show        Show one revision (the working tree by default) through a projection
  view        Show projections in a page on this machine that an agent drives and you watch
  serve       Serve the VS Code extension over standard input and output (--stdio)
  mcp         Serve Projections' tools to a coding agent (an MCP server over standard input and output)
  list        List the projections a revision defines, running nothing

See how a change reshapes it:
  compare     Compare two revisions, or one revision with the working tree
  bookmark    List or run saved comparisons
  pr          Review a GitHub pull request without running its code

Reference:
  extractor   List or describe the built-in extractors
  validate    Validate a saved extraction, comparison or scenarios document
  help        Help for a command, or `projections help authoring` or `projections help agents`
  licenses    The license and third-party notices of this executable

Options:
{options}{after-help}";

#[derive(Parser)]
#[command(
    name = "projections",
    version,
    disable_help_subcommand = true,
    about = "See the systems in your codebase, and how a change reshapes them, without reading code",
    help_template = HELP,
    after_help = help_text::from_markdown(include_str!("commands/help/projections.after-help.md"))
)]
struct Cli {
    /// Run as if started in DIR, any directory of the repository
    #[arg(short = 'C', long = "directory", value_name = "DIR", global = true, default_value = ".")]
    directory: PathBuf,
    /// The project: the directory whose .github/projections (or .projections) holds the definitions [default: the nearest one from the -C directory up to the repository's root]
    #[arg(long, value_name = "DIR", global = true)]
    root: Option<PathBuf>,
    #[command(subcommand)]
    command: Commands,
}

/// The arguments of a removed command, accepted so it can say what replaced it.
#[derive(clap::Args)]
struct Removed {
    #[arg(trailing_var_arg = true, allow_hyphen_values = true, hide = true)]
    args: Vec<String>,
}

#[derive(Subcommand)]
enum Commands {
    /// Find the projections that apply here and try them on recent changes
    Explore(Explore),
    /// Keep explored projections: write their definitions and bookmark their best changes
    Adopt(Adopt),
    /// Removed: the step belongs in the repository's own CI (projections help agents ci)
    #[command(hide = true)]
    Publish(Removed),
    /// Scaffold a projection, or add a part to one, and the agent skill
    Init(Init),
    /// Verify projections end to end: extraction, comparison and renderer checks
    Check(Check),
    /// Show what this checkout needs to run its projections, running nothing
    Doctor(Doctor),
    /// Run the environment's prepare steps: in the working tree, or in the workspace for a commit
    Prepare(Prepare),
    /// List or remove the workspaces Projections keeps for this repository
    #[command(subcommand)]
    Workspace(Workspace),
    /// Show one revision (the working tree by default) through a projection
    Show(Show),
    /// Serve the VS Code extension over standard input and output (--stdio)
    Serve(Serve),
    /// Serve Projections' tools to a coding agent (an MCP server over standard input and output)
    Mcp(Mcp),
    /// Serve a projection viewer page on loopback that a coding agent drives and a person watches
    View(View),
    /// Add the viewer to the GitHub Copilot app as a canvas, for this repository
    #[command(subcommand)]
    Canvas(Canvas),
    /// List the projections a revision defines, running nothing
    List(List),
    /// Compare two revisions, or one revision with the working tree
    Compare(Compare),
    /// List or run saved comparisons (.projections-bookmarks.json)
    #[command(subcommand)]
    Bookmark(Bookmark),
    /// Review a GitHub pull request without running its code
    Pr(PullRequest),
    /// List or describe the built-in extractors
    #[command(subcommand)]
    Extractor(Extractor),
    /// Validate a saved extraction, comparison or scenarios document
    Validate(Validate),
    /// Help for a command, or a topic: `projections help authoring`, `projections help agents [NAME]`
    Help {
        /// A command, `authoring` for the guide to building a projection, or `agents [NAME]` for the prompts a coding
        /// agent follows
        #[arg(value_name = "COMMAND|TOPIC")]
        topic: Vec<String>,
    },
    /// The license and third-party notices of this executable
    Licenses,
    /// Run one built-in extractor as an extractor process: the public extractor
    /// request on stdin, one extraction on stdout
    #[command(name = "__extract", hide = true)]
    Extract {
        id: String,
        /// This executable's helper directory
        #[arg(long)]
        helpers: Option<PathBuf>,
        /// The cache base the embedded helpers are unpacked into
        #[arg(long)]
        cache_dir: Option<PathBuf>,
    },
    /// Print the directory of the `projections` Python module, which custom
    /// extractors find on PYTHONPATH, to run a Python extractor by hand
    #[command(name = "__python-path", hide = true)]
    PythonPath,
    /// Print the command line as JSON, for the generated CLI reference
    /// (tools/scripts/reference-docs.mjs)
    #[command(name = "__reference", hide = true)]
    Reference,
}

fn help(topic: &[String]) -> Result<()> {
    match topic {
        [one] if one == "authoring" => {
            io::stdout().lock().write_all(scaffold::authoring_guide().as_bytes())?;
            Ok(())
        }
        [one] if one == "agents" => {
            io::stdout()
                .lock()
                .write_all(projections_cli::docs::agent_prompt_list().as_bytes())?;
            Ok(())
        }
        [one, name] if one == "agents" => {
            let prompt = projections_cli::docs::agent_prompt(name)
                .with_context(|| format!("No agent prompt named {name}; `projections help agents` lists them"))?;
            io::stdout().lock().write_all(prompt.as_bytes())?;
            Ok(())
        }
        [] => Ok(Cli::command().print_long_help()?),
        names => {
            let mut command = Cli::command();
            for name in names {
                command = command
                    .find_subcommand(name)
                    .cloned()
                    .with_context(|| format!("No command or help topic named {name}; topics: authoring, agents"))?;
            }
            Ok(command.print_long_help()?)
        }
    }
}

/// Whether the command asked for JSON, so a failure is reported as JSON too.
fn wants_json(command: &Commands) -> bool {
    match command {
        Commands::Show(args) => args.format.json || args.format.output.is_some(),
        Commands::Compare(args) => args.format.json || args.format.output.is_some(),
        Commands::Check(args) => args.json,
        Commands::Doctor(args) => args.json,
        Commands::Prepare(args) => args.json,
        Commands::Workspace(Workspace::List { json } | Workspace::Clean { json }) => *json,
        Commands::List(args) => args.json,
        Commands::Explore(args) => args.json,
        Commands::Adopt(args) => args.json,
        Commands::Publish(_) => false,
        Commands::Validate(args) => args.json,
        Commands::Bookmark(Bookmark::List { json, .. }) | Commands::Extractor(Extractor::List { json } | Extractor::View { json, .. }) => {
            *json
        }
        Commands::Bookmark(Bookmark::Run { format, .. }) | Commands::Pr(PullRequest { format, .. }) => {
            format.json || format.output.is_some()
        }
        _ => false,
    }
}

fn main() -> std::process::ExitCode {
    let cli = Cli::parse();
    // An extractor process stays small: no async runtime, no signal handling;
    // the runner supervises and stops it.
    if let Commands::Extract { id, helpers, cache_dir } = cli.command {
        return projections_cli::extract::main(
            &id,
            projections_cli::extract::Helpers {
                directory: helpers,
                cache: cache_dir,
            },
        );
    }
    let json = wants_json(&cli.command);
    let toplevel = projections_cli::runtime::Runner::at_checkout(cli.directory.clone(), false).repo;
    // A relative --root is in the -C directory, as every other path is.
    let root = cli.root.as_ref().map(|root| cli.directory.join(root));
    match projections_cli::project::choose(&toplevel, &cli.directory, root.as_deref()) {
        Ok(prefix) => projections_cli::project::set(prefix),
        Err(error) => {
            eprintln!("projections: {error:#}");
            return std::process::ExitCode::FAILURE;
        }
    }
    let runtime = tokio::runtime::Runtime::new().expect("Start the async runtime");
    if let Err(error) = runtime.block_on(run(&cli.directory, cli.command)) {
        if error.is::<Reported>() {
            if !error.to_string().is_empty() {
                eprintln!("projections: {error}");
            }
            return std::process::ExitCode::FAILURE;
        }
        let report = diagnostics::report(&error);
        if json {
            let _ = output(&diagnostics::document(report.clone()), None, 32 * 1024 * 1024);
        }
        let _ = std::io::Write::flush(&mut std::io::stdout());
        eprint!("{}", diagnostics::text(&report));
        if let Some(stderr) = report["stderr"].as_str() {
            eprintln!("extractor stderr:\n{}", stderr.trim_end());
        }
        return std::process::ExitCode::FAILURE;
    }
    std::process::ExitCode::SUCCESS
}

async fn run(directory: &Path, command: Commands) -> Result<()> {
    match command {
        Commands::Init(args) => commands::init(directory, args),
        Commands::Check(args) => commands::check(directory, args).await,
        Commands::Doctor(args) => commands::doctor(directory, args),
        Commands::Prepare(args) => commands::prepare(directory, args),
        Commands::Workspace(command) => commands::workspace(directory, command),
        Commands::Show(args) => commands::show(directory, args).await,
        Commands::Compare(args) => commands::compare(directory, args).await,
        Commands::List(args) => commands::list(directory, args),
        Commands::Serve(args) => commands::serve(directory, args).await,
        Commands::Mcp(args) => commands::mcp(directory, args).await,
        Commands::View(args) => commands::view(directory, args).await,
        Commands::Canvas(command) => commands::canvas(directory, command),
        Commands::Explore(args) => commands::explore(directory, args).await,
        Commands::Adopt(args) => commands::adopt(directory, args),
        Commands::Publish(_) => anyhow::bail!(
            "projections publish was removed: where the Projections step goes depends on your CI, so your coding agent adds it (projections help agents ci prints its guide), or see {}docs/setup/ci.md",
            projections_cli::docs::DOCS_BASE
        ),
        Commands::Bookmark(command) => commands::bookmark(directory, command),
        Commands::Pr(args) => commands::pull_request(directory, args),
        Commands::Extractor(command) => commands::extractor(command),
        Commands::Validate(args) => commands::validate(args),
        Commands::Help { topic } => help(&topic),
        Commands::Licenses => {
            let licenses = assets::licenses().context(
                "This build does not include the Inspector client, whose notices cover the executable; build the browser client before rebuilding the native CLI",
            )?;
            io::stdout().lock().write_all(licenses.as_bytes())?;
            Ok(())
        }
        Commands::PythonPath => {
            let directory = projections_cli::python::directory_in(&projections_cli::cache::base()?)?;
            writeln!(io::stdout().lock(), "{}", directory.display())?;
            Ok(())
        }
        Commands::Reference => {
            let reference = projections_cli::reference::command_reference(&Cli::command());
            writeln!(io::stdout().lock(), "{}", serde_json::to_string_pretty(&reference)?)?;
            Ok(())
        }
        Commands::Extract { .. } => unreachable!("handled before the async runtime starts"),
    }
}
