//! Reading a build's output for its state.

use std::sync::LazyLock;

use regex::Regex;

use super::{BuildState, Phase};

static ANSI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b\[[0-9;?]*[A-Za-z]").unwrap());
static BUILDING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^build started|^rebuilding|^\[watch\] build started|building .*for production").unwrap());
static BUILT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^built in \d|^✓ built in|\[watch\] build finished|^build (succeeded|finished)").unwrap());
static LOCATED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([^/\\]+:\d+:\d+): ERROR: (.*)$").unwrap());
static ERROR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)error during build|^error\b|^\[[\w:-]+\]:? .*(failed|error)|Build failed|^✘ \[ERROR\]|\berror TS\d+:").unwrap()
});

fn cut(text: &str) -> String {
    text.chars().take(500).collect()
}

/// A build's output, line by line: `build started` is building, `built in
/// 120ms` built, and an error line failed, with the first error.
pub fn read_build_line(line: &str, state: &BuildState) -> BuildState {
    let text = ANSI.replace_all(line, "");
    let text = text.trim();
    let mut next = state.clone();
    // npm echoes the script it runs (`> vite build --watch`): that says nothing of the build.
    if text.is_empty() || text.starts_with("> ") {
        return next;
    }
    if BUILDING.is_match(text) {
        next.phase = Phase::Building;
        next.error = None;
        next.located = false;
    } else if BUILT.is_match(text) {
        // A build that reported an error, then finished, still failed.
        if state.phase != Phase::Failed {
            next.phase = Phase::Built;
            next.error = None;
            next.located = false;
        }
    } else if let Some(located) = LOCATED.captures(text) {
        if !(state.phase == Phase::Failed && state.located) {
            next.phase = Phase::Failed;
            next.error = Some(cut(&format!("{}: {}", &located[1], &located[2])));
            next.located = true;
        }
    } else if ERROR.is_match(text) && !(state.phase == Phase::Failed && state.error.is_some()) {
        next.phase = Phase::Failed;
        next.error = Some(cut(text));
    }
    next
}
