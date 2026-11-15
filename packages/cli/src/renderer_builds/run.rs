//! Running a renderer's build script and following its output.

use std::{
    io::{BufRead, BufReader, Read},
    process::{Command, Stdio},
    sync::Arc,
};

use serde_json::Value;

use super::{Build, BuildState, MAX_LINE, MAX_LINES, Phase, RendererBuilds, build_script, fingerprint, read_build_line, renderer_sources};

impl RendererBuilds {
    /// Starts the renderer's watch (or build) script, or says why it can't.
    pub(super) fn start(self: &Arc<Self>, projection: &str, definition: &Value, package: &str) {
        let directory = self.root.join(package);
        let manifest: Value = std::fs::read(directory.join("package.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(Value::Null);
        let Some((script, _)) = build_script(&manifest["scripts"]) else {
            return;
        };
        let sources = fingerprint(&self.root, &renderer_sources(definition));
        let run = {
            let mut builds = self.builds.lock().unwrap_or_else(|e| e.into_inner());
            let build = builds.entry(projection.to_owned()).or_insert_with(|| Build::new(sources));
            build.sources = sources;
            build.run += 1;
            build.exit = None;
            build.again = false;
            build.state = BuildState {
                phase: Phase::Building,
                script: Some(script.to_owned()),
                package: Some(package.to_owned()),
                ..BuildState::default()
            };
            build.run
        };
        let failed = |error: String| BuildState {
            phase: Phase::Failed,
            error: Some(error),
            script: Some(script.to_owned()),
            package: Some(package.to_owned()),
            located: false,
        };
        if !self.trust {
            self.set(
                projection,
                BuildState {
                    phase: Phase::Untrusted,
                    script: Some(script.to_owned()),
                    package: Some(package.to_owned()),
                    ..BuildState::default()
                },
            );
            return;
        }
        if !directory.join("node_modules").is_dir() {
            self.set(
                projection,
                failed(format!("Its dependencies aren't installed: run npm install in {package}.")),
            );
            return;
        }
        let mut command = Command::new(if cfg!(windows) { "npm.cmd" } else { "npm" });
        command
            .args(["run", script])
            .current_dir(&directory)
            .env("FORCE_COLOR", "0")
            .env("NO_COLOR", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // Its own process group, so stopping it stops the bundler npm started.
            command.process_group(0);
        }
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                self.set(projection, failed(format!("npm run {script} didn't start: {error}")));
                return;
            }
        };
        {
            let mut builds = self.builds.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(build) = builds.get_mut(projection) {
                build.pid = Some(child.id());
            }
        }
        self.line(projection, run, &format!("> npm run {script}"));
        let readers: Vec<Box<dyn Read + Send>> = [
            child.stdout.take().map(|out| Box::new(out) as Box<dyn Read + Send>),
            child.stderr.take().map(|err| Box::new(err) as Box<dyn Read + Send>),
        ]
        .into_iter()
        .flatten()
        .collect();
        let threads: Vec<_> = readers
            .into_iter()
            .map(|reader| {
                let (builds, projection) = (self.clone(), projection.to_owned());
                std::thread::spawn(move || {
                    for line in BufReader::new(reader).lines().map_while(Result::ok) {
                        builds.line(&projection, run, &line);
                    }
                })
            })
            .collect();
        let (builds, projection, definition, package) = (self.clone(), projection.to_owned(), definition.clone(), package.to_owned());
        std::thread::spawn(move || {
            let code = child.wait().ok().and_then(|status| status.code());
            for thread in threads {
                let _ = thread.join();
            }
            builds.ended(&projection, run, code, &definition, &package);
        });
        self.bump();
    }

    /// One line of a run's output: kept, and read for the build's state.
    fn line(&self, projection: &str, run: u64, line: &str) {
        let line: String = line.chars().take(MAX_LINE).collect();
        let sequence = self.bump();
        let mut builds = self.builds.lock().unwrap_or_else(|e| e.into_inner());
        let Some(build) = builds.get_mut(projection).filter(|build| build.run == run) else {
            return;
        };
        build.state = read_build_line(&line, &build.state);
        build.lines.push_back((sequence, line));
        while build.lines.len() > MAX_LINES {
            build.lines.pop_front();
        }
    }

    fn ended(self: &Arc<Self>, projection: &str, run: u64, code: Option<i32>, definition: &Value, package: &str) {
        let again = {
            let mut builds = self.builds.lock().unwrap_or_else(|e| e.into_inner());
            let Some(build) = builds.get_mut(projection).filter(|build| build.run == run) else {
                return;
            };
            build.pid = None;
            build.exit = Some(code.unwrap_or(-1));
            // A build that exits before saying it built failed (a watch ends only when stopped).
            match code {
                Some(0) if build.state.phase == Phase::Building => build.state.phase = Phase::Built,
                Some(0) => {}
                _ if build.state.phase != Phase::Failed => {
                    build.state.phase = Phase::Failed;
                    if build.state.error.is_none() {
                        build.state.error = Some(format!(
                            "npm run {} exited with {}",
                            build.state.script.as_deref().unwrap_or("build"),
                            code.map_or("a signal".to_owned(), |code| code.to_string())
                        ));
                    }
                }
                _ => {}
            }
            std::mem::take(&mut build.again)
        };
        self.bump();
        if again {
            self.start(projection, definition, package);
        }
    }
}

pub(super) fn kill(pid: u32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM);
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/pid", &pid.to_string(), "/t", "/f"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}
