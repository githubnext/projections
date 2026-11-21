//! `init`, `check`, `validate` and `extractor`: building and verifying projections.

use std::{
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, Result, bail, ensure};
use clap::{Args, Subcommand, ValueEnum};
use serde_json::{Value, json};

use super::{Execution, install_cancellation, output, reported};
use crate::{artifact, check, engine, fixtures, help_text, runtime::Runner, scaffold};

#[derive(Clone, Copy, ValueEnum)]
pub enum Language {
    /// A Node.js ES module (extract.mjs)
    Node,
    /// A Python 3 script (extract.py)
    Python,
    /// A Go program (extract.go, run with go run)
    Go,
}

/// How `init --claude` puts the skill in `.claude/skills`.
#[derive(Clone, Copy, ValueEnum)]
pub enum Claude {
    /// A relative symlink to the skill, or a copy on Windows
    Auto,
    /// A relative symlink to the skill
    Link,
    /// A copy, which later runs of init keep in sync (for checkouts without symlinks)
    Copy,
}

#[derive(Args)]
#[command(
    long_about = help_text::from_markdown(include_str!("help/init.long-about.md")),
    after_help = help_text::from_markdown(include_str!("help/init.after-help.md"))
)]
pub struct Init {
    /// Projection ID: letters, digits, '.', '_' or '-' (for example service-map)
    pub id: Option<String>,
    /// Title viewers show [default: from the ID]
    #[arg(long, requires = "id")]
    pub title: Option<String>,
    /// Scaffold a starter extractor in this language [default: the repository's toolchain]
    #[arg(long, value_enum, requires = "id", conflicts_with_all = ["extractor", "command"])]
    pub language: Option<Language>,
    /// Use this built-in extractor (projections extractor list shows them)
    #[arg(long, value_name = "ID", requires = "id", conflicts_with = "command")]
    pub extractor: Option<String>,
    /// With --extractor, set one of its inputs: NAME=VALUE, VALUE being JSON or else a string (for example workflowPath=.github/workflows/release.yml)
    #[arg(long = "input", value_name = "NAME=VALUE", requires = "extractor")]
    pub inputs: Vec<String>,
    /// Use this existing program as the extractor: a JSON argv array, for example '["ruby","tools/flags.rb"]'
    #[arg(long, value_name = "ARGV_JSON", requires = "id")]
    pub command: Option<String>,
    /// A built-in renderer name (for example graph, dag, database; projections help authoring lists them), or `custom` to scaffold one
    #[arg(long, value_name = "NAME|custom", requires = "id")]
    pub renderer: Option<String>,
    /// Scaffold a custom comparator: a starter comparator file (<ID>.comparator.yaml) and its tests
    #[arg(long, value_name = "custom", value_parser = ["custom"], requires = "id")]
    pub comparator: Option<String>,
    /// Where the definition goes
    #[arg(long, default_value = ".github/projections", value_parser = [".github/projections", ".projections"])]
    pub definition_directory: String,
    /// The skills directory the agent skill goes in, relative to the repository root [default: the one holding it, else whichever of .agents/skills, .claude/skills and .github/skills holds the repository's own skills, else .agents/skills]
    #[arg(long, value_name = "DIR")]
    pub skills_dir: Option<String>,
    /// Also put the skill where Claude Code reads it, .claude/skills: a symlink, or a copy on Windows (or with copy)
    #[arg(long, value_enum, value_name = "HOW", num_args = 0..=1, default_missing_value = "auto")]
    pub claude: Option<Claude>,
    /// Don't write, update or move the agent skill; projections help authoring prints its guide
    #[arg(long, requires = "id", conflicts_with_all = ["skills_dir", "claude"])]
    pub no_skill: bool,
}

