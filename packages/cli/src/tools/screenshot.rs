//! The `screenshot` tool: a projection rendered headless, with what it omits
//! taken from the current view.

use std::fmt::Write as _;

use super::{
    read::run_job,
    views::{projection_of, short_revision},
    *,
};

/// Renders a projection the way the viewer would show it, as a PNG.
pub(super) async fn screenshot(service: &Service, input: &Value) -> Answer {
    let projection = projection_of(input)?;
    let (before, after) = match (input["before"].as_str(), input["after"].as_str()) {
        (Some(before), after) => (Some(before.to_owned()), after.unwrap_or("working-tree").to_owned()),
        (None, Some(after)) => (None, after.to_owned()),
        (None, None) => {
            let pairs = get(service, &format!("/api/pairs?projection={}", encode(projection))).await?;
            let default = &pairs["default"];
            (
                default["before"].as_str().map(str::to_owned),
                default["after"].as_str().unwrap_or("working-tree").to_owned(),
            )
        }
    };
    // The definition the viewer extracts with: the working tree's, unless it was started with another.
    let definition = input["definitionRevision"].as_str().unwrap_or("working-tree").to_owned();
    let body = match &before {
        Some(before) => {
            json!({"projectionId": projection, "before": before, "after": after, "definitionRevision": definition})
        }
        None => {
            json!({"projectionId": projection, "before": after, "definitionRevision": definition})
        }
    };
    let job = run_job(service, &body).await?;
    let document = job[if before.is_some() { "comparison" } else { "extraction" }].clone();
    let mode = input["mode"].as_str().map(|mode| match mode {
        "animated" => crate::snapshot::Mode::Animated,
        "diff" => crate::snapshot::Mode::Diff,
        _ => crate::snapshot::Mode::SideBySide,
    });
    let theme = if input["theme"] == "dark" {
        crate::snapshot::Theme::Dark
    } else {
        crate::snapshot::Theme::Light
    };
    let (width, height) = (
        input["width"].as_u64().unwrap_or(1280) as u32,
        input["height"].as_u64().unwrap_or(800) as u32,
    );
    // Only an animated frame has a progress; the other modes draw both ends.
    let progress = before
        .as_ref()
        .filter(|_| mode == Some(crate::snapshot::Mode::Animated))
        .and(input["progress"].as_f64());
    let focus = crate::snapshot::Focus {
        on: match input["focus"].as_str() {
            Some("changes") => Some(crate::snapshot::FocusOn::Changes),
            Some("all") => Some(crate::snapshot::FocusOn::All),
            _ => None,
        },
        entity: input["entity"].as_str().map(str::to_owned),
        fit: input["fit"].as_bool().unwrap_or(false),
    };
    let assets = crate::assets::inspector_assets()?;
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop = cancel.clone();
    let mut cancelled = OnDrop(Some(move || stop.store(true, std::sync::atomic::Ordering::SeqCst)));
    let rendered = crate::snapshot::render(crate::snapshot::Request {
        document,
        definition_revision: Some(definition.clone()),
        repo: service.repository().to_path_buf(),
        trust: service.trusted(),
        definition: if before.is_some() {
            crate::runtime::DefinitionSource::Head
        } else {
            crate::runtime::DefinitionSource::Base
        },
        assets: assets.path.clone(),
        mode: if before.is_some() { mode } else { None },
        progress,
        focus: crate::snapshot::Focus {
            // Changes need a comparison; one revision opens on everything.
            on: focus.on.filter(|_| before.is_some()),
            ..focus
        },
        theme,
        frame: crate::snapshot::Frame::Card,
        matte: None,
        width,
        height,
        scale: 1.0,
        browser: crate::browser::find(None)?,
        transport: Default::default(),
        timeout: Duration::from_secs(60),
        cancel,
    })
    .await?;
    cancelled.disarm();
    let pair = match &before {
        Some(before) => format!("{} → {}", short_revision(before), short_revision(&after)),
        None => short_revision(&after).to_owned(),
    };
    let presented = match (before.is_some(), mode) {
        (false, _) => "one revision".to_owned(),
        (true, Some(mode)) => mode.name().to_owned(),
        (true, None) => "the renderer's default mode".to_owned(),
    };
    let mut text = format!(
        "Rendered {projection} on {pair} ({presented}, {}, {width}×{height}): the image follows.\n",
        theme.name()
    );
    for notice in &rendered.notices {
        let _ = writeln!(text, "Note: {notice}");
    }
    let mut outcome = Outcome::new(
        text,
        json!({"projection": projection, "before": before, "after": after, "mode": mode.map(|mode| mode.name()),
            "progress": progress, "theme": theme.name(), "width": width, "height": height,
            "notices": rendered.notices, "bytes": rendered.png.len()}),
    );
    outcome.image = Some(rendered.png);
    Ok(outcome)
}
