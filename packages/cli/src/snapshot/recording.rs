//! `--frames`: the animated comparison recorded as the viewer plays it, looping back and forth.

use std::time::Instant;

use anyhow::{Context, Result, ensure};
use serde_json::Value;

use super::{Browser, Capture, Mode, Request, UNSETTLED, evaluate_string, navigate, open, prepare, query, shoot, wait_ready};

/// One frame of recorded playback (`record`): its image, the progress and direction it shows, and how long.
pub struct PlaybackFrame {
    pub png: Vec<u8>,
    pub progress: f64,
    /// 1 forward, -1 backward.
    pub direction: i8,
    pub duration_ms: f64,
}

/// What `record` drew.
pub struct Recording {
    pub frames: Vec<PlaybackFrame>,
    pub notices: Vec<String>,
}

/// Renders the animated comparison as the viewer plays it looping back and forth at 1× speed, from the start of the
/// hold at the before end: one turn forward and one backward, each sampled every `frame_ms` by the page from the
/// host's own playback timeline (the renderer's step ends for that direction, its pace and the holds). Consecutive
/// frames that show the same progress are one, and the endpoints' half-holds join, so a looped image holds at each
/// end as the viewer does.
pub async fn record(request: Request, frame_ms: f64) -> Result<Recording> {
    ensure!(
        request.document["format"] == "projections.comparison",
        "--frames draws the playback of a comparison (<BASE>..<HEAD>)"
    );
    ensure!(
        matches!(request.mode, None | Some(Mode::Animated)) && request.progress.is_none(),
        "--frames draws the animated comparison's playback, so it takes no --mode or --progress"
    );
    ensure!(
        frame_ms.is_finite() && (1.0..=1000.0).contains(&frame_ms),
        "--fps must be between 1 and 1000"
    );
    let mut prepared = prepare(Request {
        mode: Some(Mode::Animated),
        ..request
    })
    .await?;
    let host = prepared.host;
    let mut notices = std::mem::take(&mut prepared.notices);
    let options = prepared.capture;
    let recorded = tokio::task::spawn_blocking(move || {
        let (mut browser, session) = open(&options)?;
        let frames = record_frames(&mut browser, &session, &options, frame_ms);
        browser.close()?;
        frames
    })
    .await;
    host.close().await;
    let (frames, settled) = recorded.context("Snapshot capture task failed")??;
    if !settled {
        notices.push(UNSETTLED.to_owned());
    }
    Ok(Recording { frames, notices })
}

/// The frames of one loop (see `record`) and whether every capture settled.
fn record_frames(browser: &mut Browser, session: &str, options: &Capture, frame_ms: f64) -> Result<(Vec<PlaybackFrame>, bool)> {
    let name = |direction: i8| if direction == 1 { "forward" } else { "backward" };
    // (progress, direction, duration) for the whole loop, from each direction's turn.
    let mut plan: Vec<(f64, i8, f64)> = Vec::new();
    for direction in [1, -1] {
        let url = format!(
            "{}{}{}{}",
            options.url,
            query("progress", if direction == 1 { "0" } else { "1" }),
            query("direction", name(direction)),
            query("turn", &frame_ms.to_string())
        );
        let deadline = Instant::now() + options.timeout;
        navigate(browser, session, &url, deadline)?;
        wait_ready(browser, session, options, deadline)?;
        let turn = evaluate_string(
            browser,
            session,
            "document.documentElement.dataset.projectionsSnapshotTurn ?? ''",
            deadline,
        )?;
        let turn: Value = serde_json::from_str(&turn).context("The snapshot page published no playback turn")?;
        for frame in turn.as_array().context("The playback turn is not a list")? {
            let progress = frame["progress"].as_f64().context("A playback frame has no progress")?;
            let duration = frame["durationMs"].as_f64().context("A playback frame has no duration")?;
            ensure!(
                (0.0..=1.0).contains(&progress) && duration > 0.0,
                "The snapshot page published an invalid playback frame"
            );
            plan.push((progress, direction, duration));
        }
    }
    let plan = join_frames(plan);
    let mut frames = Vec::with_capacity(plan.len());
    let mut settled = true;
    for (progress, direction, duration_ms) in plan {
        let url = format!(
            "{}{}{}",
            options.url,
            query("progress", &progress.to_string()),
            query("direction", name(direction))
        );
        let (png, stable) = shoot(browser, session, &url, options)?;
        settled &= stable;
        frames.push(PlaybackFrame {
            png,
            progress,
            direction,
            duration_ms,
        });
    }
    Ok((frames, settled))
}

/// Joins consecutive frames that show the same thing (an endpoint looks the same in either direction), including the
/// last with the first, so the loop starts where the hold at the before end starts.
fn join_frames(frames: Vec<(f64, i8, f64)>) -> Vec<(f64, i8, f64)> {
    let same = |a: &(f64, i8, f64), b: &(f64, i8, f64)| (a.0 - b.0).abs() <= 1e-9 && (a.1 == b.1 || a.0 <= 0.0 || a.0 >= 1.0);
    let mut joined: Vec<(f64, i8, f64)> = Vec::new();
    for frame in frames {
        match joined.last_mut() {
            Some(last) if same(last, &frame) => last.2 += frame.2,
            _ => joined.push(frame),
        }
    }
    if joined.len() > 1 && same(&joined[0], joined.last().unwrap()) {
        let last = joined.pop().unwrap();
        joined[0].2 += last.2;
    }
    joined
}

#[cfg(test)]
mod tests {
    use super::join_frames;

    #[test]
    fn a_loop_joins_holds_and_its_ends() {
        // Forward: half the hold at 0, travel, half the hold at 1. Backward: the other halves.
        let frames = vec![
            (0.0, 1, 300.0),
            (0.5, 1, 80.0),
            (1.0, 1, 300.0),
            (1.0, -1, 300.0),
            (0.5, -1, 80.0),
            (0.0, -1, 300.0),
        ];
        assert_eq!(
            join_frames(frames),
            vec![(0.0, 1, 600.0), (0.5, 1, 80.0), (1.0, 1, 600.0), (0.5, -1, 80.0)]
        );
    }
}