#[derive(Args)]
#[command(
    long_about = help_text::from_markdown(include_str!("help/check.long-about.md")),
    after_help = help_text::from_markdown(include_str!("help/check.after-help.md"))
)]
pub struct Check {
    /// The projections to check [default: every one the working tree defines]
    #[arg(short = 'p', long = "projection", value_name = "ID")]
    pub projections: Vec<String>,
    /// Also write a PNG of the (one) projection's working tree, drawn by its renderer
    #[arg(long, value_name = "FILE")]
    pub png: Option<PathBuf>,
    /// Check this extractor output (what the extractor writes to stdout) for the one projection instead of extracting the working tree; nothing runs, so hand-made extractions can be drawn and checked
    #[arg(long, value_name = "FILE")]
    pub from: Option<PathBuf>,
    /// Skip the renderer checks, which need Chrome, Chromium or Edge
    #[arg(long, conflicts_with = "png")]
    pub no_render: bool,
    /// Chrome, Chromium or Edge executable. Default: PROJECTIONS_BROWSER, else found on PATH or in its usual install location
    #[arg(long, value_name = "PATH")]
    pub browser: Option<PathBuf>,
    /// Seconds the renderer checks may take on each scenario
    #[arg(long, value_name = "SECONDS", default_value_t = 120)]
    pub timeout: u64,
    /// Write or rewrite the snapshots of comparator tests (never their expectations)
    #[arg(long)]
    pub update: bool,
    /// Also report comparator tests' rule coverage: which of the comparator file's functions, expressions and branches the cases run, and where the rest are
    #[arg(long)]
    pub coverage: bool,
    /// Also extract this commit here and compare it with CI's artifact for it (with --ci or --artifact), to find environment drift
    #[arg(long, value_name = "REVISION")]
    pub parity: Option<String>,
    /// Fail, rather than warn, when a rerun of the working tree gives a different extraction (CI uses it for built-in extractors)
    #[arg(long)]
    pub strict_determinism: bool,
    /// Print the projections.check document
    #[arg(long)]
    pub json: bool,
    #[command(flatten)]
    pub execution: Execution,
}

#[derive(Subcommand)]
pub enum Extractor {
    /// The built-in extractors: what each reads and whether it runs repository code
    List {
        /// Print the JSON document instead of text
        #[arg(long)]
        json: bool,
    },
    /// One built-in extractor: its inputs, schema, renderer and definition template
    View {
        id: String,
        /// Print the JSON descriptor instead of text
        #[arg(long)]
        json: bool,
    },
}

#[derive(Args)]
#[command(
    after_help = help_text::from_markdown(include_str!("help/validate.after-help.md"))
)]
pub struct Validate {
    /// The document, or - for standard input
    pub file: PathBuf,
    /// The custom comparator file a comparison names, to reproduce it exactly
    #[arg(long, value_name = "FILE")]
    pub comparator: Option<PathBuf>,
    /// Print the result as JSON
    #[arg(long, conflicts_with = "quiet")]
    pub json: bool,
    /// Print nothing; the exit status says whether it is valid
    #[arg(long)]
    pub quiet: bool,
}

