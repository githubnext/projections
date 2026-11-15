//! Go toolchain support shared by the Go extractors.
//!
//! Runs the `helper/` Go module (or a compatible prebuilt helper) against the
//! project's packages with the project's own Go toolchain. The helper uses only
//! the Go standard library, so building it needs neither network access nor a
//! module cache. It loads and type-checks the matched packages once, then a
//! mode turns them into one JSON document; extractors choose the mode.

use anyhow::{Context as _, Result, bail, ensure};
use projections_extractor_sdk::{Context, Scratch, execute, input, parse_json, path, run, strings};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

/// Where installed distributions keep the helper source.
pub const HELPER_ASSET: &str = "helpers/go";

/// The oldest toolchain that builds the helper; matches `helper/go.mod`.
pub const MINIMUM_GO: (u64, u64) = (1, 24);

/// The toolchain requirement, as reported for `extractor`.
pub fn requirement(extractor: &str) -> String {
    format!(
        "`{extractor}` requires the repository's Go toolchain (`go` {}.{} or newer) on `PATH` or `inputs.goPath`",
        MINIMUM_GO.0, MINIMUM_GO.1
    )
}

/// `inputs.patterns`: Go package patterns, default `["./..."]`, never flags.
pub fn patterns(definition: &Value) -> Result<Vec<String>> {
    let patterns = match definition["inputs"].get("patterns") {
        Some(v) => strings(v, "inputs.patterns")?,
        None => vec!["./...".into()],
    };
    ensure!(
        !patterns.is_empty() && !patterns.iter().any(|p| p.starts_with('-')),
        "inputs.patterns must contain Go package patterns, not command flags"
    );
    Ok(patterns)
}

/// Runs the helper's `mode` over `patterns` in `root` and returns its parsed
/// JSON output.
///
/// With `inputs.goHelperPath` the prebuilt helper runs directly. Otherwise the
/// shipped helper source runs with `go run` using the repository's Go
/// (`inputs.goPath`, default `go`), which must be at least [`MINIMUM_GO`]; Go
/// uses the user's own module and build caches, a private `GOPATH` and
/// `GOTOOLCHAIN=local`, plus any `GOCACHE`, `GOPATH`, `GOMODCACHE`,
/// `GOTOOLCHAIN` and `GOFLAGS` granted through `execution.environment`.
pub fn run_helper(cx: &Context, mode: &str, patterns: Vec<String>) -> Result<Value> {
    cx.require_trust()?;
    let (root, d) = (cx.root(), cx.definition());
    let extractor = cx.extractor();
    let requirement = requirement(extractor);
    let mut args = vec![mode.to_owned(), "-dir".into(), root.to_string_lossy().into_owned()];
    args.extend(patterns);
    if d["inputs"].get("goHelperPath").is_some() {
        let executable = input(d, "goHelperPath", None)?;
        let mut argv = vec![executable.to_owned()];
        argv.extend(args);
        return run(cx, root, argv, None, BTreeMap::new());
    }
    let helper = cx.helper(HELPER_ASSET, Path::new(env!("CARGO_MANIFEST_DIR")).join("helper"))?;
    ensure!(
        helper.join("go.mod").is_file() && helper.join("main.go").is_file(),
        "`{extractor}` requires the installed native Go helper assets (`go.mod` and `main.go`)"
    );
    let scratch = Scratch::new(root, "go")?;
    let executable = input(d, "goPath", Some("go"))?;
    let executable = if executable.contains(['/', '\\']) && !Path::new(executable).is_absolute() {
        path(root, executable, false, false)?.to_string_lossy().into_owned()
    } else {
        executable.to_owned()
    };
    let mut env = go_environment(d, cx, &scratch.0, &executable)?;
    let output = execute(
        cx,
        &helper,
        vec![executable.clone(), "env".into(), "GOVERSION".into()],
        None,
        env.clone(),
        true,
    )
    .context(requirement.clone())?;
    if go_version(&output).is_some_and(|found| found < MINIMUM_GO) {
        bail!("{requirement}; found {}", output.trim());
    }
    if !env.contains_key("GOMODCACHE") {
        let cache = user_setting(cx, &helper, &executable, &env, "GOMODCACHE")?;
        ensure!(
            cache.is_some(),
            "Cannot determine the Go module cache from `go env GOMODCACHE`. \
             Set GOMODCACHE (or HOME/GOPATH) and grant it through execution.environment"
        );
        env.insert("GOMODCACHE".into(), cache.unwrap());
    }
    if !env.contains_key("GOCACHE") {
        // The build cache only speeds builds up, so a private one is a safe fallback.
        let cache = user_setting(cx, &helper, &executable, &env, "GOCACHE")?
            .unwrap_or_else(|| scratch.0.join("cache").to_string_lossy().into_owned());
        env.insert("GOCACHE".into(), cache);
    }
    // The helper has no module requirements, so it builds without the module
    // cache or network whatever the project's GOFLAGS say; the flag stays on
    // the command line so GOFLAGS for the project's own `go list` is untouched.
    let mut argv = vec![executable, "run".into(), "-mod=mod".into(), ".".into()];
    argv.extend(args);
    run_go(cx, &helper, argv, env)
}

