//! The image options of `show` and `compare` (`--png`, `--frames` and how they draw), and drawing a document with
//! its real renderer in a headless browser.

use std::{
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool},
    time::Duration,
};

use anyhow::{Context, Result, ensure};
use clap::{Args, ValueEnum};
use serde_json::{Value, json};

use crate::{
    assets, browser,
    runtime::{DefinitionSource, Runner},
    snapshot,
};

#[derive(Clone, Copy, ValueEnum)]
pub enum Theme {
    Light,
    Dark,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum Side {
    Before,
    After,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum ImageMode {
    /// One frame at a transition progress (--progress)
    Animated,
    /// The before and after revisions in two panes
    SideBySide,
    /// One frame with the renderer's own static comparison
    Diff,
}

#[derive(Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum ImageFrame {
    /// One rounded card with a hairline border holding the renderer's content, its legend and the summary bar, transparent outside its corners; the image is as tall as the card, which hugs the content up to --height
    Card,
    /// The renderer's content alone, edge to edge, without the legend or the summary bar
    None,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum FocusOn {
    /// A comparison's changed items and the relationships between them
    Changes,
    /// Everything
    All,
}

impl Png {
    /// The focus `--focus`, `--entity` and `--fit` ask for.
    pub fn focus(&self) -> snapshot::Focus {
        snapshot::Focus {
            on: self.focus.map(|on| match on {
                FocusOn::Changes => snapshot::FocusOn::Changes,
                FocusOn::All => snapshot::FocusOn::All,
            }),
            entity: self.entity.clone(),
            fit: self.fit,
        }
    }
}

#[derive(Args)]
#[command(next_help_heading = "Image", group(clap::ArgGroup::new("image").args(["png", "frames"])))]
pub struct Png {
    /// Also draw it with its real renderer in a headless browser, to a new PNG FILE
    #[arg(long, value_name = "FILE", conflicts_with = "frames")]
    pub png: Option<PathBuf>,
    /// Comparisons: also draw the animated playback as the viewer loops it back and forth at 1× speed, from the start of its hold at the before end, as PNG frames in the new directory DIR with frames.json, which lists each frame's file, progress, direction and duration; a hold is one frame
    #[arg(long, value_name = "DIR", conflicts_with_all = ["progress", "side"])]
    pub frames: Option<PathBuf>,
    /// Frames a second that --frames samples playback at
    #[arg(long, value_name = "FPS", default_value_t = 12.0, requires = "frames")]
    pub fps: f64,
    #[arg(long, value_enum, default_value = "light", requires = "image")]
    pub theme: Theme,
    /// How the image frames the renderer's content
    #[arg(long, value_enum, default_value = "card", requires = "image")]
    pub frame: ImageFrame,
    /// Fill outside the card's rounded corners with this #rgb or #rrggbb COLOR instead of transparency, for formats without alpha such as GIF
    #[arg(long, value_name = "COLOR", value_parser = snapshot::matte, requires = "image")]
    pub matte: Option<String>,
    /// Viewport width in CSS pixels
    #[arg(long, default_value_t = 1280, requires = "image")]
    pub width: u32,
    /// Viewport height in CSS pixels; with --frame card, the most the image is: --png crops it to the card, which hugs the renderer's content
    #[arg(long, default_value_t = 800, requires = "image")]
    pub height: u32,
    /// Device pixels per CSS pixel; 2 for high-density displays
    #[arg(long, default_value_t = 1.0, requires = "image")]
    pub scale: f64,
    /// Comparisons: the transition's progress, 0 (before) to 1 (after, the default)
    #[arg(long, value_name = "0..1", requires = "image")]
    pub progress: Option<f64>,
    /// Comparisons: how to present them [default: the renderer's default, its diff when it has one; animated with --progress]
    #[arg(long, value_enum, requires = "image")]
    pub mode: Option<ImageMode>,
    /// Open the image on a comparison's changes or on everything [default: the renderer's choice; a diff opens on its changes when they don't all fit]
    #[arg(long, value_enum, value_name = "WHAT", requires = "image")]
    pub focus: Option<FocusOn>,
    /// Open the image on one item, by its ID, centred with what it connects to
    #[arg(long, value_name = "ID", requires = "image")]
    pub entity: Option<String>,
    /// Fit what the image opens on whole, even when its text is drawn smaller than the renderer would open at
    #[arg(long, requires = "image")]
    pub fit: bool,
    /// Comparisons: draw one side alone, with the renderer of the definition that explained the comparison
    #[arg(long, value_enum, requires = "image", conflicts_with_all = ["mode", "progress"])]
    pub side: Option<Side>,
    /// Chrome, Chromium or Edge executable. Default: PROJECTIONS_BROWSER, else found on PATH or in its usual install location
    #[arg(long, value_name = "PATH", requires = "image")]
    pub browser: Option<PathBuf>,
    /// Seconds the renderer may take to finish painting [default: 60, and more for large extractions]
    #[arg(long, value_name = "SECONDS", requires = "image")]
    pub timeout: Option<u64>,
}

/// Draws `document` with its renderer into the new PNG `png.png`.
pub(super) async fn draw(png: &Png, document: Value, runner: &Runner, source: DefinitionSource, cancel: Arc<AtomicBool>) -> Result<()> {
    draw_with(png, document, runner, source, None, cancel).await
}

/// Draws `document`, with the renderer of `definition_revision` when given.
pub(super) async fn draw_with(
    png: &Png,
    document: Value,
    runner: &Runner,
    source: DefinitionSource,
    definition_revision: Option<String>,
    cancel: Arc<AtomicBool>,
) -> Result<()> {
    let override_revision = definition_revision;
    if png.png.is_none() && png.frames.is_none() {
        return Ok(());
    }
    let timeout = png.timeout.map_or_else(|| snapshot::paint_timeout(&document), Duration::from_secs);
    check_drawing(png, document["format"] == "projections.comparison")?;
    let (document, definition_revision) = match png.side {
        Some(side) => snapshot::side(&document, matches!(side, Side::After), source)?,
        None => (document, None),
    };
    let definition_revision = override_revision.or(definition_revision);
    // Kept until drawing ends: embedded assets are extracted to a temporary directory this owns.
    let inspector = assets::inspector_assets()?;
    let request = snapshot::Request {
        document,
        definition_revision,
        repo: runner.repo.clone(),
        trust: runner.trust,
        definition: source,
        assets: inspector.path.clone(),
        mode: png.mode.map(|mode| match mode {
            ImageMode::Animated => snapshot::Mode::Animated,
            ImageMode::SideBySide => snapshot::Mode::SideBySide,
            ImageMode::Diff => snapshot::Mode::Diff,
        }),
        progress: png.progress,
        focus: png.focus(),
        theme: match png.theme {
            Theme::Light => snapshot::Theme::Light,
            Theme::Dark => snapshot::Theme::Dark,
        },
        frame: match png.frame {
            ImageFrame::Card => snapshot::Frame::Card,
            ImageFrame::None => snapshot::Frame::None,
        },
        matte: png.matte.clone(),
        width: png.width,
        height: png.height,
        scale: png.scale,
        browser: browser::find(png.browser.as_deref())?,
        transport: browser::Transport::default(),
        timeout,
        cancel,
    };
    if let Some(directory) = &png.frames {
        let recording = snapshot::record(request, 1000.0 / png.fps).await?;
        for notice in &recording.notices {
            eprintln!("projections: note: {notice}");
        }
        write_frames(directory, &recording.frames)?;
        eprintln!("Wrote {} frames to {}", recording.frames.len(), directory.display());
        return Ok(());
    }
    let path = png.png.as_ref().expect("an image output");
    let rendered = snapshot::render(request).await?;
    for notice in &rendered.notices {
        eprintln!("projections: note: {notice}");
    }
    crate::create_file(path, &rendered.png)?;
    eprintln!("Wrote {}", path.display());
    Ok(())
}

/// Writes recorded frames into the new `directory`: `000.png`, `001.png` … and `frames.json`.
fn write_frames(directory: &Path, frames: &[snapshot::PlaybackFrame]) -> Result<()> {
    std::fs::create_dir(directory).with_context(|| format!("Cannot create {}", directory.display()))?;
    let width = frames.len().saturating_sub(1).to_string().len().max(3);
    let mut listed = Vec::with_capacity(frames.len());
    for (index, frame) in frames.iter().enumerate() {
        let file = format!("{index:0width$}.png");
        crate::create_file(&directory.join(&file), &frame.png)?;
        listed.push(json!({
            "file": file,
            "progress": frame.progress,
            "direction": frame.direction,
            "durationMs": (frame.duration_ms * 1000.0).round() / 1000.0,
        }));
    }
    let manifest = serde_json::to_vec_pretty(&json!({"frames": listed}))?;
    crate::create_file(&directory.join("frames.json"), &manifest)
}

/// Fails when the image options are out of range or don't apply.
fn check_drawing(png: &Png, comparison: bool) -> Result<()> {
    snapshot::validate_settings(
        png.width,
        png.height,
        png.scale,
        png.progress,
        Duration::from_secs(png.timeout.unwrap_or(60)),
    )?;
    ensure!(
        comparison || (png.mode.is_none() && png.progress.is_none() && png.side.is_none() && png.frames.is_none()),
        "--mode, --progress, --side and --frames apply to comparisons"
    );
    ensure!(
        png.frames.is_none() || matches!(png.mode, None | Some(ImageMode::Animated)),
        "--frames draws the animated playback, not --mode side-by-side or diff"
    );
    ensure!(
        png.fps.is_finite() && (1.0..=60.0).contains(&png.fps),
        "--fps must be between 1 and 60"
    );
    ensure!(
        comparison || !matches!(png.focus, Some(FocusOn::Changes)),
        "--focus changes applies to comparisons"
    );
    ensure!(
        png.matte.is_none() || png.frame == ImageFrame::Card,
        "--matte fills the corners of --frame card"
    );
    Ok(())
}

/// Fails before any extraction when `--png` can't be written or drawn.
/// `comparison` is unknown for a saved document until it is read.
pub(super) fn ready_to_draw(png: &Png, comparison: Option<bool>) -> Result<()> {
    if let Some(path) = png.png.as_ref().or(png.frames.as_ref()) {
        if let Some(comparison) = comparison {
            check_drawing(png, comparison)?;
        }
        ensure!(
            std::fs::symlink_metadata(path).is_err(),
            "{} already exists; images never overwrite files",
            path.display()
        );
        browser::find(png.browser.as_deref())?;
    }
    Ok(())
}
