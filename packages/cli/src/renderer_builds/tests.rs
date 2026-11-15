use super::*;

fn state(phase: Phase) -> BuildState {
    BuildState {
        phase,
        ..BuildState::default()
    }
}

#[test]
fn output_lines_say_how_the_build_went() {
    let start = state(Phase::Built);
    assert_eq!(read_build_line("build started...", &start).phase, Phase::Building);
    assert_eq!(
        read_build_line("\x1b[32m✓ built in 120ms\x1b[0m", &state(Phase::Building)).phase,
        Phase::Built
    );
    let failed = read_build_line("/r/src/view.tsx:166:10: ERROR: Unexpected \";\"", &state(Phase::Building));
    assert_eq!(failed.phase, Phase::Failed);
    assert_eq!(failed.error.as_deref(), Some("view.tsx:166:10: Unexpected \";\""));
    assert!(failed.located);
    // The first located error stays; a finished build that failed still failed.
    let later = read_build_line("/r/src/other.tsx:1:1: ERROR: Later", &failed);
    assert_eq!(later.error, failed.error);
    assert_eq!(read_build_line("built in 9ms", &failed).phase, Phase::Failed);
    let typed = read_build_line("src/a.ts(3,1): error TS2304: Cannot find name 'x'.", &state(Phase::Building));
    assert_eq!(typed.phase, Phase::Failed);
    assert_eq!(read_build_line("  ", &start), start);
}

#[test]
fn vites_watch_output_builds_fails_with_its_first_error_and_builds_again() {
    let lines = |state: &BuildState, items: &[&str]| items.iter().fold(state.clone(), |current, line| read_build_line(line, &current));
    let start = BuildState {
        phase: Phase::Building,
        script: Some("watch".into()),
        package: Some("cards".into()),
        ..BuildState::default()
    };
    let built = BuildState {
        phase: Phase::Built,
        ..start.clone()
    };
    assert_eq!(
        lines(&start, &["vite v7.1.0 building for production...", "watching for file changes..."]).phase,
        Phase::Building
    );
    assert_eq!(
        lines(
            &start,
            &["\x1b[36mbuild started...\x1b[39m", "✓ 12 modules transformed.", "built in 412ms."]
        ),
        built
    );
    // Vite 7's output for a syntax error: the header, then esbuild's located error, which names the file.
    let failed = lines(
        &built,
        &[
            "build started...",
            "[commonjs] Transform failed with 1 error:",
            "/repo/cards/src/view.tsx:166:10: ERROR: Unexpected \";\"",
            "file: /repo/cards/src/view.tsx:166:10",
        ],
    );
    assert_eq!(failed.error.as_deref(), Some("view.tsx:166:10: Unexpected \";\""));
    let header = lines(&start, &["[vite]: Rollup failed to resolve import \"x\" from \"src/main.tsx\"."]);
    assert_eq!(
        header.error.as_deref(),
        Some("[vite]: Rollup failed to resolve import \"x\" from \"src/main.tsx\".")
    );
    assert_eq!(lines(&failed, &["build started..."]), start);
    assert_eq!(lines(&failed, &["build started...", "built in 98ms."]), built);
}

#[test]
fn a_dist_bundle_names_its_package_and_sources() {
    let scaffold = json!({"renderer": {"bundle": ".github/projections/map/renderer/dist"}});
    assert_eq!(renderer_package(&scaffold).as_deref(), Some(".github/projections/map/renderer"));
    assert_eq!(renderer_sources(&scaffold), [".github/projections/map/renderer/src"]);
    let declared = json!({"renderer": {"bundle": "./dist/", "sources": ["ui", "../x"]}});
    assert_eq!(renderer_package(&declared).as_deref(), Some("."));
    assert_eq!(renderer_sources(&declared), ["ui"]);
    assert_eq!(renderer_package(&json!({"renderer": "graph"})), None);
    assert_eq!(renderer_package(&json!({"renderer": {"bundle": "out"}})), None);
    assert_eq!(
        build_script(&json!({"build": "vite build", "watch": "vite build --watch"})),
        Some(("watch", true))
    );
    assert_eq!(build_script(&json!({"build": "vite build"})), Some(("build", false)));
    assert_eq!(build_script(&Value::Null), None);
}