/// Variables that locate the user's own Go configuration (`go env -w` settings)
/// and default caches.
const GO_CONFIGURATION: [&str; 11] = [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "home",
    "GOENV",
    "GOPATH",
    "GOMODCACHE",
    "GOCACHE",
];

/// The [`GO_CONFIGURATION`] variables that only locate the user's configuration;
/// the rest are caches and `GOPATH`, which [`go_environment`] decides.
const USER_CONFIGURATION: &[&str] = GO_CONFIGURATION.split_at(8).0;

/// Runs the helper with the base environment, `env` and the definition's grants
/// except those that only locate the user's Go configuration: they serve
/// [`user_setting`], and the build never reads the user's `go env -w` settings.
fn run_go(cx: &Context, helper: &Path, argv: Vec<String>, env: BTreeMap<String, String>) -> Result<Value> {
    let granted: Vec<String> = cx
        .granted()?
        .into_iter()
        .filter(|name| !USER_CONFIGURATION.contains(&name.as_str()))
        .collect();
    let mut environment = cx.environment(&granted);
    environment.extend(env);
    let output = cx.run(helper, &argv, None, &environment).with_context(|| {
        format!(
            "Extractor tool {} failed; install the selected ecosystem's required tool explicitly",
            argv[0]
        )
    })?;
    parse_json(&output.stdout).context("Extractor tool did not produce valid JSON")
}

/// A cache directory the user's own Go configuration selects, such as
/// `GOMODCACHE` or `GOCACHE`, so dependencies already downloaded and packages
/// already built are reused: what `go env <name>` reports, or `None` when it
/// reports no absolute directory (for example `GOCACHE=off`).
fn user_setting(cx: &Context, helper: &Path, executable: &str, env: &BTreeMap<String, String>, name: &str) -> Result<Option<String>> {
    let mut query = env.clone();
    query.remove("GOPATH");
    query.extend(cx.environment(&GO_CONFIGURATION.map(String::from)));
    let output = execute(
        cx,
        helper,
        vec![executable.to_owned(), "env".into(), name.into()],
        None,
        query,
        true,
    )?;
    let value = output.trim();
    Ok((!value.is_empty() && Path::new(value).is_absolute()).then(|| value.to_owned()))
}

/// A private GOPATH, the user's module and build caches (resolved later unless
/// granted), `GOTOOLCHAIN=local` so Go never downloads another toolchain,
/// and any of GOCACHE, GOPATH, GOMODCACHE, GOTOOLCHAIN and GOFLAGS the definition
/// grants through `execution.environment`.
fn go_environment(d: &Value, cx: &Context, scratch: &Path, executable: &str) -> Result<BTreeMap<String, String>> {
    let mut env = BTreeMap::from([
        ("GOPATH".into(), scratch.join("gopath").to_string_lossy().into_owned()),
        ("GOTOOLCHAIN".into(), "local".into()),
    ]);
    let names = d["execution"]
        .get("environment")
        .map(|v| strings(v, "execution.environment"))
        .transpose()?
        .unwrap_or_default();
    let granted = cx.environment(&names);
    for name in ["GOCACHE", "GOPATH", "GOMODCACHE", "GOTOOLCHAIN"] {
        if let Some(value) = granted.get(name) {
            env.insert(name.into(), value.clone());
        }
    }
    if let Some(flags) = granted.get("GOFLAGS") {
        env.insert("GOFLAGS".into(), flags.clone());
    }
    if Path::new(executable).is_absolute() {
        let path = cx.environment(&[]).get("PATH").cloned().unwrap_or_default();
        let delimiter = if cfg!(windows) { ';' } else { ':' };
        env.insert(
            "PATH".into(),
            format!("{}{delimiter}{path}", Path::new(executable).parent().unwrap().display()),
        );
    }
    Ok(env)
}

/// Major and minor version from `go env GOVERSION` (`go1.24.3`, `go1.25rc1`,
/// `devel go1.26-abcdef ...`); `None` when unrecognized.
fn go_version(output: &str) -> Option<(u64, u64)> {
    let version = output.trim().trim_start_matches("devel ").strip_prefix("go")?;
    let mut parts = version.splitn(3, '.');
    let major = parts.next()?.parse().ok()?;
    let minor: String = parts.next()?.chars().take_while(char::is_ascii_digit).collect();
    Some((major, minor.parse().ok()?))
}

