//! `view`: the agent viewer, a loopback page a coding agent drives and a person
//! watches.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result, bail, ensure};
use clap::{Args, Subcommand, ValueEnum};
use serde_json::{Value, json};

use super::serve::repository_options;
use super::{FocusOn, ImageMode, Sources, Theme};
use crate::{
    assets, help_text,
    runtime::Runner,
    service,
    view::{Viewer, ViewerOptions, client, registry},
};

#[derive(Args)]
#[command(
    args_conflicts_with_subcommands = true,
    long_about = help_text::from_markdown(include_str!("help/view.long-about.md")),
    after_help = help_text::from_markdown(include_str!("help/view.after-help.md"))
)]
pub struct View {
    #[command(subcommand)]
    pub command: Option<ViewCommand>,
    #[command(flatten)]
    pub show: ViewShow,
    /// The port to listen on [default: any free port]
    #[arg(long, default_value_t = 0)]
    pub port: u16,
    /// Also open the page in the default browser
    #[arg(long)]
    pub open: bool,
    /// Let it run repository code (custom extractors and renderers). Review the projections' code first. A viewer
    /// already running without trust is replaced, at the same URL
    #[arg(long)]
    pub trust: bool,
    /// The revision whose definition and projection code extract both sides, as compare --definition-revision [default: working-tree]
    #[arg(long, value_name = "REVISION")]
    pub definition_revision: Option<String>,
    /// Stop after this many minutes with no page open and no agent call
    #[arg(long, value_name = "MINUTES", hide = true)]
    pub idle_exit: Option<u64>,
    #[command(flatten)]
    pub sources: Sources,
}

/// The agent tools a viewer answers, for agents without MCP: each finds the
/// viewer running for this repository and prints what the tool returns.
#[derive(Subcommand)]
pub enum ViewCommand {
    /// Show a projection in the viewer, starting one in the background when none runs (the open_projection tool)
    Show {
        #[command(flatten)]
        show: ViewShow,
        /// Also open the page in the default browser
        #[arg(long)]
        open: bool,
        /// Let the viewer run repository code: one is started with trust, or replaces one running without it
        #[arg(long)]
        trust: bool,
        /// Print the result as JSON
        #[arg(long)]
        json: bool,
    },
    /// What the viewer shows and what the person selected (the current_view tool)
    Current {
        /// Print the result as JSON
        #[arg(long)]
        json: bool,
    },
    /// Render what the viewer shows to a new PNG file with its real renderer (the screenshot tool)
    Screenshot {
        /// The new PNG file
        #[arg(long, value_name = "FILE")]
        out: PathBuf,
        /// Another projection [default: the one the viewer shows]
        #[arg(short = 'p', long, value_name = "ID")]
        projection: Option<String>,
        /// The Before revision [default: the viewer's]
        #[arg(long, value_name = "REVISION")]
        before: Option<String>,
        /// The After revision [default: the viewer's]
        #[arg(long, value_name = "REVISION")]
        after: Option<String>,
        /// How to present a comparison [default: the viewer's]
        #[arg(long, value_enum)]
        mode: Option<ImageMode>,
        /// Animated mode: the transition's progress, 0 to 1 [default: the viewer's playback position]
        #[arg(long, value_name = "0..1")]
        progress: Option<f64>,
        /// [default: the page's]
        #[arg(long, value_enum)]
        theme: Option<Theme>,
        /// Viewport width in CSS pixels [default: the page's, else 1280]
        #[arg(long)]
        width: Option<u32>,
        /// Viewport height in CSS pixels, the most the image is: it is as tall as its card, which hugs the content [default: the page's, else 800]
        #[arg(long)]
        height: Option<u32>,
        /// Open the image on a comparison's changes or on everything [default: the renderer's choice]
        #[arg(long, value_enum, value_name = "WHAT")]
        focus: Option<FocusOn>,
        /// Open the image on one item, by its ID, centred with what it connects to
        #[arg(long, value_name = "ID")]
        entity: Option<String>,
        /// Fit what the image opens on whole, even when its text is drawn smaller than the renderer would open at
        #[arg(long)]
        fit: bool,
        /// Print the result as JSON
        #[arg(long)]
        json: bool,
    },
    /// Extract what the viewer shows again (the refresh tool)
    Refresh {
        /// Print the result as JSON
        #[arg(long)]
        json: bool,
    },
    /// Stop the viewer running for this repository; its open pages say so, and reconnect if one starts at its URL
    Stop,
}

