//! Running processes under supervision: extractors, containers, Git and
//! prepare steps, with their output bounded and their process trees stopped.

use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex, atomic::Ordering, mpsc},
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow, ensure};

use super::{ProcessOutput, Runner};
use crate::supervision::Group;

impl Runner {
    pub fn run_argv(
        &self,
        argv: &[String],
        cwd: &Path,
        input: Option<&str>,
        timeout_ms: u64,
        environment: &BTreeMap<String, String>,
    ) -> Result<ProcessOutput> {
        let output = match self.run_bytes(argv, cwd, input.map(str::as_bytes), timeout_ms, environment, 8 * 1024 * 1024) {
            Ok(output) => output,
            Err(error) => {
                if let Some(output) = error.downcast_ref::<ProcessFailure>() {
                    self.record_output(
                        self.current.lock().expect("revision lock")["ref"].as_str().unwrap_or(""),
                        &String::from_utf8_lossy(&output.stdout),
                        &String::from_utf8_lossy(&output.stderr),
                    );
                }
                return Err(error);
            }
        };
        let stderr = String::from_utf8_lossy(&output.1).into_owned();
        let stdout = match String::from_utf8(output.0) {
            Ok(stdout) => stdout,
            Err(error) => {
                self.record_output(
                    self.current.lock().expect("revision lock")["ref"].as_str().unwrap_or(""),
                    &String::from_utf8_lossy(error.as_bytes()),
                    &stderr,
                );
                return Err(error).context("Extractor stdout is not UTF-8");
            }
        };
        Ok(ProcessOutput { stdout, stderr })
    }

    fn run_bytes(
        &self,
        argv: &[String],
        cwd: &Path,
        input: Option<&[u8]>,
        timeout_ms: u64,
        environment: &BTreeMap<String, String>,
        maximum: usize,
    ) -> Result<(Vec<u8>, Vec<u8>)> {
        self.check_cancelled()?;
        ensure!((1..=300_000).contains(&timeout_ms), "Timeout must be 1-300000 ms");
        ensure!(
            !argv.is_empty() && !argv[0].is_empty() && argv.iter().all(|part| !part.contains('\0')),
            "Invalid executable argv"
        );
        // A bare `python3` or `python` runs this machine's Python 3, whatever its launcher is called.
        let argv = &crate::python::launch(argv, environment)?;
        let mut group = Group::new()?;
        let mut command = Command::new(&argv[0]);
        command
            .args(&argv[1..])
            .current_dir(cwd)
            .env_clear()
            .envs(environment)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        group.prepare(&mut command);
        let mut spawned = command.spawn().with_context(|| format!("Could not start {}", argv[0]))?;
        group.adopt(&mut spawned)?;
        let mut child = ChildGuard(spawned, false, group);
        let mut stdin = child.0.stdin.take().context("Missing child stdin")?;
        let input = input.unwrap_or_default().to_vec();
        let writer = thread::spawn(move || -> std::io::Result<()> { stdin.write_all(&input) });
        let stdout = child.0.stdout.take().context("Missing child stdout")?;
        let stderr = child.0.stderr.take().context("Missing child stderr")?;
        let (sender, receiver) = mpsc::channel();
        let stdout = read_bounded(Box::new(stdout), maximum, sender.clone());
        let stderr = read_bounded(Box::new(stderr), 64 * 1024, sender);
        let start = Instant::now();
        let mut failure = None;
        let mut timed_out = false;
        let status = loop {
            if let Ok(message) = receiver.try_recv() {
                failure = Some(anyhow!(message));
            }
            if self.cancel.load(Ordering::SeqCst) {
                failure = Some(anyhow!("Operation was cancelled"));
            }
            if start.elapsed() > Duration::from_millis(timeout_ms) {
                failure = Some(anyhow!("{} timed out after {timeout_ms} ms", program_name(argv)));
                timed_out = true;
            }
            if let Some(status) = child.0.try_wait()? {
                break status;
            }
            if failure.is_some() && !child.1 {
                stop_child_group(&mut child)?;
                child.1 = true;
            }
            thread::sleep(Duration::from_millis(5));
        };
        if !child.1 {
            stop_child_group(&mut child)?;
            child.1 = true;
        }
        child.2.drain()?;
        let (output, output_failure) = stdout.join().map_err(|_| anyhow!("Output reader panicked"))?;
        let (diagnostic, diagnostic_failure) = stderr.join().map_err(|_| anyhow!("Diagnostic reader panicked"))?;
        for message in [output_failure, diagnostic_failure].into_iter().flatten() {
            failure.get_or_insert(anyhow!(message));
        }
        if let Err(error) = writer.join().map_err(|_| anyhow!("Input writer panicked"))?
            && error.kind() != std::io::ErrorKind::BrokenPipe
        {
            failure.get_or_insert(anyhow!(error));
        }
        if !status.success() {
            failure.get_or_insert(anyhow!("{} exited with {status}", program_name(argv)));
        }
        if let Some(error) = failure {
            return Err(ProcessFailure {
                program: argv[0].clone(),
                message: format!("{error:#}"),
                stdout: output,
                stderr: diagnostic,
                timed_out,
            }
            .into());
        }
        Ok((output, diagnostic))
    }

