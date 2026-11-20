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
use super::view_process::{open_browser, running_viewer, same_port, start_viewer, stop_viewer};
use super::{FocusOn, ImageMode, Sources, Theme};
use crate::{
    assets, help_text,
    runtime::Runner,
    service,
    view::{Port, address, client, registry},
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
    /// The port to listen on; 0 for any free one [default: the port this project's viewer last listened on, else any free one]
    #[arg(long)]
    pub port: Option<u16>,
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
        /// The port a viewer this starts listens on; 0 for any free one. Refused when a viewer already runs on another
        /// [default: the port this project's viewer last listened on, else any free one]
        #[arg(long)]
        port: Option<u16>,
        /// Print the result as JSON
        #[arg(long)]
        json: bool,
    },
    /// What the viewer shows and what the person selected (the current_view tool)
    Current {
        /// A named viewer [default: the default viewer]
        #[arg(long, value_name = "NAME")]
        viewer: Option<String>,
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
        /// Render what a named viewer shows [default: the default viewer]
        #[arg(long, value_name = "NAME")]
        viewer: Option<String>,
        /// Capture the viewer's page itself, its header, toolbar and summary bar around the projection, as a page opened
        /// now shows it: the viewer's projection, pair, mode and selection, not the person's playback position or zoom
        #[arg(long, conflicts_with_all = ["projection", "before", "after", "mode", "progress", "focus", "entity", "fit"])]
        page: bool,
        /// Print the result as JSON
        #[arg(long)]
        json: bool,
    },
    /// Extract what the viewer shows again (the refresh tool)
    Refresh {
        /// A named viewer [default: the default viewer]
        #[arg(long, value_name = "NAME")]
        viewer: Option<String>,
        /// Print the result as JSON
        #[arg(long)]
        json: bool,
    },
    /// Stop the viewer running for this repository; its open pages say so, and reconnect if one starts at its URL
    Stop {
        /// Also forget its link: the next viewer has a new token (and port), and every earlier link stops working
        #[arg(long)]
        rotate: bool,
    },
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
    /// Show it in a named viewer, its own page and URL beside the others, to show several projections side by side
    /// [default: the default viewer]
    #[arg(long, value_name = "NAME")]
    pub viewer: Option<String>,
    /// Color the page as the app that shows it, for a harness whose surfaces the default theme doesn't match: a theme
    /// seed: a built-in one's name (`claude`, Claude Code's Preview pane; `chatgpt`, the ChatGPT and Codex apps), inline JSON or a JSON file,
    /// `{"light": {"background": …, "border": …}, "dark": {…}}`. It goes in the printed link (`?theme=`), so only a
    /// page opened from that link takes it [default: the page's own theme]
    #[arg(long, value_name = "SEED")]
    pub theme: Option<String>,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum ViewMode {
    SideBySide,
    Animated,
    Swipe,
    Diff,
}

