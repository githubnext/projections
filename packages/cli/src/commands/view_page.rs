//! `projections view screenshot --page`: the running viewer's own page, captured with its chrome.

use std::{path::Path, time::Duration};

use anyhow::{Context, Result};
use serde_json::json;

use super::Theme;
use crate::view::{client, registry, viewer_name};

/// Captures the page of the viewer `viewer` names (the default one without) to the new file `out`, at the person's
/// page's size and theme unless they are given.
pub async fn screenshot(
    root: &Path,
    out: &Path,
    viewer: Option<&str>,
    (theme, width, height): (Option<Theme>, Option<u32>, Option<u32>),
    json_output: bool,
) -> Result<()> {
    let name = viewer_name(viewer).map_err(anyhow::Error::msg)?;
    let record = registry::live(root, Duration::from_secs(5)).await.context(
        "No viewer is running for this repository: start one with projections view, or show a projection with projections view show",
    )?;
    let defaults = client::request(
        &record.url,
        "GET",
        &format!("control/defaults?viewer={name}"),
        None,
        Duration::from_secs(10),
    )
    .await?
    .json()?;
    anyhow::ensure!(
        defaults["projection"].is_string(),
        "The viewer shows nothing yet: show the person a projection with projections view show"
    );
    let theme = match theme {
        Some(Theme::Dark) => crate::snapshot::Theme::Dark,
        Some(Theme::Light) => crate::snapshot::Theme::Light,
        None if defaults["theme"] == "dark" => crate::snapshot::Theme::Dark,
        None => crate::snapshot::Theme::Light,
    };
    let size = |given: Option<u32>, key: &str, fallback: u32| {
        given.unwrap_or_else(|| defaults[key].as_u64().map_or(fallback, |value| value.clamp(64, 4096) as u32))
    };
    let (width, height) = (size(width, "width", 1280), size(height, "height", 800));
    let url = if name == crate::view::DEFAULT_VIEWER {
        record.url.clone()
    } else {
        format!("{}?viewer={name}", record.url)
    };
    let shot = crate::snapshot::page(crate::snapshot::PageRequest {
        url,
        theme,
        width,
        height,
        browser: crate::browser::find(None)?,
        timeout: Duration::from_secs(120),
    })
    .await?;
    crate::create_file(out, &shot.png)?;
    eprintln!("Wrote {}", out.display());
    let projection = defaults["projection"].as_str().unwrap_or_default();
    if json_output {
        let result = json!({"page": true, "viewer": name, "projection": projection, "theme": theme.name(),
            "width": width, "height": height, "notices": shot.notices, "bytes": shot.png.len()});
        println!("{result}");
    } else {
        println!(
            "Captured the viewer's page showing {projection} ({}, {width}×{height}).",
            theme.name()
        );
        for notice in &shot.notices {
            println!("Note: {notice}");
        }
    }
    Ok(())
}
