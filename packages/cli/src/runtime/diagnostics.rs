//! Runner failures as diagnostics, and protocol prose helpers.

use serde_json::{Value, json};

/// Running an extractor that executes repository code requires explicit trust.
#[derive(Debug)]
pub struct TrustRequired;

impl std::fmt::Display for TrustRequired {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Explicit --trust is required to run this projection's extractor on BOTH selected revisions")
    }
}

impl std::error::Error for TrustRequired {}

/// The machine-readable code for a runner failure.
pub fn diagnostic_code(error: &anyhow::Error) -> &'static str {
    if error.chain().any(|cause| cause.is::<TrustRequired>()) {
        "TRUST_REQUIRED"
    } else {
        "RUNNER_ERROR"
    }
}

pub fn diagnostic(error: &anyhow::Error) -> Value {
    json!({"severity":"error","code":diagnostic_code(error),"path":"","message":diagnostic_message(error)})
}

/// What a failure says, once: for a process that failed, what it reported
/// ([`reported`]) rather than the process's own path and its whole stderr,
/// which the raw output keeps.
fn diagnostic_message(error: &anyhow::Error) -> String {
    let mut parts = vec![];
    for cause in error.chain() {
        if let Some(failure) = cause.downcast_ref::<super::ProcessFailure>()
            && !failure.is_git()
        {
            parts.push(match reported(&failure.stderr()) {
                Some(line) => line.chars().take(1000).collect(),
                None => failure.message().to_owned(),
            });
            return parts.join(": ");
        }
        parts.push(cause.to_string());
    }
    format!("{error:#}")
}

/// The line of a failed process's stderr that says what went wrong: an
/// extractor's own report (the SDK writes `Extractor <id>: …` first), the
/// first `Error:`-style line (Node's `Error: Cannot find module …` after its
/// source location and excerpt), a Python traceback's last line, or a Rust
/// panic's message. Locations (`path:line[:column]`, stack frames), source
/// excerpts with their carets and blank lines never are; otherwise the first
/// line left.
pub fn reported(stderr: &str) -> Option<String> {
    let lines: Vec<&str> = stderr.lines().map(str::trim).collect();
    if let Some(message) = panic_message(&lines) {
        return Some(message);
    }
    let mut candidates: Vec<(usize, &str)> = vec![];
    for (index, line) in lines.iter().enumerate() {
        if is_caret(line) {
            // The source excerpt the caret points into.
            if candidates.last().is_some_and(|(at, _)| *at + 1 == index) {
                candidates.pop();
            }
            continue;
        }
        if !line.is_empty() && !is_location(line) && !is_noise(line) {
            candidates.push((index, line));
        }
    }
    let candidates: Vec<&str> = candidates.into_iter().map(|(_, line)| line).collect();
    if lines.contains(&"Traceback (most recent call last):") {
        // A traceback's frames and excerpts come first; the exception is last.
        return candidates
            .iter()
            .rev()
            .find(|line| is_error(line))
            .or(candidates.last())
            .map(|line| (*line).to_owned());
    }
    let first = candidates.first()?;
    if first.starts_with("Extractor ") {
        return Some((*first).to_owned());
    }
    Some((*candidates.iter().find(|line| is_error(line)).unwrap_or(first)).to_owned())
}

/// A Rust panic's message: `thread 'main' panicked at src/main.rs:3:5:` then the
/// message on the next line, or `panicked at 'message', src/main.rs:3:5` before Rust 1.73.
fn panic_message(lines: &[&str]) -> Option<String> {
    let index = lines
        .iter()
        .position(|line| line.starts_with("thread '") && line.contains("' panicked at "))?;
    let after = lines[index].split_once("' panicked at ")?.1;
    if let Some(rest) = after.strip_prefix('\'') {
        return rest.rsplit_once("', ").map(|(message, _)| message.to_owned());
    }
    lines[index + 1..]
        .iter()
        .find(|line| !line.is_empty())
        .filter(|line| !is_noise(line))
        .map(|line| (*line).to_owned())
}

/// Only a source location: `node:internal/modules/cjs/loader:1607`,
/// `/app/x.js:3:9`, a stack frame (`at f (x.js:1:2)`) or a traceback's
/// `File "x.py", line 3, in f`.
fn is_location(line: &str) -> bool {
    if line.starts_with("at ") || (line.starts_with("File \"") && line.contains("\", line ")) {
        return true;
    }
    let line = line.trim_start_matches('(').trim_end_matches(')');
    if line.contains(char::is_whitespace) {
        return false;
    }
    let mut parts = line.rsplitn(3, ':');
    let last = parts.next().unwrap_or_default();
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit());
    match (parts.next(), parts.next()) {
        (Some(middle), Some(path)) if digits(middle) => digits(last) && !path.is_empty(),
        (Some(_), _) => digits(last),
        _ => false,
    }
}

