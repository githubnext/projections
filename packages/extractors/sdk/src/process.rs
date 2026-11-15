//! Runs a tool as a child of the extractor process.
//!
//! The runner supervises the extractor's whole process tree (a process group on
//! Unix, a Job Object on Windows) and bounds it by the definition's
//! `execution.timeoutMs`, so tools stay in the extractor's group: the runner's
//! timeout and cancellation stop them with the extractor.

use anyhow::{Context, Result, anyhow, bail, ensure};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;

/// Captured output of a completed tool process.
#[derive(Debug)]
pub struct Output {
    pub stdout: String,
    pub stderr: String,
}

/// The most stdout a tool may write: the extraction limit.
pub const MAX_STDOUT: usize = 8 * 1024 * 1024;
/// The most stderr a tool may write.
pub const MAX_STDERR: usize = 64 * 1024;

/// A tool that failed, with what it wrote.
#[derive(Debug)]
pub struct Failure {
    pub message: String,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl std::fmt::Display for Failure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{}: {}",
            self.message,
            String::from_utf8_lossy(&self.stderr).chars().take(4096).collect::<String>()
        )
    }
}

impl std::error::Error for Failure {}

/// Runs `argv` without a shell in `cwd` with exactly `environment`, writing
/// `stdin` to it. Stdout is bounded to [`MAX_STDOUT`] and stderr to
/// [`MAX_STDERR`]; exceeding either, a nonzero exit or non-UTF-8 stdout fails.
pub fn spawn(argv: &[String], cwd: &Path, stdin: Option<&str>, environment: &BTreeMap<String, String>) -> Result<Output> {
    ensure!(
        !argv.is_empty() && !argv[0].is_empty() && argv.iter().all(|part| !part.contains('\0')),
        "Extractor command must be a nonempty argv without NULs"
    );
    let mut child = Command::new(&argv[0])
        .args(&argv[1..])
        .current_dir(cwd)
        .env_clear()
        .envs(environment)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| format!("Could not start {}", argv[0]))?;
    let mut input = child.stdin.take().context("Missing child stdin")?;
    let bytes = stdin.unwrap_or_default().as_bytes().to_vec();
    let writer = thread::spawn(move || input.write_all(&bytes));
    let read = |mut pipe: Box<dyn Read + Send>, maximum: usize| {
        thread::spawn(move || -> (Vec<u8>, bool) {
            let mut output = Vec::new();
            let mut buffer = [0; 8192];
            loop {
                match pipe.read(&mut buffer) {
                    Ok(0) | Err(_) => return (output, false),
                    Ok(count) if output.len() + count > maximum => return (output, true),
                    Ok(count) => output.extend_from_slice(&buffer[..count]),
                }
            }
        })
    };
    let stdout = read(Box::new(child.stdout.take().context("Missing child stdout")?), MAX_STDOUT);
    let stderr = read(Box::new(child.stderr.take().context("Missing child stderr")?), MAX_STDERR);
    let (output, stdout_overflow) = stdout.join().map_err(|_| anyhow!("Output reader panicked"))?;
    let (diagnostic, stderr_overflow) = stderr.join().map_err(|_| anyhow!("Diagnostic reader panicked"))?;
    let mut failure = None;
    if stdout_overflow || stderr_overflow {
        // A reader stopped early; stop the tool rather than wait on a full pipe.
        let _ = child.kill();
        failure = Some(format!(
            "Process output exceeded {} bytes",
            if stdout_overflow { MAX_STDOUT } else { MAX_STDERR }
        ));
    }
    let status = child.wait()?;
    if let Err(error) = writer.join().map_err(|_| anyhow!("Input writer panicked"))?
        && error.kind() != std::io::ErrorKind::BrokenPipe
    {
        failure.get_or_insert(error.to_string());
    }
    if !status.success() {
        failure.get_or_insert(format!("{} exited with {status}", argv[0]));
    }
    if let Some(message) = failure {
        return Err(Failure {
            message,
            stdout: output,
            stderr: diagnostic,
        }
        .into());
    }
    let stderr = String::from_utf8_lossy(&diagnostic).into_owned();
    match String::from_utf8(output) {
        Ok(stdout) => Ok(Output { stdout, stderr }),
        Err(_) => bail!("Extractor tool stdout is not UTF-8"),
    }
}