pub fn init(directory: &Path, args: Init) -> Result<()> {
    let root = Runner::at_checkout(directory.to_path_buf(), false).repository_root()?;
    let extractor = match (args.extractor, args.command, args.language) {
        (Some(id), _, _) if args.inputs.is_empty() => Some(scaffold::Extractor::Builtin(id)),
        (Some(id), _, _) => Some(scaffold::Extractor::BuiltinWith(id, inputs(&args.inputs)?)),
        (None, Some(command), _) => Some(scaffold::Extractor::Command(
            artifact::parse(&command).context("--command must be a JSON array of strings")?,
        )),
        (None, None, Some(language)) => Some(scaffold::Extractor::Starter(Some(match language {
            Language::Node => scaffold::Language::Node,
            Language::Python => scaffold::Language::Python,
            Language::Go => scaffold::Language::Go,
        }))),
        (None, None, None) => None,
    };
    let id = args.id.clone();
    let args_comparator = args.comparator.is_some();
    let report = scaffold::init(scaffold::Options {
        root: root.clone(),
        id: args.id,
        title: args.title,
        extractor,
        renderer: args.renderer.map(|name| {
            if name == "custom" {
                scaffold::Renderer::Custom
            } else {
                scaffold::Renderer::Builtin(name)
            }
        }),
        comparator: args_comparator,
        definition_directory: crate::project::path(&args.definition_directory),
        checkout: scaffold::source_checkout(),
        skills: crate::skill::install::Options {
            skip: args.no_skill,
            directory: args.skills_dir,
            claude: args.claude.map(|claude| match claude {
                Claude::Auto => crate::skill::install::Claude::Auto,
                Claude::Link => crate::skill::install::Claude::Link,
                Claude::Copy => crate::skill::install::Claude::Copy,
            }),
        },
    })?;
    let mut text = String::new();
    let section = |text: &mut String, heading: &str, paths: &[String]| {
        if !paths.is_empty() {
            text.push_str(&format!("{heading}\n"));
            for path in paths {
                text.push_str(&format!("  {path}\n"));
            }
        }
    };
    section(&mut text, "Created:", &report.created);
    section(&mut text, "Updated:", &report.updated);
    section(&mut text, "Kept existing:", &report.kept);
    text.push_str(&crate::skill::install::text(report.skill.as_ref()));
    if let Some(id) = &id {
        let trust = report.definition.as_ref().is_some_and(crate::collectors::requires_trust);
        let trust = if trust { " --trust" } else { "" };
        let mut steps = Vec::new();
        if let Some(package) = &report.renderer {
            steps.push((
                "Rebuild the renderer on every save",
                format!("cd {package} && npm install && npm run watch"),
            ));
            steps.push((
                "Develop it on sample scenarios, in VS Code",
                format!("Projections: Open Renderer Scenarios… on {package}"),
            ));
            steps.push((
                "Build it before committing, and commit dist/ with it",
                format!("cd {package} && npm run build"),
            ));
            steps.push((
                "Run the renderer checks on every scenario (once first: npx playwright install chromium)",
                format!("cd {package} && npm test"),
            ));
        }
        if report
            .definition
            .as_ref()
            .is_some_and(|definition| crate::runtime::effective_scope(definition).is_none())
        {
            steps.push((
                "Read only what it needs, so each revision extracts fast (--workspace sparse checks out only that): list those paths in its execution.scope",
                "\"execution\": {\"scope\": [\"src/api\", \"package.json\"]}".to_owned(),
            ));
        }
        steps.push(("Extract the working tree and print it", format!("projections show -p {id}{trust}")));
        steps.push(("Check it end to end", format!("projections check -p {id}{trust}")));
        steps.push((
            "Open it in the Projections viewer (in your agent's browser, or a standalone browser with --open)",
            format!("projections view show -p {id}{trust} --open"),
        ));
        text.push_str("\nNext:\n");
        for (purpose, command) in steps {
            text.push_str(&format!("  {purpose}:\n    {command}\n"));
        }
        match &report.renderer_package {
            _ if report.renderer.is_none() => (),
            scaffold::PackageSource::Release => text.push_str(&format!(
                "\nThe renderer installs @githubnext/projections from this CLI's release, {}. If you can't download release assets, build it from a Git submodule instead; see projections help init.\n",
                scaffold::release_tarball(env!("CARGO_PKG_VERSION"))
            )),
            scaffold::PackageSource::Directory => (),
            scaffold::PackageSource::Checkout { tarball, specifier } => {
                let checkout = tarball
                    .ancestors()
                    .nth(3)
                    .map_or_else(String::new, |path| path.display().to_string());
                text.push_str(&format!(
                    "\nThis projections executable is a development build from the source checkout {checkout}, so the renderer installs @githubnext/projections from the tarball packed there ({specifier}), not from npm.\n"
                ));
                if !tarball.is_file() {
                    text.push_str(&format!(
                        "It isn't packed yet: run npm run tools -- install --only npm in {checkout} first.\n"
                    ));
                }
                let package = report
                    .renderer
                    .as_ref()
                    .map_or_else(String::new, |package| root.join(package).display().to_string());
                text.push_str(&format!(
                    "To update it after a git pull there: npm run tools -- install --only npm --project {package}\n"
                ));
            }
        }
    }
    // Adding parts to an existing projection asks for those parts, not the projection.
    let extended = id
        .as_deref()
        .filter(|id| report.updated.iter().any(|path| path.ends_with(&format!("/{id}.json"))));
    let prompt = match extended {
        Some(id) => scaffold::parts_prompt(id, report.renderer.as_deref(), args_comparator),
        None => {
            let definition = report.created.first().cloned().unwrap_or_default();
            // The projection's own directory, when init created files in it.
            let directory = definition.strip_suffix(".json").map(str::to_owned);
            let scaffold = directory.filter(|directory| {
                report
                    .created
                    .iter()
                    .chain(&report.renderer)
                    .any(|path| path.starts_with(&format!("{directory}/")) || path == directory)
            });
            scaffold::project_prompt(id.as_deref(), scaffold.as_deref(), &definition)
        }
    };
    // Without the skill, the agent reads the guide from the CLI.
    let prompt = if report.skill.is_none() {
        prompt
            .replace(
                "follow the projections skill",
                "follow the guide `projections help authoring` prints",
            )
            .replace(
                "Follow the projections skill",
                "Follow the guide `projections help authoring` prints",
            )
    } else {
        prompt
    };
    text.push_str(&format!(
        "\nAsk your coding agent:\n  {prompt}\n\nprojections help authoring prints the guide the agent follows.\n"
    ));
    io::stdout().lock().write_all(text.as_bytes())?;
    Ok(())
}

