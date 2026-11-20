//! Extractors in a container: a disposable container per run, created from a
//! local image with no network, a read-only root and the revision mounted
//! read-only, attached for the request, then removed.

use std::{collections::BTreeMap, path::Path};

use anyhow::{Context, Result, anyhow, ensure};
use serde_json::{Value, json};

use super::{ProcessFailure, ProcessOutput, Runner};

pub(super) struct ContainerRun<'a> {
    pub(super) argv: &'a [String],
    pub(super) root: &'a Path,
    pub(super) program: &'a Path,
    /// The definition's project, relative to both revisions' roots: the working directory.
    pub(super) project: &'a str,
    pub(super) request: &'a Value,
    pub(super) timeout: u64,
    pub(super) environment: &'a BTreeMap<String, String>,
    pub(super) selected: &'a [String],
    /// The `projections` Python module's directory, mounted read-only at
    /// [`crate::python::CONTAINER_DIRECTORY`].
    pub(super) python: Option<&'a Path>,
    /// The Node extractor module's directory, mounted read-only at
    /// [`crate::node::CONTAINER_DIRECTORY`] and preloaded into a bare `node`.
    pub(super) node: Option<&'a Path>,
}

impl Runner {
    pub(super) fn run_container(&self, engine: &str, image: &str, run: ContainerRun<'_>) -> Result<ProcessOutput> {
        let ContainerRun { root, request, .. } = run;
        ensure!(request["capabilities"]["network"] != true, "Container enforces network=none");
        let paths = paths(&run)?;
        let name = format!("projections-{}", uuid::Uuid::new_v4());
        let acquisition = Runner::new(root.to_owned(), false);
        let host_environment = self.environment(&[])?;
        let create = create_argv(engine, image, &name, &run, paths)?;
        let created = acquisition.run_argv(&create, root, None, 30_000, &host_environment);
        if created.as_ref().err().is_some_and(|error| {
            error
                .downcast_ref::<std::io::Error>()
                .is_some_and(|error| error.kind() == std::io::ErrorKind::NotFound)
        }) {
            return created;
        }
        let outcome = created.and_then(|created| self.attach(engine, &name, &run, &created, &host_environment));
        remove(&acquisition, engine, name, root, &host_environment, &outcome)?;
        outcome
    }

    /// Starts the created container attached, writing it the request as the
    /// container sees its paths.
    fn attach(
        &self,
        engine: &str,
        name: &str,
        run: &ContainerRun<'_>,
        created: &ProcessOutput,
        host_environment: &BTreeMap<String, String>,
    ) -> Result<ProcessOutput> {
        ensure!(
            regex::Regex::new(r"^[a-f0-9]{12,64}$")?.is_match(created.stdout.trim()),
            "Invalid container identity"
        );
        self.check_cancelled()?;
        let mut request = run.request.clone();
        request["repository"]["root"] = json!("/repository");
        if request["generations"]["file"].is_string() {
            request["generations"]["file"] = json!("/generations.jsonl");
        }
        // The working checkout is not mounted into the container.
        request["repository"]
            .as_object_mut()
            .expect("request repository")
            .remove("checkout");
        self.run_argv(
            &[
                engine.into(),
                "start".into(),
                "--attach".into(),
                "--interactive".into(),
                name.to_owned(),
            ],
            run.root,
            Some(&serde_json::to_string(&request)?),
            run.timeout,
            host_environment,
        )
    }
}

/// The revision's and the definition revision's paths, which bind mounts name.
fn paths<'a>(run: &ContainerRun<'a>) -> Result<(&'a str, &'a str)> {
    let root_text = run.root.to_str().context("NonUTF8 revision path")?;
    let program_text = run.program.to_str().context("NonUTF8 definition revision path")?;
    ensure!(
        !root_text.contains(',') && !program_text.contains(','),
        "Container revision paths must not contain a comma"
    );
    Ok((root_text, program_text))
}