/// What a viewer shows, as `open_projection` takes it.
#[derive(Args, Default)]
#[command(next_help_heading = "What to show")]
pub struct ViewShow {
    /// The projection [default: the one shown, else the only one the repository defines]
    #[arg(short = 'p', long, value_name = "ID")]
    pub projection: Option<String>,
    /// What to compare: branch, uncommitted, last-commit, now, release or bookmark:<id> [default: the suggested pair]
    #[arg(long, value_name = "CHOICE", conflicts_with_all = ["before", "after"])]
    pub choice: Option<String>,
    /// The Before revision: a branch, tag or commit, or working-tree
    #[arg(long, value_name = "REVISION")]
    pub before: Option<String>,
    /// The After revision [default: working-tree]
    #[arg(long, value_name = "REVISION")]
    pub after: Option<String>,
    /// The comparison mode
    #[arg(long, value_enum)]
    pub mode: Option<ViewMode>,
    /// An entity, relationship or change to select, by ID
    #[arg(long, value_name = "ID")]
    pub entity: Option<String>,
    /// A scenario from the projection's renderer scenarios, shown instead of revisions
    #[arg(long, value_name = "ID")]
    pub scenario: Option<String>,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum ViewMode {
    SideBySide,
    Animated,
    Swipe,
    Diff,
}

impl ViewShow {
    /// `open_projection`'s input.
    pub fn input(&self) -> Value {
        let mut input = json!({});
        for (key, value) in [
            ("projection", &self.projection),
            ("choice", &self.choice),
            ("before", &self.before),
            ("after", &self.after),
            ("entity", &self.entity),
            ("scenario", &self.scenario),
        ] {
            if let Some(value) = value {
                input[key] = json!(value);
            }
        }
        if let Some(mode) = self.mode {
            input["mode"] = json!(match mode {
                ViewMode::SideBySide => "side-by-side",
                ViewMode::Animated => "animated",
                ViewMode::Swipe => "swipe",
                ViewMode::Diff => "diff",
            });
        }
        input
    }
}

/// The viewer running for the repository at `root`, if one answers; a stale record is removed.
async fn running_viewer(root: &Path) -> Option<registry::Record> {
    registry::live(root, Duration::from_secs(5)).await
}

/// Stops the viewer `record` names and waits until its URL no longer answers, so its port is free.
async fn stop_viewer(root: &Path, record: &registry::Record) -> Result<()> {
    let response = client::request(&record.url, "POST", "control/stop", None, Duration::from_secs(10)).await?;
    ensure!(response.status == 200, "The viewer refused to stop ({})", response.status);
    for _ in 0..100 {
        if client::request(&record.url, "GET", "control/state", None, Duration::from_secs(1))
            .await
            .is_err()
        {
            registry::remove(root, &record.url);
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    bail!("The viewer at {} didn't stop", record.url)
}

/// `view show|current|screenshot|refresh`: calls the tool on the running viewer and prints its result.
async fn view_tool(root: &Path, command: ViewCommand) -> Result<()> {
    if let ViewCommand::Stop = command {
        match running_viewer(root).await {
            Some(record) => {
                stop_viewer(root, &record).await?;
                println!("Stopped the viewer at {}", record.url);
            }
            None => println!("No viewer is running for this repository."),
        }
        return Ok(());
    }
    let (name, input, json_output, start) = match &command {
        ViewCommand::Show { show, json, trust, .. } => ("open_projection", show.input(), *json, Some(*trust)),
        ViewCommand::Current { json } => ("current_view", json!({}), *json, None),
        ViewCommand::Refresh { json } => ("refresh", json!({}), *json, None),
        ViewCommand::Stop => unreachable!("answered above"),
        ViewCommand::Screenshot {
            out,
            projection,
            before,
            after,
            mode,
            progress,
            theme,
            width,
            height,
            focus,
            entity,
            fit,
            json,
        } => {
            ensure!(
                std::fs::symlink_metadata(out).is_err(),
                "{} already exists; images never overwrite files",
                out.display()
            );
            let mut input = json!({});
            for (key, value) in [("projection", projection), ("before", before), ("after", after), ("entity", entity)] {
                if let Some(value) = value {
                    input[key] = json!(value);
                }
            }
            if let Some(mode) = mode {
                input["mode"] = json!(match mode {
                    ImageMode::Animated => "animated",
                    ImageMode::SideBySide => "side-by-side",
                    ImageMode::Diff => "diff",
                });
            }
            if let Some(focus) = focus {
                input["focus"] = json!(match focus {
                    FocusOn::Changes => "changes",
                    FocusOn::All => "all",
                });
            }
            if *fit {
                input["fit"] = json!(true);
            }
            if let Some(theme) = theme {
                input["theme"] = json!(match theme {
                    Theme::Light => "light",
                    Theme::Dark => "dark",
                });
            }
            for (key, value) in [
                ("progress", progress.map(|value| json!(value))),
                ("width", width.map(|value| json!(value))),
                ("height", height.map(|value| json!(value))),
            ] {
                if let Some(value) = value {
                    input[key] = value;
                }
            }
            ("screenshot", input, *json, None)
        }
    };
    let url = match (running_viewer(root).await, start) {
        // Asked for trust, a viewer running without it is replaced at its URL.
        (Some(record), Some(true)) if !record.trust => start_viewer(root, true).await?,
        (Some(record), _) => record.url,
        (None, Some(trust)) => start_viewer(root, trust).await?,
        (None, None) => bail!(
            "No viewer is running for this repository: start one with projections view, or show a projection with projections view show"
        ),
    };
    let response = client::request(
        &url,
        "POST",
        &format!("control/tool/{name}"),
        Some(&input),
        Duration::from_secs(300),
    )
    .await?;
    ensure!(response.status == 200, "The viewer refused ({})", response.status);
    let outcome = crate::tools::Outcome::from_json(&response.json()?);
    if let (ViewCommand::Screenshot { out, .. }, Some(png)) = (&command, &outcome.image) {
        crate::create_file(out, png)?;
        eprintln!("Wrote {}", out.display());
    }
    if json_output {
        println!("{}", serde_json::to_string(&outcome.structured)?);
    } else {
        print!("{}", outcome.text);
    }
    if let ViewCommand::Show { open: true, .. } = &command
        && !outcome.error
    {
        open_browser(&url)?;
    }
    ensure!(!outcome.error, "{name} failed");
    Ok(())
}

/// Starts `projections view` in the background for this project of `root`,
/// stopping itself when idle, and returns its URL once it is recorded and
/// answers. With `trust`, it replaces a viewer running without trust.
async fn start_viewer(root: &Path, trust: bool) -> Result<String> {
    let mut command = std::process::Command::new(std::env::current_exe()?);
    // The same project as this command's, which a viewer started at the repository's root wouldn't find again.
    let project = crate::project::prefix();
    command.arg("-C").arg(root);
    if !project.is_empty() {
        command.arg("--root").arg(project);
    }
    command
        .args(["view", "--idle-exit", "15"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    if trust {
        command.arg("--trust");
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own process group, so the terminal's Ctrl+C for this command doesn't stop it.
        command.process_group(0);
    }
    #[cfg(windows)]
    keep_standard_handles();
    let mut child = command.spawn().context("Cannot start the viewer")?;
    for _ in 0..300 {
        if let Some(record) = running_viewer(root).await
            && record.pid == child.id()
        {
            eprintln!("Started the Projections viewer: {}", record.url);
            return Ok(record.url);
        }
        if let Some(status) = child.try_wait()? {
            bail!("The viewer stopped as it started ({status})");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    bail!("The viewer didn't start in 30 seconds")
}

/// Makes this process's standard handles uninheritable. Windows gives a child every inheritable handle, so the viewer
/// would hold this command's output pipes open for its lifetime, and whoever reads them (`execFile` in the Copilot
/// canvas, a test) would wait until the viewer exits rather than for this command.
#[cfg(windows)]
fn keep_standard_handles() {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{HANDLE_FLAG_INHERIT, SetHandleInformation};
    for handle in [
        std::io::stdin().as_raw_handle(),
        std::io::stdout().as_raw_handle(),
        std::io::stderr().as_raw_handle(),
    ] {
        if !handle.is_null() {
            // A handle that isn't one (no console) refuses, which changes nothing.
            unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) };
        }
    }
}

/// `view`: serves the viewer page until interrupted, or reuses the one running for this repository.
pub async fn view(directory: &Path, args: View) -> Result<()> {
    let root = Runner::at_checkout(directory.to_path_buf(), false).repository_root()?;
    if let Some(command) = args.command {
        return view_tool(&root, command).await;
    }
    let input = args.show.input();
    let asked = input.as_object().is_some_and(|input| !input.is_empty());
    // Asked for trust, a viewer running without it is replaced, at its URL when that is free, so its open pages
    // (a browser tab, the Copilot app's canvas) reconnect to the new one.
    let mut reused = None;
    match running_viewer(&root).await {
        Some(record) if args.trust && !record.trust => {
            stop_viewer(&root, &record).await?;
            eprintln!("Replacing the viewer running without trust.");
            reused = record.address().filter(|_| args.port == 0);
        }
        Some(record) => {
            if asked {
                let response = client::request(&record.url, "POST", "control/show", Some(&input), Duration::from_secs(120)).await?;
                ensure!(
                    response.status == 200,
                    "{}",
                    response.json()?["diagnostics"][0]["message"]
                        .as_str()
                        .unwrap_or("The viewer refused")
                );
            }
            println!("A viewer is already running for this repository: {}", record.url);
            if args.open {
                open_browser(&record.url)?;
            }
            return Ok(());
        }
        None => {}
    }
    let signals = crate::signals::Shutdown::new().context("Failed to register shutdown signals")?;
    let client_assets = assets::inspector_assets()?;
    let service = Arc::new(service::Service::new(repository_options(directory, args.trust, &client_assets.path, &args.sources)?).await?);
    let options = |address: Option<(u16, String)>| {
        let (port, token) = address.map_or((args.port, None), |(port, token)| (port, Some(token)));
        ViewerOptions {
            port,
            idle: args.idle_exit.map(|minutes| Duration::from_secs(minutes.max(1) * 60)),
            definition_revision: args.definition_revision.clone(),
            token,
        }
    };
    // The replaced viewer's port may have been taken meanwhile: then the new viewer has a new URL.
    let mut viewer = match Viewer::start(service.clone(), options(reused.clone())) {
        Err(_) if reused.is_some() => Viewer::start(service.clone(), options(None))?,
        started => started?,
    };
    let url = viewer.url().to_owned();
    // What to show first: as asked, else the suggested pair when the repository defines one projection. Recorded only
    // then, so what another process shows through it (`view show --choice now` starting it) is never undone by this.
    if let Err(error) = viewer.show(&input).await
        && asked
    {
        eprintln!("projections: {error}");
    }
    registry::write(
        &root,
        &registry::Record {
            url: url.clone(),
            pid: std::process::id(),
            trust: args.trust,
        },
    )?;
    println!("{url}");
    eprintln!("Serving the Projections viewer for {}; press Ctrl+C to stop.", root.display());
    if args.open
        && let Err(error) = open_browser(&url)
    {
        eprintln!("projections: {error:#}");
    }
    tokio::select! {
        result = signals.wait() => if let Err(error) = result { eprintln!("projections: {error:#}") },
        () = viewer.stopped() => {}
    }
    registry::remove(&root, &url);
    viewer.close().await;
    service.close().await;
    Ok(())
}

/// Opens `url` in the default browser.
fn open_browser(url: &str) -> Result<()> {
    let mut command = if cfg!(target_os = "macos") {
        std::process::Command::new("open")
    } else if cfg!(windows) {
        let mut command = std::process::Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
        command
    } else {
        std::process::Command::new("xdg-open")
    };
    command
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .context("Cannot open the default browser")?;
    Ok(())
}
