//! The `projections` Python module (`packages/cli/python/projections`), which
//! lets a Python extractor read its request and write its extraction without
//! handling the protocol's JSON. It is embedded in this executable and
//! unpacked into the per-user cache on first use; the runner prepends its
//! directory to a custom extractor's `PYTHONPATH`, so it needs no install.
//! It also finds the Python 3 that a command's bare `python3` or `python`
//! runs on this machine ([`launch`]), whatever the platform calls it.

use std::{
    borrow::Cow,
    collections::{BTreeMap, HashMap},
    ffi::{OsStr, OsString},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};

/// The variable that names the module's directory to Python.
pub const VARIABLE: &str = "PYTHONPATH";

/// Where the module's directory is mounted in a container.
pub const CONTAINER_DIRECTORY: &str = "/projections/python";

const FILES: &[crate::cache::Entry] = &[("projections/__init__.py", include_bytes!("../python/projections/__init__.py"))];

/// The directory holding the `projections` module, unpacked and verified under the cache base `base`.
pub fn directory_in(base: &Path) -> Result<PathBuf> {
    crate::cache::unpack(base, env!("CARGO_PKG_VERSION"), FILES)
}

/// `environment`'s `PYTHONPATH` with `directory` first, before any `PYTHONPATH` it already has (one that
/// `execution.environment` passes through), joined with `separator`.
pub fn prepend(environment: &mut BTreeMap<String, String>, directory: &str, separator: char) {
    let value = match environment.get(VARIABLE).filter(|value| !value.is_empty()) {
        Some(existing) => format!("{directory}{separator}{existing}"),
        None => directory.to_owned(),
    };
    environment.insert(VARIABLE.into(), value);
}

/// The separator of this platform's search paths.
pub const SEPARATOR: char = if cfg!(windows) { ';' } else { ':' };

/// Whether `program` is a bare Python launcher name that the runner resolves
/// to this machine's Python 3 ([`launch`]).
pub fn launches_python(program: &str) -> bool {
    matches!(program, "python3" | "python")
}

/// `argv` as it runs on this machine: a bare `python3` or `python` (see
/// [`launches_python`]) becomes the first Python 3 on the search path of
/// `environment`, trying the name as written, then the other name, then the
/// `py -3` launcher. The same definition then runs on macOS and Linux, where
/// Python 3 is usually `python3`, and on Windows, where it is usually `python`
/// or `py`. Any other argv is returned as it is.
pub fn launch<'a>(argv: &'a [String], environment: &BTreeMap<String, String>) -> Result<Cow<'a, [String]>> {
    let Some(program) = argv.first().filter(|program| launches_python(program)) else {
        return Ok(Cow::Borrowed(argv));
    };
    let path = environment.get("PATH").map(OsString::from).unwrap_or_default();
    let prefix = interpreter(program, &path, environment).with_context(|| {
        format!(
            "{program} needs Python 3, but none of python3, python or py -3 on PATH runs it; install Python 3 or name the interpreter by its path"
        )
    })?;
    Ok(Cow::Owned(prefix.into_iter().chain(argv[1..].iter().cloned()).collect()))
}

/// The Python 3 a bare `program` (see [`launches_python`]) runs as with this
/// process's own `PATH`, for reports such as `projections doctor`: the
/// interpreter or launcher's path, and its argument (`-3` for `py`).
pub fn find(program: &str) -> Option<Vec<String>> {
    let environment: BTreeMap<String, String> = ["PATH", "SystemRoot"]
        .into_iter()
        .filter_map(|name| Some((name.to_owned(), std::env::var(name).ok()?)))
        .collect();
    interpreter(program, &std::env::var_os("PATH")?, &environment)
}

/// The argv prefix that runs Python 3 for `program` on `path`, remembered for
/// the life of the process.
fn interpreter(program: &str, path: &OsStr, environment: &BTreeMap<String, String>) -> Option<Vec<String>> {
    type Found = Mutex<HashMap<(String, OsString), Option<Vec<String>>>>;
    static FOUND: OnceLock<Found> = OnceLock::new();
    let key = (program.to_owned(), path.to_owned());
    if let Some(found) = FOUND.get_or_init(Found::default).lock().expect("interpreter lock").get(&key) {
        return found.clone();
    }
    let other = if program == "python3" { "python" } else { "python3" };
    let found = [(program, None), (other, None), ("py", Some("-3"))]
        .into_iter()
        .find_map(|(name, argument)| {
            let executable = crate::runtime::which_in(name, path)?;
            let prefix: Vec<String> = std::iter::once(executable.to_string_lossy().into_owned())
                .chain(argument.map(str::to_owned))
                .collect();
            is_python3(&prefix, environment).then_some(prefix)
        });
    FOUND
        .get_or_init(Found::default)
        .lock()
        .expect("interpreter lock")
        .insert(key, found.clone());
    found
}