    pub fn git(&self, root: &Path, args: &[&str], input: Option<&[u8]>, maximum: usize) -> Result<Vec<u8>> {
        self.git_with(root, args, input, maximum, &[])
    }

    /// Runs `argv` without a shell in `cwd` with exactly `environment`, under
    /// the same supervision as an extractor (its whole process tree is stopped
    /// on timeout or cancellation), writing stdout and stderr to `log` (the
    /// first `log_limit` bytes; the rest is counted, not kept). For long
    /// commands whose output isn't data, such as an environment's prepare steps.
    pub fn run_logged(
        &self,
        argv: &[String],
        cwd: &Path,
        environment: &BTreeMap<String, String>,
        timeout: Duration,
        log: &Path,
        log_limit: u64,
    ) -> Result<std::process::ExitStatus> {
        self.check_cancelled()?;
        ensure!(
            !argv.is_empty() && !argv[0].is_empty() && argv.iter().all(|part| !part.contains('\0')),
            "Invalid argv"
        );
        let file = Arc::new(Mutex::new((fs::File::create(log)?, 0u64)));
        // A bare `python3` or `python` runs this machine's Python 3, whatever its launcher is called.
        let argv = &crate::python::launch(argv, environment)?;
        let mut group = Group::new()?;
        let mut command = Command::new(&argv[0]);
        command
            .args(&argv[1..])
            .current_dir(cwd)
            .env_clear()
            .envs(environment)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        group.prepare(&mut command);
        let mut spawned = command.spawn().with_context(|| format!("Could not start {}", argv[0]))?;
        group.adopt(&mut spawned)?;
        let mut child = ChildGuard(spawned, false, group);
        let copy = |mut pipe: Box<dyn Read + Send>, file: Arc<Mutex<(fs::File, u64)>>| {
            thread::spawn(move || {
                let mut buffer = [0; 8192];
                while let Ok(count) = pipe.read(&mut buffer) {
                    if count == 0 {
                        break;
                    }
                    let mut guard = file.lock().expect("log lock");
                    let (log, written) = &mut *guard;
                    let keep = (log_limit.saturating_sub(*written) as usize).min(count);
                    if keep > 0 {
                        let _ = log.write_all(&buffer[..keep]);
                    }
                    if keep < count && *written <= log_limit {
                        let _ = log.write_all(b"\n[log truncated]\n");
                    }
                    *written += count as u64;
                }
            })
        };
        let stdout = copy(Box::new(child.0.stdout.take().context("Missing child stdout")?), file.clone());
        let stderr = copy(Box::new(child.0.stderr.take().context("Missing child stderr")?), file.clone());
        let start = Instant::now();
        let mut failure = None;
        let status = loop {
            if self.cancel.load(Ordering::SeqCst) {
                failure = Some(anyhow!("Operation was cancelled"));
            }
            if start.elapsed() > timeout {
                failure = Some(anyhow!("Timed out after {} s", timeout.as_secs()));
            }
            if let Some(status) = child.0.try_wait()? {
                break status;
            }
            if failure.is_some() && !child.1 {
                stop_child_group(&mut child)?;
                child.1 = true;
            }
            thread::sleep(Duration::from_millis(20));
        };
        if !child.1 {
            stop_child_group(&mut child)?;
            child.1 = true;
        }
        child.2.drain()?;
        let _ = stdout.join();
        let _ = stderr.join();
        match failure {
            Some(error) => Err(error),
            None => Ok(status),
        }
    }

    /// [`Runner::git`] with extra environment variables, such as `GIT_INDEX_FILE`.
    pub fn git_with(&self, root: &Path, args: &[&str], input: Option<&[u8]>, maximum: usize, extra: &[(&str, &str)]) -> Result<Vec<u8>> {
        let mut environment = self.environment(&[])?;
        for (name, value) in extra {
            environment.insert((*name).into(), (*value).into());
        }
        for (name, value) in [
            ("GIT_CONFIG_NOSYSTEM", "1"),
            ("GIT_CONFIG_GLOBAL", "/dev/null"),
            ("GIT_NO_REPLACE_OBJECTS", "1"),
            ("GIT_OPTIONAL_LOCKS", "0"),
            ("GIT_TERMINAL_PROMPT", "0"),
            ("GIT_ATTR_NOSYSTEM", "1"),
        ] {
            environment.insert(name.into(), value.into());
        }
        let mut argv = vec![
            "git".into(),
            "--no-pager".into(),
            "-c".into(),
            "core.fsmonitor=false".into(),
            "-c".into(),
            "core.hooksPath=/dev/null".into(),
        ];
        argv.extend(args.iter().map(|part| (*part).to_owned()));
        Ok(self.run_bytes(&argv, root, input, 30_000, &environment, maximum)?.0)
    }