#[test]
fn without_trust_nothing_runs() {
    let root = tempfile::tempdir().unwrap();
    let package = root.path().join("r");
    std::fs::create_dir_all(package.join("src")).unwrap();
    std::fs::write(package.join("package.json"), r#"{"scripts": {"watch": "exit 1"}}"#).unwrap();
    std::fs::write(package.join("src/a.ts"), "x").unwrap();
    let builds = RendererBuilds::new(root.path().to_path_buf(), false);
    let definition = json!({"renderer": {"bundle": "r/dist"}});
    builds.event("map", &definition, "opened").unwrap();
    let state = builds.state("map").unwrap();
    assert_eq!((state.phase, state.script.as_deref()), (Phase::Untrusted, Some("watch")));
    assert_eq!(builds.snapshot(0)["builds"][0]["running"], false);
    builds.event("map", &definition, "closed").unwrap();
    assert_eq!(builds.state("map"), None);
    assert!(builds.event("map", &definition, "sideways").is_err());
}

#[test]
fn a_changed_event_builds_only_when_the_sources_changed() {
    let root = tempfile::tempdir().unwrap();
    let package = root.path().join("r");
    std::fs::create_dir_all(package.join("src")).unwrap();
    std::fs::create_dir_all(package.join("dist")).unwrap();
    std::fs::write(package.join("package.json"), r#"{"scripts": {"build": "exit 0"}}"#).unwrap();
    std::fs::write(package.join("src/a.ts"), "x").unwrap();
    std::fs::write(package.join("dist/index.html"), "built").unwrap();
    let builds = RendererBuilds::new(root.path().to_path_buf(), false);
    let definition = json!({"renderer": {"bundle": "r/dist"}});
    // The bundle is newer than its sources: opening doesn't build, and an unrelated change doesn't either.
    builds.event("map", &definition, "opened").unwrap();
    assert_eq!(builds.state("map"), None);
    builds.event("map", &definition, "changed").unwrap();
    assert_eq!(builds.state("map"), None);
    std::fs::write(package.join("src/b.ts"), "y").unwrap();
    builds.event("map", &definition, "changed").unwrap();
    assert_eq!(builds.state("map").map(|state| state.phase), Some(Phase::Untrusted));
}

fn wait_for(builds: &RendererBuilds, done: impl Fn(&Value) -> bool) -> Value {
    for _ in 0..600 {
        let snapshot = builds.snapshot(0);
        if done(&snapshot["builds"][0]) {
            return snapshot["builds"][0].clone();
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    panic!("the build never finished: {}", builds.snapshot(0));
}

#[test]
fn with_trust_its_script_runs_and_its_output_says_how_it_went() {
    let root = tempfile::tempdir().unwrap();
    let package = root.path().join("r");
    std::fs::create_dir_all(package.join("node_modules")).unwrap();
    let script = |script: &str| {
        std::fs::write(package.join("package.json"), json!({"scripts": {"build": script}}).to_string()).unwrap();
    };
    script("node -e \"console.log('built in 5ms')\"");
    let builds = RendererBuilds::new(root.path().to_path_buf(), true);
    let definition = json!({"renderer": {"bundle": "r/dist"}});
    builds.event("map", &definition, "saved").unwrap();
    let done = wait_for(&builds, |build| build["exit"].is_number());
    assert_eq!((done["phase"].as_str(), done["exit"].as_i64()), (Some("built"), Some(0)), "{done}");
    assert!(
        done["lines"].as_array().unwrap().iter().any(|line| line == "built in 5ms"),
        "{done}"
    );
    // A failing build: its located error, and the run after it.
    script("node -e \"console.error('/r/src/a.ts:1:2: ERROR: Nope'); process.exit(1)\"");
    builds.event("map", &definition, "saved").unwrap();
    let failed = wait_for(&builds, |build| build["run"] == 2 && build["exit"].is_number());
    assert_eq!(failed["phase"], "failed");
    assert_eq!(failed["error"], "a.ts:1:2: Nope");
    builds.stop_all();
    assert_eq!(builds.snapshot(0)["builds"], json!([]));
}