/// Whether `prefix` runs Python 3, by its `--version` (Python 3 prints it on
/// stdout; Python 2 on stderr). A launcher that doesn't (Python 2, or the
/// Microsoft Store's `python3` alias with no Python installed) or that runs
/// past a few seconds doesn't count. A plain argument suits every launcher,
/// including the batch-file shims of version managers.
fn is_python3(prefix: &[String], environment: &BTreeMap<String, String>) -> bool {
    let Ok(mut child) = Command::new(&prefix[0])
        .args(&prefix[1..])
        .arg("--version")
        .env_clear()
        .envs(environment)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() < Duration::from_secs(10) => thread::sleep(Duration::from_millis(5)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    };
    let mut output = String::new();
    let read = child
        .stdout
        .take()
        .is_some_and(|mut stdout| stdout.read_to_string(&mut output).is_ok());
    status.success() && read && output.trim().starts_with("Python 3.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_module_goes_before_a_pythonpath_passed_through() {
        let mut environment = BTreeMap::new();
        prepend(&mut environment, "/cache/python", ':');
        assert_eq!(environment[VARIABLE], "/cache/python");
        environment.insert(VARIABLE.into(), "/mine".into());
        prepend(&mut environment, "/cache/python", ':');
        assert_eq!(environment[VARIABLE], "/cache/python:/mine");
    }

    #[test]
    fn the_module_unpacks_into_the_cache() {
        let base = tempfile::tempdir().unwrap();
        let directory = directory_in(base.path()).unwrap();
        let module = std::fs::read_to_string(directory.join("projections/__init__.py")).unwrap();
        assert!(module.contains("def result("), "{module}");
        assert_eq!(directory_in(base.path()).unwrap(), directory, "a second use reuses it");
    }

    /// A search path holding stand-in launchers, each printing a version of Python with this major version.
    fn launchers(versions: &[(&str, &str)]) -> (tempfile::TempDir, BTreeMap<String, String>) {
        let directory = tempfile::tempdir().unwrap();
        for (name, version) in versions {
            let path = launcher(directory.path(), name);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::write(&path, format!("#!/bin/sh\necho Python {version}.12.0\n")).unwrap();
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            #[cfg(windows)]
            std::fs::write(&path, format!("@echo Python {version}.12.0\r\n")).unwrap();
        }
        let mut environment = BTreeMap::from([("PATH".to_owned(), directory.path().to_string_lossy().into_owned())]);
        if let Ok(root) = std::env::var("SystemRoot") {
            environment.insert("SystemRoot".into(), root);
        }
        (directory, environment)
    }

    fn launcher(directory: &Path, name: &str) -> PathBuf {
        directory.join(if cfg!(windows) { format!("{name}.cmd") } else { name.to_owned() })
    }

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    #[test]
    fn a_bare_python3_runs_python_when_python3_is_missing_or_python_2() {
        let (directory, environment) = launchers(&[("python", "3")]);
        let python = launcher(directory.path(), "python").to_string_lossy().into_owned();
        assert_eq!(
            *launch(&argv(&["python3", "x.py"]), &environment).unwrap(),
            [python.clone(), "x.py".into()]
        );
        let (directory, environment) = launchers(&[("python3", "2"), ("python", "3")]);
        let python = launcher(directory.path(), "python").to_string_lossy().into_owned();
        assert_eq!(*launch(&argv(&["python3", "x.py"]), &environment).unwrap(), [python, "x.py".into()]);
    }

    #[test]
    fn the_name_as_written_comes_first_then_the_py_launcher() {
        let (directory, environment) = launchers(&[("python3", "3"), ("python", "3"), ("py", "3")]);
        let named = |name: &str| launcher(directory.path(), name).to_string_lossy().into_owned();
        assert_eq!(
            *launch(&argv(&["python", "x.py"]), &environment).unwrap(),
            [named("python"), "x.py".into()]
        );
        assert_eq!(
            *launch(&argv(&["python3", "x.py"]), &environment).unwrap(),
            [named("python3"), "x.py".into()]
        );
        let (directory, environment) = launchers(&[("python", "2"), ("py", "3")]);
        let py = launcher(directory.path(), "py").to_string_lossy().into_owned();
        assert_eq!(
            *launch(&argv(&["python", "x.py"]), &environment).unwrap(),
            [py, "-3".into(), "x.py".into()]
        );
    }

    #[test]
    fn no_python_3_fails_with_what_was_tried() {
        let (_directory, environment) = launchers(&[("python", "2")]);
        let error = launch(&argv(&["python3", "x.py"]), &environment).unwrap_err();
        assert!(format!("{error:#}").contains("none of python3, python or py -3"), "{error:#}");
    }

    #[test]
    fn other_programs_and_paths_run_as_written() {
        let environment = BTreeMap::new();
        for written in [
            argv(&["node", "x.mjs"]),
            argv(&["./python3", "x.py"]),
            argv(&["python3.12", "x.py"]),
        ] {
            assert!(matches!(launch(&written, &environment).unwrap(), Cow::Borrowed(_)), "{written:?}");
        }
    }
}