/// `--input NAME=VALUE` options as inputs: each value JSON, else a string.
fn inputs(options: &[String]) -> Result<serde_json::Map<String, Value>> {
    options
        .iter()
        .map(|option| {
            let (name, value) = option
                .split_once('=')
                .filter(|(name, _)| !name.is_empty())
                .with_context(|| format!("--input {option} must be NAME=VALUE"))?;
            let value = artifact::parse(value).unwrap_or_else(|_| json!(value));
            Ok((name.to_owned(), value))
        })
        .collect()
}

pub fn extractor(command: Extractor) -> Result<()> {
    let catalog = crate::collectors::catalog();
    let extractors = catalog["extractors"].as_array().context("Invalid extractor catalog")?;
    match command {
        Extractor::List { json } => {
            if json {
                return output(&catalog, None, 32 * 1024 * 1024);
            }
            let width = extractors
                .iter()
                .filter_map(|descriptor| descriptor["id"].as_str())
                .map(str::len)
                .max()
                .unwrap_or(0);
            let mut text = String::new();
            for descriptor in extractors {
                text.push_str(&format!(
                    "{:width$}  {}{}\n",
                    descriptor["id"].as_str().unwrap_or_default(),
                    descriptor["title"].as_str().unwrap_or_default(),
                    if descriptor["trust"] == "none" {
                        ""
                    } else {
                        " (runs repository code: --trust)"
                    },
                ));
            }
            text.push_str("\nprojections extractor view ID describes one; projections init ID --extractor ID uses it.\n");
            io::stdout().lock().write_all(text.as_bytes())?;
            Ok(())
        }
        Extractor::View { id, json } => {
            let descriptor = extractors
                .iter()
                .find(|descriptor| descriptor["id"] == id.as_str())
                .with_context(|| format!("No built-in extractor {id}; projections extractor list shows them"))?;
            if json {
                return output(descriptor, None, 1024 * 1024);
            }
            let mut text = format!(
                "{} [{id}]\n{}\n\nSchema: {}\nRenderer: {}\nRuns repository code: {}\nNeeds: {}\n",
                descriptor["title"].as_str().unwrap_or_default(),
                descriptor["description"].as_str().unwrap_or_default(),
                descriptor["schema"].as_str().unwrap_or_default(),
                descriptor["renderer"].as_str().unwrap_or_default(),
                if descriptor["trust"] == "none" {
                    "no"
                } else {
                    "yes, so it needs --trust"
                },
                if descriptor["access"] == "files" {
                    "file reads only (served from Git objects for commits, so nothing is copied)"
                } else {
                    "a checkout (commits other than the clean HEAD are copied to a workspace)"
                }
            );
            if let Some(inputs) = descriptor["inputs"].as_object().filter(|inputs| !inputs.is_empty()) {
                text.push_str("\nInputs (the definition's \"inputs\"):\n");
                for (name, description) in inputs {
                    text.push_str(&format!("  {name}: {}\n", description.as_str().unwrap_or_default()));
                }
            }
            text.push_str(&format!(
                "\nDefinition:\n{}\n",
                serde_json::to_string_pretty(&descriptor["template"])?
            ));
            io::stdout().lock().write_all(text.as_bytes())?;
            Ok(())
        }
    }
}