/// The `create` command line: the sandbox, the mounts, the environment, the
/// image and the extractor's argv.
fn create_argv(
    engine: &str,
    image: &str,
    name: &str,
    run: &ContainerRun<'_>,
    (root_text, program_text): (&str, &str),
) -> Result<Vec<String>> {
    let ContainerRun {
        argv,
        root,
        program,
        project,
        request,
        environment,
        selected,
        python,
        node,
        ..
    } = *run;
    #[cfg(unix)]
    let user = format!("{}:{}", unsafe { libc::getuid() }, unsafe { libc::getgid() });
    #[cfg(not(unix))]
    let user = "65534:65534".to_owned();
    let mut create = vec![
        engine.to_owned(),
        "create".into(),
        "--interactive".into(),
        "--name".into(),
        name.to_owned(),
        "--pull".into(),
        "never".into(),
        "--network".into(),
        "none".into(),
        "--read-only".into(),
        "--cap-drop".into(),
        "ALL".into(),
        "--security-opt".into(),
        "no-new-privileges".into(),
        "--pids-limit".into(),
        "128".into(),
        "--memory".into(),
        "512m".into(),
        "--cpus".into(),
        "1".into(),
        "--user".into(),
        user,
        "--mount".into(),
        format!("type=bind,src={root_text},dst=/repository,readonly"),
        "--tmpfs".into(),
        "/tmp:rw,noexec,nosuid,size=64m,mode=1777".into(),
    ];
    // The generation store's snapshot, read-only at a fixed path.
    if let Some(snapshot) = request["generations"]["file"].as_str() {
        ensure!(!snapshot.contains(','), "The generation snapshot path must not contain a comma");
        create.extend([
            "--mount".into(),
            format!("type=bind,src={snapshot},dst=/generations.jsonl,readonly"),
        ]);
    }
    // The definition's revision supplies the extractor program when it
    // differs from the examined revision.
    let within = |mount: &str| {
        if project.is_empty() {
            mount.to_owned()
        } else {
            format!("{mount}/{project}")
        }
    };
    if program == root {
        create.extend(["--workdir".into(), within("/repository")]);
    } else {
        create.extend([
            "--mount".into(),
            format!("type=bind,src={program_text},dst=/definition,readonly"),
            "--workdir".into(),
            within("/definition"),
        ]);
    }
    let mut container_environment = environment.clone();
    container_environment.insert("HOME".into(), "/tmp".into());
    container_environment.insert("TMPDIR".into(), "/tmp".into());
    for key in ["PATH", "SystemRoot"] {
        if !selected.iter().any(|name| name == key) {
            container_environment.remove(key);
        }
    }
    // The `projections` Python module, read-only, first on the container's PYTHONPATH.
    if let Some(directory) = python.and_then(Path::to_str).filter(|directory| !directory.contains(',')) {
        create.extend([
            "--mount".into(),
            format!("type=bind,src={directory},dst={},readonly", crate::python::CONTAINER_DIRECTORY),
        ]);
        crate::python::prepend(&mut container_environment, crate::python::CONTAINER_DIRECTORY, ':');
    }
    // The Node extractor module, read-only, preloaded into a bare `node`.
    let mut argv = argv.to_vec();
    if let Some(directory) = node.and_then(Path::to_str).filter(|directory| !directory.contains(',')) {
        create.extend([
            "--mount".into(),
            format!("type=bind,src={directory},dst={},readonly", crate::node::CONTAINER_DIRECTORY),
        ]);
        argv = crate::node::preload(&argv, crate::node::CONTAINER_DIRECTORY, '/');
    }
    for (key, value) in container_environment {
        create.extend(["--env".into(), format!("{key}={value}")]);
    }
    create.push(image.into());
    create.extend(argv);
    Ok(create)
}

/// Removes the container; a container that is already gone is fine.
fn remove(
    acquisition: &Runner,
    engine: &str,
    name: String,
    root: &Path,
    host_environment: &BTreeMap<String, String>,
    outcome: &Result<ProcessOutput>,
) -> Result<()> {
    if let Err(cleanup) = acquisition.run_argv(
        &[engine.into(), "rm".into(), "--force".into(), name],
        root,
        None,
        30_000,
        host_environment,
    ) {
        let absent = cleanup.downcast_ref::<ProcessFailure>().is_some_and(|error| {
            regex::Regex::new("(?i)no such (container|object)")
                .expect("constant expression")
                .is_match(&String::from_utf8_lossy(&error.stderr))
        });
        if !absent {
            return Err(anyhow!(
                "Container cleanup failed; inspect local {engine}: {cleanup:#}; extraction outcome: {}",
                outcome
                    .as_ref()
                    .err()
                    .map(|error| format!("{error:#}"))
                    .unwrap_or_else(|| "completed".into())
            ));
        }
    }
    Ok(())
}
