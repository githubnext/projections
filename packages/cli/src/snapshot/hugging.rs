//! A card frame that hugs the renderer's content: the page sizes the card to it (`hug=1`) and the capture is cropped
//! to the card, at most the viewport. `--frames` keeps every frame the viewport's size.

use std::time::Instant;

use anyhow::Result;
use serde_json::{Value, json};

use super::{Browser, Capture, evaluate_string};

/// Asks the page for a hugging card, when `hug`.
pub(super) fn hug(options: &mut Capture, hug: bool) {
    if hug {
        options.url += "&hug=1";
        options.hug = true;
    }
}

/// The screenshot's parameters: the whole viewport, or for a hugging card its height from the top (with the pixel of
/// room below its edge that the page keeps), at most the viewport's.
pub(super) fn capture_parameters(browser: &mut Browser, session: &str, options: &Capture, deadline: Instant) -> Result<Value> {
    let mut parameters = json!({"format": "png", "fromSurface": true, "captureBeyondViewport": false});
    if !options.hug {
        return Ok(parameters);
    }
    let bottom = evaluate_string(
        browser,
        session,
        "String(document.querySelector('#snapshot .pi-snapshot-card')?.getBoundingClientRect().bottom ?? '')",
        deadline,
    )?;
    if let Ok(bottom) = bottom.parse::<f64>() {
        let height = f64::from(options.height).min((bottom + 1.0).ceil()).max(1.0);
        parameters["clip"] = json!({"x": 0, "y": 0, "width": options.width, "height": height, "scale": 1});
    }
    Ok(parameters)
}