pub fn validate(args: Validate) -> Result<()> {
    let (bytes, file) = if args.file.as_os_str() == "-" {
        let mut bytes = Vec::new();
        io::stdin().take(32 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
        ensure!(bytes.len() <= 32 * 1024 * 1024, "Standard input exceeds 32 MiB");
        (bytes, None)
    } else {
        (artifact::read_artifact(&args.file, 32 * 1024 * 1024)?, Some(args.file.clone()))
    };
    let value = artifact::parse(std::str::from_utf8(&bytes).context("The document must be UTF-8")?)?;
    let mut result = match value["format"].as_str() {
        Some("projections.extraction") => {
            artifact::validate_extraction(&value)?;
            json!({"valid": true, "format": "projections.extraction"})
        }
        Some("projections.comparison") => {
            let rules = args
                .comparator
                .as_ref()
                .map(|path| artifact::read_artifact(path, 64 * 1024 * 1024))
                .transpose()?;
            artifact::validate_comparison_with(&value, rules.as_deref())?;
            json!({"valid": true, "format": "projections.comparison"})
        }
        Some("projections.scenarios") => {
            let file = file.context("Scenarios name files relative to themselves, so validate them from a file, not standard input")?;
            let scenarios = fixtures::validate(&file)?;
            json!({"valid": true, "format": "projections.scenarios", "scenarios": scenarios})
        }
        Some(format) => bail!(
            "Unsupported document format {format}: validate checks projections.extraction, projections.comparison and projections.scenarios documents, and bare extractions"
        ),
        None => {
            engine("normalize", json!({"extraction": value}))?;
            json!({"valid": true, "format": "extraction"})
        }
    };
    if result["format"] == "projections.comparison" && args.comparator.is_none() {
        let custom = value["comparator"]["id"].as_str().is_some_and(|id| id != "default");
        if custom {
            result["reproduced"] = json!(false);
        }
    }
    if args.quiet {
        return Ok(());
    }
    if args.json {
        return output(&result, None, 1024);
    }
    let mut text = format!("Valid {}", result["format"].as_str().unwrap_or_default());
    if let Some(count) = result["scenarios"].as_u64() {
        text.push_str(&format!(" ({count} scenarios)"));
    }
    if result["reproduced"] == false {
        text.push_str(". Its custom comparator wasn't reproduced: pass --comparator FILE to check that it gives this comparison");
    }
    println!("{text}");
    Ok(())
}

/// `check`: verifies projections end to end.
pub async fn check(directory: &Path, args: Check) -> Result<()> {
    let runner = args.execution.runner(directory)?;
    install_cancellation(&runner)?;
    let report = check::check(
        &runner,
        check::Options {
            ids: args.projections,
            render: !args.no_render,
            browser: args.browser,
            png: args.png,
            from: args.from,
            timeout: Duration::from_secs(args.timeout),
            cancel: runner.cancel.clone(),
            update: args.update,
            coverage: args.coverage,
            parity: args.parity,
            strict_determinism: args.strict_determinism,
        },
    )
    .await?;
    if args.json {
        output(&report, None, 32 * 1024 * 1024)?;
    } else {
        io::stdout().lock().write_all(check::text(&report).as_bytes())?;
    }
    // The report ends by saying so.
    reported(report["ok"] == true, String::new)?;
    Ok(())
}