impl ViewShow {
    /// The theme seed `--theme` gives, checked, as the page's `?theme=` takes it.
    fn seed(&self) -> Result<Option<String>> {
        self.theme.as_deref().map(crate::view::theme::read).transpose()
    }

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
            ("viewer", &self.viewer),
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

/// A tool's input naming `viewer`, when one is named.
fn named(viewer: &Option<String>) -> Value {
    match viewer {
        Some(viewer) => json!({"viewer": viewer}),
        None => json!({}),
    }
}

/// `view show|current|screenshot|refresh`: calls the tool on the running viewer and prints its result.
async fn view_tool(root: &Path, command: ViewCommand) -> Result<()> {
    if let ViewCommand::Stop { rotate } = command {
        match running_viewer(root).await {
            Some(record) => {
                stop_viewer(root, &record).await?;
                println!("Stopped the viewer at {}", record.url);
            }
            None => println!("No viewer is running for this repository."),
        }
        if rotate && address::forget(root) {
            println!("Forgot its link: the next viewer has a new one, and earlier links no longer work.");
        }
        return Ok(());
    }
    let seed = match &command {
        ViewCommand::Show { show, .. } => show.seed()?,
        _ => None,
    };
    let (name, input, json_output, start) = match &command {
        ViewCommand::Show {
            show, json, trust, port, ..
        } => ("open_projection", show.input(), *json, Some((*trust, *port))),
        ViewCommand::Current { viewer, json } => ("current_view", named(viewer), *json, None),
        ViewCommand::Refresh { viewer, json } => ("refresh", named(viewer), *json, None),
        ViewCommand::Stop { .. } => unreachable!("answered above"),
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
            viewer,
            page,
            json,
        } => {
            ensure!(
                std::fs::symlink_metadata(out).is_err(),
                "{} already exists; images never overwrite files",
                out.display()
            );
            if *page {
                return super::view_page::screenshot(root, out, viewer.as_deref(), (*theme, *width, *height), *json).await;
            }
            let mut input = named(viewer);
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
    let running = running_viewer(root).await;
    if let (Some(record), Some((_, port))) = (&running, start) {
        same_port(record, port)?;
    }
    let url = match (running, start) {
        // Asked for trust, a viewer running without it is replaced at its URL (its port, which `same_port` checked).
        (Some(record), Some((true, _))) if !record.trust => start_viewer(root, true, None).await?,
        (Some(record), _) => record.url,
        (None, Some((trust, port))) => start_viewer(root, trust, port).await?,
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
    let mut outcome = crate::tools::Outcome::from_json(&response.json()?);
    // The shown page's link, wherever it is given, carries the theme seed.
    if let (Some(seed), Some(shown)) = (&seed, outcome.structured["url"].as_str().map(str::to_owned)) {
        outcome.text = crate::view::theme::relink(&outcome.text, &shown, seed);
        outcome.structured["url"] = json!(crate::view::theme::link(&shown, seed));
    }
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
        // The page of the viewer it showed, a named one's included.
        open_browser(outcome.structured["url"].as_str().unwrap_or(&url))?;
    }
    ensure!(!outcome.error, "{name} failed");
    Ok(())
}

/// `view`: serves the viewer page until interrupted, or reuses the one running for this repository.
pub async fn view(directory: &Path, args: View) -> Result<()> {
    let root = Runner::at_checkout(directory.to_path_buf(), false).repository_root()?;
    if let Some(command) = args.command {
        return view_tool(&root, command).await;
    }
    let input = args.show.input();
    let asked = input.as_object().is_some_and(|input| !input.is_empty());
    let seed = args.show.seed()?;
    let seeded = |url: &str| {
        seed.as_deref()
            .map_or_else(|| url.to_owned(), |seed| crate::view::theme::link(url, seed))
    };
    // Asked for trust, a viewer running without it is replaced, at its URL when that is free, so its open pages
    // (a browser tab, the Copilot app's canvas) reconnect to the new one.
    let mut replacing = None;
    let running = running_viewer(&root).await;
    if let Some(record) = &running {
        same_port(record, args.port)?;
    }
    match running {
        Some(record) if args.trust && !record.trust => {
            stop_viewer(&root, &record).await?;
            eprintln!("Replacing the viewer running without trust.");
            replacing = record.address();
        }
        Some(record) => {
            let mut url = record.url.clone();
            if asked {
                let response = client::request(&record.url, "POST", "control/show", Some(&input), Duration::from_secs(120)).await?;
                let answer = response.json()?;
                ensure!(
                    response.status == 200,
                    "{}",
                    answer["diagnostics"][0]["message"].as_str().unwrap_or("The viewer refused")
                );
                if let Some(shown) = answer["url"].as_str() {
                    url = shown.to_owned();
                }
            }
            let url = seeded(&url);
            println!("A viewer is already running for this repository: {url}");
            if args.open {
                open_browser(&url)?;
            }
            return Ok(());
        }
        None => {}
    }
    let signals = crate::signals::Shutdown::new().context("Failed to register shutdown signals")?;
    let client_assets = assets::inspector_assets()?;
    let service = Arc::new(service::Service::new(repository_options(directory, args.trust, &client_assets.path, &args.sources)?).await?);
    // At the project's kept address, so a restarted viewer has the URL the last one had.
    let mut viewer = crate::view::start_kept(
        service.clone(),
        &root,
        crate::view::Start {
            port: args.port.map_or(Port::Kept, Port::Exactly),
            replacing,
            idle: args.idle_exit.map(|minutes| Duration::from_secs(minutes.max(1) * 60)),
            definition_revision: args.definition_revision.clone(),
        },
    )?;
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
    // A named viewer's page is the server's URL with its name.
    let page = seeded(&match crate::view::viewer_name(args.show.viewer.as_deref()) {
        Ok(name) if name != crate::view::DEFAULT_VIEWER => format!("{url}?viewer={name}"),
        _ => url.clone(),
    });
    println!("{page}");
    eprintln!("Serving the Projections viewer for {}; press Ctrl+C to stop.", root.display());
    if args.open
        && let Err(error) = open_browser(&page)
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
