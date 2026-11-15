//! What a snapshot shows and how: its theme, comparison mode, focus and frame, and the checks on its view settings.

use std::time::Duration;

use anyhow::{Result, ensure};

/// The largest snapshot edge, in device pixels.
pub const MAX_PIXELS: f64 = 8192.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Theme {
    Light,
    Dark,
}

impl Theme {
    pub fn name(self) -> &'static str {
        match self {
            Theme::Light => "light",
            Theme::Dark => "dark",
        }
    }
}

/// How a comparison is presented.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// One frame at a transition progress.
    Animated,
    /// The before and after revisions in two panes.
    SideBySide,
    /// One frame drawing the renderer's own static comparison.
    Diff,
}

impl Mode {
    pub fn name(self) -> &'static str {
        match self {
            Mode::Animated => "animated",
            Mode::SideBySide => "side-by-side",
            Mode::Diff => "diff",
        }
    }
}

/// How the image frames what it shows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Frame {
    /// One rounded card with a hairline border: the renderer's content, then its legend and the summary bar, divided
    /// by hairlines. Outside the rounded corners the image is transparent, or the matte.
    #[default]
    Card,
    /// The renderer's content alone, edge to edge, without the legend or the summary bar.
    None,
    /// The stage edge to edge, then the legend and the summary bar as bands below it, as the Inspector shows them:
    /// its sweep thumbnails.
    Page,
}

impl Frame {
    pub fn name(self) -> &'static str {
        match self {
            Frame::Card => "card",
            Frame::None => "none",
            Frame::Page => "page",
        }
    }
}

/// A matte colour, `#rgb` or `#rrggbb`, lowercased: what fills a card frame's corners instead of transparency, for
/// formats without alpha such as GIF.
pub fn matte(value: &str) -> Result<String> {
    let hex = value.strip_prefix('#').unwrap_or_default();
    ensure!(
        matches!(hex.len(), 3 | 6) && hex.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "--matte must be a colour as #rgb or #rrggbb, for example #ffffff or #0d1117"
    );
    Ok(value.to_ascii_lowercase())
}

/// What a snapshot's renderers open their view on (`RendererFocus` in the renderer protocol).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Focus {
    /// `changes` (a comparison's changed items) or `all`; omitted, the renderer's choice (a diff opens on its changes
    /// when they don't all fit).
    pub on: Option<FocusOn>,
    /// The selection ID of one item to open on, centred with what it connects to.
    pub entity: Option<String>,
    /// Fit what is focused whatever its text size, instead of stopping at the renderer's smallest readable text.
    pub fit: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FocusOn {
    Changes,
    All,
}

impl FocusOn {
    pub fn name(self) -> &'static str {
        match self {
            FocusOn::Changes => "changes",
            FocusOn::All => "all",
        }
    }
}

/// Rejects view settings that are out of range, before any work.
pub fn validate_settings(width: u32, height: u32, scale: f64, progress: Option<f64>, timeout: Duration) -> Result<()> {
    ensure!(
        (64..=4096).contains(&width) && (64..=4096).contains(&height),
        "--width and --height must be 64-4096 CSS pixels"
    );
    ensure!(
        scale.is_finite() && (0.5..=4.0).contains(&scale),
        "--scale must be between 0.5 and 4"
    );
    ensure!(
        f64::from(width.max(height)) * scale <= MAX_PIXELS,
        "The snapshot would exceed {MAX_PIXELS} pixels on a side; reduce --scale, --width or --height"
    );
    ensure!((1..=600).contains(&timeout.as_secs()), "--timeout must be 1-600 seconds");
    if let Some(progress) = progress {
        ensure!(
            progress.is_finite() && (0.0..=1.0).contains(&progress),
            "--progress must be between 0 and 1"
        );
    }
    Ok(())
}