/// A caret line under a source excerpt: `^`, `^^^^` or `~~~^~~~`.
fn is_caret(line: &str) -> bool {
    line.contains('^') && line.chars().all(|character| matches!(character, '^' | '~' | ' '))
}

/// Advice and headings that never say what went wrong.
fn is_noise(line: &str) -> bool {
    ["note: run with `RUST_BACKTRACE", "stack backtrace:", "Require stack:", "Node.js v"]
        .iter()
        .any(|prefix| line.starts_with(prefix))
        || (line.starts_with("- ") && is_location(&line[2..].replace(' ', "")))
}

/// An `Error:`-style line: `Error: …`, `TypeError: …`, `ModuleNotFoundError: …`,
/// `error[E0425]: …`, `Uncaught Exception: …` or `fatal: …`.
fn is_error(line: &str) -> bool {
    let line = line.strip_prefix("Uncaught ").unwrap_or(line);
    let Some((head, _)) = line.split_once(':') else {
        return false;
    };
    if head.is_empty() || head.contains(char::is_whitespace) {
        return false;
    }
    let head = head.to_ascii_lowercase();
    head.ends_with("error") || head.ends_with("exception") || head.starts_with("error[") || head == "fatal"
}

/// `text` as an inline code span of protocol prose: notices mark their
/// identifiers, paths and flags (see the contracts' text with inline code).
pub fn code(text: &str) -> String {
    let mut span = String::from("`");
    for character in text.chars() {
        if matches!(character, '`' | '\\') {
            span.push('\\');
        }
        span.push(character);
    }
    span.push('`');
    span
}

#[cfg(test)]
mod tests {
    use super::reported;

    #[test]
    fn node_reports_the_error_after_its_location_and_source_excerpt() {
        let stderr = "node:internal/modules/cjs/loader:1607
  throw err;
  ^

Error: Cannot find module '/repo/tools/missing-extractor.js'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1604:15)
    at Module._load (node:internal/modules/cjs/loader:1346:5) {
  code: 'MODULE_NOT_FOUND',
  requireStack: []
}

Node.js v26.12.1
";
        assert_eq!(
            reported(stderr).unwrap(),
            "Error: Cannot find module '/repo/tools/missing-extractor.js'"
        );
        let thrown = "/repo/extract.mjs:3
JSON.parse(input).nope.deeper
                       ^

TypeError: Cannot read properties of undefined (reading 'deeper')
    at file:///repo/extract.mjs:3:24
";
        assert_eq!(
            reported(thrown).unwrap(),
            "TypeError: Cannot read properties of undefined (reading 'deeper')"
        );
    }

    #[test]
    fn a_python_traceback_reports_its_last_line() {
        let stderr = "Traceback (most recent call last):
  File \"/repo/tools/extract-flags.py\", line 4, in <module>
    import yaml
    ^^^^^^^^^^^
  File \"/usr/lib/python3/importlib/__init__.py\", line 90, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
ModuleNotFoundError: No module named 'yaml'
";
        assert_eq!(reported(stderr).unwrap(), "ModuleNotFoundError: No module named 'yaml'");
        let chained = "Traceback (most recent call last):
  File \"x.py\", line 1, in <module>
KeyError: 'a'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File \"x.py\", line 3, in <module>
ValueError: bad flag
";
        assert_eq!(reported(chained).unwrap(), "ValueError: bad flag");
    }

    #[test]
    fn a_rust_panic_reports_its_message() {
        let stderr = "thread 'main' panicked at src/main.rs:12:5:
called `Option::unwrap()` on a `None` value
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
";
        assert_eq!(reported(stderr).unwrap(), "called `Option::unwrap()` on a `None` value");
        let older = "thread 'main' panicked at 'no flags file', src/main.rs:12:5\nnote: run with `RUST_BACKTRACE=1`\n";
        assert_eq!(reported(older).unwrap(), "no flags file");
    }

    #[test]
    fn an_extractors_own_report_and_plain_lines_stay_first() {
        let sdk = "Extractor prisma-schema: Invalid Prisma schema at schema.prisma:89: unclosed model Broken
error: could not compile `helper`
";
        assert_eq!(
            reported(sdk).unwrap(),
            "Extractor prisma-schema: Invalid Prisma schema at schema.prisma:89: unclosed model Broken"
        );
        assert_eq!(
            reported("Waiting for the lock\nfatal: not a git repository\n").unwrap(),
            "fatal: not a git repository"
        );
        assert_eq!(
            reported("\nDeliberate extractor failure\n").unwrap(),
            "Deliberate extractor failure"
        );
        assert_eq!(
            reported("error[E0425]: cannot find value `x`\n --> src/lib.rs:3:5\n").unwrap(),
            "error[E0425]: cannot find value `x`"
        );
        assert_eq!(reported("\n  \n"), None);
        assert_eq!(reported("src/main.rs:3:5\n"), None);
    }
}