#[cfg(test)]
mod tests {
    /// An absolute home directory on this platform.
    const FAKE_HOME: &str = if cfg!(windows) { r"C:\home\dev" } else { "/home/dev" };

    /// An absolute path to a fake `go` on this platform.
    const FAKE_GO: &str = if cfg!(windows) {
        r"C:\go\bin\go.exe"
    } else {
        "/usr/local/go/bin/go"
    };

    use super::*;
    use projections_extractor_sdk::{Output, testing};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    fn helper() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("helper")
    }

    #[test]
    fn helper_uses_only_the_standard_library() {
        let go_mod = fs::read_to_string(helper().join("go.mod")).unwrap();
        let directive = go_mod.lines().find_map(|line| line.strip_prefix("go ")).unwrap();
        assert_eq!(go_version(&format!("go{directive}")), Some(MINIMUM_GO));
        assert!(!go_mod.contains("require"), "{go_mod}");
        assert!(!helper().join("go.sum").exists());
        assert!(!helper().join("vendor").exists());
        let mut sources = 0;
        for entry in fs::read_dir(helper()).unwrap() {
            let file = entry.unwrap().path();
            if file.extension().is_none_or(|extension| extension != "go") {
                continue;
            }
            sources += 1;
            let source = fs::read_to_string(&file).unwrap();
            let imports = source.split_once("import (").unwrap().1.split_once(')').unwrap().0;
            for import in imports.split_whitespace() {
                let path = import.trim_matches('"');
                assert!(
                    !path.split('/').next().unwrap().contains('.'),
                    "{path} in {} is not a standard library package",
                    file.display()
                );
            }
        }
        assert!(sources >= 2);
    }

    #[test]
    fn patterns_default_to_every_package_and_reject_flags() {
        assert_eq!(patterns(&json!({"inputs":{}})).unwrap(), ["./..."]);
        assert_eq!(patterns(&json!({"inputs":{"patterns":["./api/..."]}})).unwrap(), ["./api/..."]);
        for bad in [json!([]), json!(["-toolexec=x"])] {
            assert!(patterns(&json!({"inputs":{"patterns":bad}})).is_err());
        }
    }

    #[test]
    fn go_versions_parse_major_and_minor() {
        assert_eq!(go_version("go1.24.0\n"), Some((1, 24)));
        assert_eq!(go_version("go1.25rc1"), Some((1, 25)));
        assert_eq!(go_version("go1.21"), Some((1, 21)));
        assert_eq!(go_version("devel go1.27-abcdef Tue"), Some((1, 27)));
        assert_eq!(go_version("unknown"), None);
    }

    type Run = (Vec<String>, BTreeMap<String, String>);

    struct Fake {
        version: Option<&'static str>,
        granted: BTreeMap<String, String>,
        runs: Arc<Mutex<Vec<Run>>>,
    }

    impl Fake {
        /// A trusted context whose environment is the granted variables and whose
        /// `go` answers from the fake toolchain.
        fn context(&self, root: &Path, definition: Value) -> Context {
            let (version, runs) = (self.version, self.runs.clone());
            testing::trusted(root, definition)
                .with_environment(self.granted.clone())
                .with_tools(move |call| {
                    let (argv, environment) = (call.argv, call.environment);
                    runs.lock().unwrap().push((argv.to_vec(), environment.clone()));
                    let version = version.with_context(|| format!("No such file: {}", argv[0]))?;
                    let stdout = if argv[1..] == ["env", "GOVERSION"] {
                        format!("{version}\n")
                    } else if argv[1..] == ["env", "GOMODCACHE"] {
                        match environment.get("HOME") {
                            Some(home) => format!("{home}/go/pkg/mod\n"),
                            None => "\n".into(),
                        }
                    } else if argv[1..] == ["env", "GOCACHE"] {
                        match environment.get("HOME") {
                            Some(home) => format!("{home}/.cache/go-build\n"),
                            None => "off\n".into(),
                        }
                    } else {
                        r#"{"packages":[]}"#.into()
                    };
                    Ok(Output {
                        stdout,
                        stderr: String::new(),
                    })
                })
        }
    }

    fn scratch() -> PathBuf {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../target/go-support-unit-tests")
            .join(format!(
                "{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            ));
        fs::create_dir_all(&root).unwrap();
        // As the context resolves it: without the `\\?\` prefix Windows' canonicalize adds.
        projections_extractor_sdk::canonical(&root).unwrap()
    }

    fn collect_with(fake: &Fake, environment: &[&str]) -> Result<Value> {
        let root = scratch();
        let definition = json!({"id":"go","extractor":"go-example","inputs":{"goPath":FAKE_GO},
            "execution":{"environment":environment}});
        let result = run_helper(&fake.context(&root, definition), "packages", vec!["./...".into()]);
        fs::remove_dir_all(&root).unwrap();
        result
    }

    fn fake(version: Option<&'static str>, granted: &[(&str, &str)]) -> Fake {
        Fake {
            version,
            granted: granted.iter().map(|(name, value)| (name.to_string(), value.to_string())).collect(),
            runs: Arc::default(),
        }
    }

    #[test]
    fn missing_or_old_go_reports_the_toolchain_requirement() {
        for version in [None, Some("go1.23.9")] {
            let go = fake(version, &[]);
            let error = format!("{:#}", collect_with(&go, &[]).unwrap_err());
            assert!(error.contains(&requirement("go-example")), "{error}");
            assert_eq!(go.runs.lock().unwrap().len(), 1);
        }
    }

    #[test]
    fn helper_runs_with_local_toolchain_and_the_users_caches() {
        let go = fake(Some("go1.24.0"), &[("HOME", FAKE_HOME)]);
        collect_with(&go, &["HOME"]).unwrap();
        let runs = go.runs.lock().unwrap();
        for (index, name) in [(1, "GOMODCACHE"), (2, "GOCACHE")] {
            let (query, query_env) = &runs[index];
            assert_eq!(query[1..], ["env", name]);
            assert_eq!(query_env["HOME"], FAKE_HOME);
            assert!(!query_env.contains_key("GOPATH"));
        }
        let (argv, env) = &runs[3];
        assert_eq!(argv[1..5], ["run", "-mod=mod", ".", "packages"]);
        assert_eq!(argv[5], "-dir");
        assert_eq!(argv[7], "./...");
        assert_eq!(env["GOTOOLCHAIN"], "local");
        assert_eq!(env["GOMODCACHE"], format!("{FAKE_HOME}/go/pkg/mod"));
        assert_eq!(env["GOCACHE"], format!("{FAKE_HOME}/.cache/go-build"));
        assert!(env["GOPATH"].contains(".projections-go-"));
        assert!(!env.contains_key("GOFLAGS"));
        assert!(!env.contains_key("HOME"));
        assert!(env["PATH"].starts_with(Path::new(FAKE_GO).parent().unwrap().to_str().unwrap()));
        assert!(!env.contains_key("GOPROXY"));
        drop(runs);

        let go = fake(Some("go1.24.0"), &[]);
        let error = format!("{:#}", collect_with(&go, &[]).unwrap_err());
        assert!(error.contains("Cannot determine the Go module cache"), "{error}");

        // A granted module cache needs no query; a build cache Go reports as off
        // falls back to a private one.
        let granted = [
            ("GOMODCACHE", "/ci/modules"),
            ("GOTOOLCHAIN", "auto"),
            ("GOFLAGS", "-mod=mod"),
            ("GOPROXY", "off"),
        ];
        let go = fake(Some("go1.27.1"), &granted);
        collect_with(&go, &granted.map(|(name, _)| name)).unwrap();
        let runs = go.runs.lock().unwrap();
        assert_eq!(runs.len(), 3);
        assert_eq!(runs[1].0[1..], ["env", "GOCACHE"]);
        let (_, env) = &runs[2];
        assert_eq!(env["GOMODCACHE"], "/ci/modules");
        assert_eq!(env["GOTOOLCHAIN"], "auto");
        assert_eq!(env["GOFLAGS"], "-mod=mod");
        assert_eq!(env["GOPROXY"], "off");
        assert!(env["GOCACHE"].contains(".projections-go-"));
        drop(runs);

        let granted = [("GOMODCACHE", "/ci/modules"), ("GOCACHE", "/ci/build")];
        let go = fake(Some("go1.27.1"), &granted);
        collect_with(&go, &granted.map(|(name, _)| name)).unwrap();
        let runs = go.runs.lock().unwrap();
        assert_eq!(runs.len(), 2, "granted caches need no query");
        assert_eq!(runs[1].1["GOCACHE"], "/ci/build");
    }

    #[test]
    fn a_prebuilt_helper_runs_directly_with_the_mode() {
        let go = fake(Some("go1.24.0"), &[]);
        let definition = json!({"id":"go","extractor":"go-example","inputs":{"goHelperPath":"/opt/go-helper"}});
        let root = scratch();
        let output = run_helper(&go.context(&root, definition), "packages", vec!["./api/...".into()]).unwrap();
        assert_eq!(output, json!({"packages":[]}));
        let runs = go.runs.lock().unwrap();
        assert_eq!(runs.len(), 1, "no toolchain checks for a prebuilt helper");
        assert_eq!(
            runs[0].0,
            ["/opt/go-helper", "packages", "-dir", root.to_str().unwrap(), "./api/..."]
        );
    }
}
