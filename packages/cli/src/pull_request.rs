use crate::{
    artifact,
    runtime::{DefinitionSource, Runner},
};
use anyhow::{Context, Result, ensure};
use regex::Regex;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

pub fn review(repository: &str, number: u64, host: &str, cache: Option<&Path>, ids: &[String], cancel: Arc<AtomicBool>) -> Result<Value> {
    ensure!(
        Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}/[a-zA-Z0-9._-]{1,100}$")?.is_match(repository)
            && ![".", ".."].contains(&repository.split('/').nth(1).unwrap_or(""))
            && number > 0
            && number <= 9_007_199_254_740_991,
        "PR requires owner/name and positive number"
    );
    ensure!(
        host.len() <= 253 && Regex::new(r"^[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)+$")?.is_match(host),
        "Invalid GitHub host"
    );
    let parent = projections_extractor_sdk::canonical(cache.unwrap_or(&std::env::temp_dir()))?;
    let temporary = tempfile::Builder::new().prefix("projections-pr-").tempdir_in(&parent)?;
    let mut acquisition = Runner::new(parent.clone(), false);
    acquisition.cancel = cancel;
    let mut environment = acquisition.environment(&[])?;
    for name in [
        "HOME",
        "GH_CONFIG_DIR",
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "GH_ENTERPRISE_TOKEN",
        "GITHUB_ENTERPRISE_TOKEN",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "NO_PROXY",
        "GIT_EXEC_PATH",
    ] {
        if let Ok(value) = std::env::var(name) {
            environment.insert(name.into(), value);
        }
    }
    for (key, value) in [
        ("GIT_CONFIG_NOSYSTEM", "1"),
        ("GIT_CONFIG_GLOBAL", "/dev/null"),
        ("GIT_TERMINAL_PROMPT", "0"),
        ("GIT_NO_REPLACE_OBJECTS", "1"),
    ] {
        environment.insert(key.into(), value.into());
    }
    // Initialize before monitoring: `git init` briefly creates a probe symlink to test
    // filesystem support, which the cache monitor would otherwise reject as unsafe.
    Runner::new(temporary.path().to_owned(), false).git_text(
        &parent,
        &[
            "init",
            "--bare",
            "--template=",
            "--quiet",
            temporary.path().to_str().context("NonUTF8 cache")?,
        ],
    )?;
    cache_size(temporary.path())?;
    let active = Arc::new(AtomicBool::new(true));
    let monitor_active = active.clone();
    let cancel = acquisition.cancel.clone();
    let reason = Arc::new(Mutex::new(None::<String>));
    let monitor_reason = reason.clone();
    let monitored = temporary.path().to_owned();
    let monitor = thread::spawn(move || {
        let start = std::time::Instant::now();
        while monitor_active.load(Ordering::SeqCst) {
            let failure = if start.elapsed() > Duration::from_secs(60) {
                Some("PR acquisition timed out after60000ms".to_owned())
            } else {
                cache_size(&monitored).err().map(|error| format!("{error:#}"))
            };
            if let Some(failure) = failure {
                *monitor_reason.lock().expect("PR monitor lock") = Some(failure);
                cancel.store(true, Ordering::SeqCst);
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    });
    let result = (|| -> Result<Value> {
        let endpoint = format!("repos/{repository}/pulls/{number}");
        let metadata = artifact::parse(&invoke(
            &acquisition,
            &["gh", "api", "--hostname", host, &endpoint],
            &parent,
            &environment,
            None,
        )?)?;
        let expected = format!("https://{host}/{repository}/pull/{number}");
        ensure!(
            metadata["html_url"].as_str().is_some_and(|url| url.eq_ignore_ascii_case(&expected))
                && metadata["base"]["repo"]["full_name"]
                    .as_str()
                    .is_some_and(|name| name.eq_ignore_ascii_case(repository)),
            "PR metadata differs from requested target"
        );
        let base = metadata["base"]["sha"].as_str().context("Missing base SHA")?;
        let head = metadata["head"]["sha"].as_str().context("Missing head SHA")?;
        let sha = Regex::new(r"^(?:[a-f0-9]{40}|[a-f0-9]{64})$")?;
        ensure!(sha.is_match(base) && sha.is_match(head), "PR requires immutable commits");
        ensure!(
            metadata["base"]["repo"]["id"].as_u64().is_some() && metadata["head"]["repo"]["id"].as_u64().is_some(),
            "PR requires immutable repository identities"
        );
        let mut runner = Runner::new(temporary.path().to_owned(), false);
        runner.cancel = acquisition.cancel.clone();
        let remote = format!("https://{host}/{repository}.git");
        let base_ref = format!("{base}:refs/projections/base");
        let head_ref = format!("{head}:refs/projections/head");
        invoke(
            &acquisition,
            &[
                "git",
                "--no-pager",
                "--git-dir",
                temporary.path().to_str().unwrap(),
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "credential.helper=",
                "-c",
                "credential.helper=!gh auth git-credential",
                "-c",
                "protocol.file.allow=never",
                "-c",
                "protocol.ext.allow=never",
                "-c",
                "fetch.fsckObjects=true",
                "fetch",
                "--no-tags",
                "--no-recurse-submodules",
                "--no-write-fetch-head",
                "--no-auto-maintenance",
                &remote,
                &base_ref,
                &head_ref,
            ],
            temporary.path(),
            &environment,
            None,
        )?;
        cache_size(temporary.path())?;
        ensure!(
            runner.resolve(temporary.path(), "refs/projections/base")? == base
                && runner.resolve(temporary.path(), "refs/projections/head")? == head,
            "Fetched PR commits differ from immutable metadata"
        );
        let merge_base = runner.git_text(temporary.path(), &["merge-base", base, head])?;
        ensure!(sha.is_match(&merge_base), "Invalid merge base");
        active.store(false, Ordering::SeqCst);
        let comparisons = runner.compare_all(&merge_base, head, ids, DefinitionSource::Base)?;
        // Projections whose definition or component code the PR changes are
        // called out; the comparison still uses the reviewed base definition.
        let changed: Vec<Value> = comparisons["results"]
            .as_array()
            .context("Invalid comparison batch")?
            .iter()
            .filter(|item| item["notices"].as_array().is_some_and(|notices| !notices.is_empty()))
            .map(|item| json!({"id": item["id"], "notices": item["notices"]}))
            .collect();
        let review = json!({"format":"projections.pull-request","version":0,"repository":repository,"number":number,"url":expected,
            "base":base,"head":head,"mergeBase":merge_base,"fork":metadata["base"]["repo"]["id"]!=metadata["head"]["repo"]["id"],
            "execution":"untrusted","definition":"base","changedProjections":changed,"comparisons":comparisons});
        Ok(review)
    })();
    active.store(false, Ordering::SeqCst);
    monitor.join().map_err(|_| anyhow::anyhow!("PR cache monitor panicked"))?;
    if let Err(cleanup) = temporary.close() {
        return Err(anyhow::anyhow!(
            "PR cache cleanup failed: {cleanup}; acquisition result: {}",
            result
                .as_ref()
                .err()
                .map(|error| format!("{error:#}"))
                .unwrap_or_else(|| "completed".into())
        ));
    }
    if let Some(reason) = reason.lock().expect("PR monitor lock").as_ref() {
        return Err(result
            .err()
            .unwrap_or_else(|| anyhow::anyhow!("PR acquisition was aborted"))
            .context(reason.clone()));
    }
    result
}

fn invoke(runner: &Runner, argv: &[&str], root: &Path, environment: &BTreeMap<String, String>, input: Option<&str>) -> Result<String> {
    let output = runner
        .run_argv(
            &argv.iter().map(|part| (*part).to_owned()).collect::<Vec<_>>(),
            root,
            input,
            30_000,
            environment,
        )?
        .stdout;
    ensure!(output.len() <= 1024 * 1024, "PR acquisition stdout exceeds1MiB");
    Ok(output)
}

fn cache_size(root: &Path) -> Result<()> {
    fn visit(root: &Path, count: &mut usize, bytes: &mut u64) -> Result<()> {
        for entry in fs::read_dir(root)? {
            let entry = entry?;
            *count += 1;
            ensure!(*count <= 50_000, "PR cache exceeds50000entries");
            let metadata = match fs::symlink_metadata(entry.path()) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            ensure!(
                !metadata.is_symlink() && (metadata.is_dir() || metadata.is_file()),
                "Unsafe PR cache entry {} ({:?})",
                entry.path().display(),
                metadata.file_type()
            );
            *bytes += metadata.len();
            ensure!(*bytes <= 256 * 1024 * 1024, "PR cache exceeds256MiB");
            if metadata.is_dir() {
                visit(&entry.path(), count, bytes)?;
            }
        }
        Ok(())
    }
    visit(root, &mut 0, &mut 0)
}