    pub fn git_text(&self, root: &Path, args: &[&str]) -> Result<String> {
        Ok(String::from_utf8(self.git(root, args, None, 16 * 1024 * 1024)?)?.trim().to_owned())
    }
}

/// The executable `program` resolves to on `PATH`, if any.
pub fn which(program: &str) -> Option<PathBuf> {
    which_in(program, &std::env::var_os("PATH")?)
}

/// The executable `program` resolves to on the search path `path`, if any.
pub fn which_in(program: &str, path: &std::ffi::OsStr) -> Option<PathBuf> {
    std::env::split_paths(path).find_map(|directory| {
        let candidate = directory.join(program);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        for extension in ["exe", "cmd", "bat"] {
            let candidate = directory.join(format!("{program}.{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        None
    })
}

/// A process that failed: what went wrong, and what it wrote.
#[derive(Debug)]
pub struct ProcessFailure {
    pub(super) program: String,
    pub(super) message: String,
    pub(super) stdout: Vec<u8>,
    pub(super) stderr: Vec<u8>,
    /// Whether it was stopped for running past its timeout.
    pub(super) timed_out: bool,
}

impl ProcessFailure {
    /// Whether the process was Git, which the runner runs itself, rather
    /// than an extractor or tool a definition named.
    pub fn is_git(&self) -> bool {
        Path::new(&self.program).file_stem().is_some_and(|stem| stem == "git")
    }
    /// What went wrong, for example `node exited with exit status: 1`.
    pub fn message(&self) -> &str {
        &self.message
    }
    /// Whether it was stopped for running past its timeout.
    pub fn timed_out(&self) -> bool {
        self.timed_out
    }
    /// The process's stderr, as text.
    pub fn stderr(&self) -> String {
        String::from_utf8_lossy(&self.stderr).into_owned()
    }
}
impl std::fmt::Display for ProcessFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{}: {}",
            self.message,
            String::from_utf8_lossy(&self.stderr).chars().take(4096).collect::<String>()
        )
    }
}
impl std::error::Error for ProcessFailure {}

struct ChildGuard(std::process::Child, bool, Group);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if !self.1
            && let Err(error) = stop_child_group(self)
        {
            eprintln!("projections: child cleanup failed: {error:#}");
        }
        if let Err(error) = self.0.wait() {
            eprintln!("projections: child reap failed: {error}");
        }
    }
}

fn stop_child_group(child: &mut ChildGuard) -> Result<()> {
    child.2.stop(&mut child.0)
}

/// Reads `pipe` to its end on a thread, keeping at most `maximum` bytes; on a
/// read failure or overflow it stops and tells `sender`, so the process is stopped.
fn read_bounded(
    mut pipe: Box<dyn Read + Send>,
    maximum: usize,
    sender: mpsc::Sender<&'static str>,
) -> thread::JoinHandle<(Vec<u8>, Option<String>)> {
    thread::spawn(move || -> (Vec<u8>, Option<String>) {
        let mut output = Vec::new();
        let mut buffer = [0; 8192];
        loop {
            let count = match pipe.read(&mut buffer) {
                Ok(count) => count,
                Err(error) => {
                    let _ = sender.send("Process output reader failed");
                    return (output, Some(error.to_string()));
                }
            };
            if count == 0 {
                return (output, None);
            }
            if output.len() + count > maximum {
                let _ = sender.send("Process output exceeded its byte limit");
                return (output, Some(format!("Process output exceeded {maximum} bytes")));
            }
            output.extend_from_slice(&buffer[..count]);
        }
    })
}

/// How a failure names a process: a built-in extractor by its ID, anything else
/// by its file name, never by the absolute path it ran from.
fn program_name(argv: &[String]) -> String {
    if argv.get(1).map(String::as_str) == Some(crate::collectors::ENTRYPOINT)
        && let Some(id) = argv.get(2)
    {
        return format!("Extractor {id}");
    }
    Path::new(&argv[0])
        .file_name()
        .map_or_else(|| argv[0].clone(), |name| name.to_string_lossy().into_owned())
}
