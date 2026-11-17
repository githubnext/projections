//! What a sweep says about each projection: how often it changed across the
//! swept changes, and so whether it singles out the changes that reshape the
//! system it shows. The Inspector's Explore view judges the same way
//! (packages/host/inspector/src/sweep/stats.ts); keep the two together.

use serde_json::Value;

/// Below this many judged changes (swept and not failed), a projection isn't judged.
pub const JUDGED_FROM: usize = 4;

/// A projection's signal across a sweep, best first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Signal {
    /// Changed on a quarter of the changes or fewer: the structural ones.
    Rare,
    Steady,
    /// Too few changes to judge.
    Unknown,
    /// Changed on four in five changes or more: likely noise.
    Noisy,
    /// Never changed.
    Quiet,
}

impl Signal {
    pub fn name(self) -> &'static str {
        match self {
            Self::Rare => "rare",
            Self::Steady => "steady",
            Self::Unknown => "unknown",
            Self::Noisy => "noisy",
            Self::Quiet => "quiet",
        }
    }
}

/// One projection's tally across a sweep.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tally {
    pub changed: usize,
    /// Changes it was extracted on both sides of, whether or not it changed.
    pub judged: usize,
    pub failed: usize,
    pub signal: Signal,
}

/// The tally of `projection`'s cells.
pub fn tally<'a>(projection: &str, cells: impl IntoIterator<Item = &'a Value>) -> Tally {
    let (mut changed, mut judged, mut failed) = (0, 0, 0);
    for cell in cells.into_iter().filter(|cell| cell["projection"] == projection) {
        match cell["status"].as_str() {
            Some("failed") => failed += 1,
            Some("changed") => {
                changed += 1;
                judged += 1;
            }
            _ => judged += 1,
        }
    }
    let signal = if judged < JUDGED_FROM {
        Signal::Unknown
    } else if changed == 0 {
        Signal::Quiet
    } else if changed * 5 >= judged * 4 {
        Signal::Noisy
    } else if changed * 4 <= judged {
        Signal::Rare
    } else {
        Signal::Steady
    };
    Tally {
        changed,
        judged,
        failed,
        signal,
    }
}

/// What a tally means, in words, when it means something: why a noisy
/// projection is likely noise, and that a quiet one showed nothing.
pub fn note(tally: &Tally) -> Option<String> {
    match tally.signal {
        Signal::Noisy => Some(format!(
            "likely noise: it changed on {} of {} changes, so it doesn't single out the ones that reshape what it shows. \
             Adopt it only if every change really does; for a custom extractor, look for data that changes for unrelated reasons",
            tally.changed, tally.judged
        )),
        Signal::Quiet => Some(format!(
            "never changed on these {} changes: nothing to show unless older or larger changes touch what it reads (--last N sweeps more)",
            tally.judged
        )),
        Signal::Rare => Some("changes only on a few changes, likely the structural ones: worth a look".to_owned()),
        Signal::Steady | Signal::Unknown => None,
    }
}

/// Ready rows in signal order (rare, steady, unknown, noisy, quiet), then by
/// how often they changed and by ID; rows that didn't run come last, as they came.
pub fn ranked<'a>(rows: impl IntoIterator<Item = &'a Value>, cells: &[&Value]) -> Vec<(&'a Value, Option<Tally>)> {
    let mut ready: Vec<(&Value, Option<Tally>)> = Vec::new();
    let mut skipped = Vec::new();
    for row in rows {
        if row["status"] == "ready" {
            let id = row["projection"].as_str().unwrap_or_default();
            ready.push((row, Some(tally(id, cells.iter().copied()))));
        } else {
            skipped.push((row, None));
        }
    }
    ready.sort_by(|(a, x), (b, y)| {
        let (x, y) = (x.expect("ready rows are tallied"), y.expect("ready rows are tallied"));
        x.signal
            .cmp(&y.signal)
            .then(y.changed.cmp(&x.changed))
            .then(a["projection"].as_str().cmp(&b["projection"].as_str()))
    });
    ready.extend(skipped);
    ready
}

/// The closing advice for a ranked sweep: which projections are worth a look,
/// which are likely noise and which never changed.
pub fn advice(ranked: &[(&Value, Option<Tally>)]) -> String {
    let names = |wanted: &[Signal]| -> Vec<&str> {
        ranked
            .iter()
            .filter(|(_, tally)| tally.is_some_and(|tally| wanted.contains(&tally.signal)))
            .filter_map(|(row, _)| row["projection"].as_str())
            .collect()
    };
    let mut lines = Vec::new();
    let worth = names(&[Signal::Rare, Signal::Steady]);
    if !worth.is_empty() {
        lines.push(format!("Worth a look: {}.", worth.join(", ")));
    }
    let noisy = names(&[Signal::Noisy]);
    if !noisy.is_empty() {
        lines.push(format!("Likely noise (changed on nearly every change): {}.", noisy.join(", ")));
    }
    let quiet = names(&[Signal::Quiet]);
    if !quiet.is_empty() {
        lines.push(format!("Never changed here: {}.", quiet.join(", ")));
    }
    if worth.is_empty() && !(noisy.is_empty() && quiet.is_empty()) {
        lines.push(
            "None of these singles out particular changes: build a projection of what this repository is about (projections help agents create-projection)."
                .to_owned(),
        );
    }
    lines.iter().map(|line| format!("{line}\n")).collect()
}
