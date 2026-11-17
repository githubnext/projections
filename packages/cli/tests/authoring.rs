//! The authoring loop: `projections init` scaffolds a projection, or parts of
//! one, and the skill an agent follows to build it.

use serde_json::{Value, json};
use std::{
    fs,
    path::Path,
    process::{Command, Output},
};

fn git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false"])
        .args(args)
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

fn repository(manifest: Option<&str>) -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "--template=", "--quiet"]);
    git(root.path(), &["config", "user.name", "Authoring fixture"]);
    git(root.path(), &["config", "user.email", "authoring@example.invalid"]);
    if let Some(manifest) = manifest {
        fs::write(root.path().join(manifest), "{}\n").unwrap();
    }
    fs::create_dir_all(root.path().join("services/payments")).unwrap();
    fs::write(root.path().join("services/payments/app.yaml"), "name: x\n").unwrap();
    root
}

fn cli(cwd: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_projections"))
        .args(args)
        .current_dir(cwd)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .unwrap()
}

fn succeed(output: Output) -> String {
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn fail(output: Output) -> String {
    assert!(!output.status.success());
    String::from_utf8(output.stderr).unwrap()
}

#[test]
fn init_scaffolds_an_extractor_with_a_built_in_renderer_that_runs_from_a_subdirectory() {
    let repo = repository(Some("package.json"));
    let root = repo.path();
    let error = fail(cli(root, &["list"]));
    assert!(error.contains("no commits yet"), "{error}");
    git(root, &["commit", "--quiet", "--allow-empty", "-m", "Start"]);
    let report = succeed(cli(&root.join("services"), &["init", "service-map"]));
    for path in [
        ".github/projections/service-map.json",
        ".github/projections/service-map/extract.mjs",
        ".agents/skills/projections/SKILL.md",
    ] {
        assert!(root.join(path).is_file(), "{path} was not created");
        assert!(report.contains(path), "{report}");
    }
    assert!(
        report.contains("read by GitHub Copilot, OpenAI Codex, Cursor and Gemini CLI"),
        "{report}"
    );
    assert!(report.contains("projections show -p service-map --trust"));
    assert!(report.contains("Ask your coding agent"));
    assert!(!root.join("AGENTS.md").exists(), "only the skill is written");
    assert!(!root.join(".github/projections/service-map/renderer").exists());
    let definition = read(root, ".github/projections/service-map.json");
    assert_eq!(definition["title"], "Service map");
    assert_eq!(definition["renderer"], "graph");
    assert!(definition.get("comparator").is_none());
    assert_eq!(
        definition["extractor"]["command"],
        serde_json::json!(["node", ".github/projections/service-map/extract.mjs"])
    );

    // The starter runs as is, from any directory in the checkout.
    let shown = succeed(cli(&root.join("services/payments"), &["show", "-p", "service-map", "--trust"]));
    assert!(shown.contains("services [directory:services]"), "{shown}");
    let saved: Value = serde_json::from_str(&succeed(cli(root, &["show", "-p", "service-map", "--trust", "--json"]))).unwrap();
    assert_eq!(saved["extraction"]["entities"][0]["data"]["files"], serde_json::json!(1));
}

fn read(root: &Path, path: &str) -> Value {
    serde_json::from_slice(&fs::read(root.join(path)).unwrap()).unwrap()
}

#[test]
fn init_adds_a_custom_renderer_and_comparator_to_an_existing_projection() {
    let repo = repository(Some("pyproject.toml"));
    let root = repo.path();
    git(root, &["commit", "--quiet", "--allow-empty", "-m", "Start"]);
    succeed(cli(root, &["init", "flags", "--title", "Feature flags: Bob's \"best\""]));
    assert!(
        root.join(".github/projections/flags/extract.py").is_file(),
        "pyproject.toml selects Python"
    );
    let error = fail(cli(root, &["init", "flags"]));
    assert!(error.contains("already exists"), "{error}");

    let report = succeed(cli(root, &["init", "flags", "--renderer", "custom", "--comparator", "custom"]));
    assert!(report.contains("Updated:\n  .github/projections/flags.json"), "{report}");
    assert!(report.contains("npm install && npm run watch"), "{report}");
    assert!(report.contains("Projections: Open Renderer Scenarios…"), "{report}");
    for path in [
        "package.json",
        "vite.config.ts",
        "tsconfig.json",
        ".gitignore",
        "scenarios.json",
        "src/view.tsx",
        "src/diff.tsx",
        "playwright.config.ts",
        "browser/renderer.spec.ts",
    ] {
        assert!(
            root.join(".github/projections/flags/renderer").join(path).is_file(),
            "{path} was not created"
        );
    }
    let definition = read(root, ".github/projections/flags.json");
    assert_eq!(definition["title"], "Feature flags: Bob's \"best\"");
    assert_eq!(
        definition["extractor"]["command"][1], ".github/projections/flags/extract.py",
        "the extractor is kept"
    );
    assert_eq!(definition["renderer"]["bundle"], ".github/projections/flags/renderer/dist");
    assert_eq!(definition["comparator"], ".github/projections/flags/flags.comparator.yaml");
    assert!(
        root.join(".github/projections/flags/flags.comparator.test.yaml").is_file(),
        "the comparator's tests are scaffolded beside it"
    );
    let manifest = read(root, ".github/projections/flags/renderer/package.json");
    assert_eq!(manifest["name"], "flags-renderer");
    assert_eq!(manifest["projections"]["renderer"], "dist");
    let config = fs::read_to_string(root.join(".github/projections/flags/renderer/vite.config.ts")).unwrap();
    // The build generates the entry from the view and the capabilities declared here.
    assert!(config.contains("view: 'src/view.tsx',"), "{config}");
    assert!(
        !root.join(".github/projections/flags/renderer/src/main.tsx").exists(),
        "a scaffolded renderer has no entry of its own"
    );
    assert!(config.contains("name: 'flags',"), "{config}");
    assert!(config.contains(r#"title: 'Feature flags: Bob\u0027s \"best\"',"#), "{config}");
    assert!(config.contains("comparisonModes: ['diff',"), "{config}");
    let scenarios = read(root, ".github/projections/flags/renderer/scenarios.json");
    assert_eq!(scenarios["renderer"], "flags");
    succeed(cli(root, &["validate", ".github/projections/flags/renderer/scenarios.json"]));

    // The bundle is committed with the sources, even in a repository that ignores dist/.
    let gitignore = fs::read_to_string(root.join(".gitignore")).ok();
    fs::write(root.join(".gitignore"), "dist/\n").unwrap();
    let bundle = ".github/projections/flags/renderer/dist/index.html";
    let ignored = Command::new("git")
        .args(["check-ignore", "-q", "--no-index", bundle])
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .status()
        .unwrap();
    assert_eq!(ignored.code(), Some(1), "{bundle} is ignored");
    match gitignore {
        Some(text) => fs::write(root.join(".gitignore"), text).unwrap(),
        None => fs::remove_file(root.join(".gitignore")).unwrap(),
    }

    // A part is never scaffolded over existing files, and nothing is written then.
    // Styling comes from the kit and the theme: the scaffold has no CSS of its own.
    assert!(!root.join(".github/projections/flags/renderer/src/styles.css").exists());
    let view = root.join(".github/projections/flags/renderer/src/view.tsx");
    fs::write(&view, "// edited\n").unwrap();
    let error = fail(cli(root, &["init", "flags", "--renderer", "custom"]));
    assert!(error.contains("already has files"), "{error}");
    assert_eq!(fs::read_to_string(&view).unwrap(), "// edited\n");

    // The starter comparator passes the starter tests.
    let report: Value = serde_json::from_slice(&cli(root, &["check", "-p", "flags", "--no-render", "--json"]).stdout).unwrap();
    let tests = report["projections"][0]["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| step["id"] == "comparator-tests")
        .unwrap();
    assert_eq!(tests["status"], "pass", "{tests}");
    assert_eq!(tests["file"], ".github/projections/flags/flags.comparator.test.yaml");
    assert_eq!(tests["message"], "2 cases pass");

    // The starter comparator checks and runs.
    git(root, &["add", "--all"]);
    git(root, &["commit", "--quiet", "-m", "Scaffold"]);
    fs::create_dir_all(root.join("docs")).unwrap();
    fs::write(root.join("docs/index.md"), "# Docs\n").unwrap();
    let compared = succeed(cli(root, &["compare", "HEAD", "-p", "flags", "--trust"]));
    assert!(
        compared.contains("Comparator: .github/projections/flags/flags.comparator.yaml"),
        "{compared}"
    );
    assert!(compared.contains("Added entity docs [directory:docs]"), "{compared}");
}

#[test]
fn doctor_and_check_warn_when_a_renderer_package_is_not_this_version() {
    let repo = repository(Some("package.json"));
    let root = repo.path();
    git(root, &["commit", "--quiet", "--allow-empty", "-m", "Start"]);
    succeed(cli(
        root,
        &["init", "flags", "--extractor", "workspace-dependencies", "--renderer", "custom"],
    ));
    let path = ".github/projections/flags/renderer/package.json";
    let mut manifest = read(root, path);
    manifest["dependencies"]["@githubnext/projections"] =
        json!("https://github.com/githubnext/projections/releases/download/v9.9.9/githubnext-projections-9.9.9.tgz");
    fs::write(root.join(path), manifest.to_string()).unwrap();
    let expected = format!(
        ".github/projections/flags/renderer uses @githubnext/projections 9.9.9, but this projections is {}",
        env!("CARGO_PKG_VERSION")
    );

    let doctor: Value = serde_json::from_slice(&cli(root, &["doctor", "--json", "-p", "flags"]).stdout).unwrap();
    let items = doctor["projections"][0]["items"].as_array().unwrap();
    let warning = items
        .iter()
        .find(|item| item["title"] == "Renderer package")
        .expect("a renderer package item");
    assert_eq!(warning["status"], "warn");
    assert!(warning["message"].as_str().unwrap().contains(&expected), "{warning}");

    let check: Value = serde_json::from_slice(&cli(root, &["check", "-p", "flags", "--no-render", "--json"]).stdout).unwrap();
    let steps = check["projections"][0]["steps"].as_array().unwrap();
    let warning = steps
        .iter()
        .find(|step| step["id"] == "renderer-package")
        .expect("a renderer package step");
    assert_eq!(warning["status"], "warn");
    assert!(warning["message"].as_str().unwrap().contains(&expected), "{warning}");

    // At this CLI's version, neither says anything.
    let version = env!("CARGO_PKG_VERSION");
    manifest["dependencies"]["@githubnext/projections"] = json!(format!(
        "https://github.com/githubnext/projections/releases/download/v{version}/githubnext-projections-{version}.tgz"
    ));
    fs::write(root.join(path), manifest.to_string()).unwrap();
    let doctor: Value = serde_json::from_slice(&cli(root, &["doctor", "--json", "-p", "flags"]).stdout).unwrap();
    let items = doctor["projections"][0]["items"].as_array().unwrap();
    assert!(items.iter().all(|item| item["title"] != "Renderer package"), "{items:?}");
}

#[test]
fn init_keeps_a_skill_it_did_not_write_and_never_assumes_a_toolchain() {
    let repo = repository(None);
    let root = repo.path();
    let report = succeed(cli(root, &["init"]));
    assert!(report.contains("projections init <id>"), "{report}");
    let skill = root.join(".agents/skills/projections/SKILL.md");
    assert!(skill.is_file());
    assert!(!root.join(".github/projections").exists());
    fs::write(&skill, "customized\n").unwrap();

    // Without a toolchain manifest the language must be chosen.
    let error = fail(cli(root, &["init", "x"]));
    assert!(error.contains("--language"), "{error}");
    assert!(!root.join(".github/projections").exists());

    let report = succeed(cli(root, &["init", "x", "--language", "go"]));
    assert!(
        report.contains(".agents/skills/projections/SKILL.md (kept: it has no metadata.projections-version"),
        "{report}"
    );
    assert_eq!(fs::read_to_string(&skill).unwrap(), "customized\n");
    let definition = read(root, ".github/projections/x.json");
    assert_eq!(
        definition["extractor"]["command"],
        serde_json::json!(["go", "run", ".github/projections/x/extract.go"])
    );
}

#[test]
fn init_puts_the_skill_where_asked_and_where_claude_code_reads_it() {
    let repo = repository(None);
    let root = repo.path();
    let report = succeed(cli(root, &["init", "--skills-dir", ".github/skills", "--claude", "copy"]));
    assert!(
        report.contains(".github/skills/projections/SKILL.md (created)\n    read by GitHub Copilot\n"),
        "{report}"
    );
    assert!(
        report.contains(".claude/skills/projections/SKILL.md (created)\n    read by Claude Code\n"),
        "{report}"
    );
    assert!(report.contains("init keeps it in sync"), "{report}");
    let report = succeed(cli(root, &["init"]));
    assert!(report.contains(".github/skills/projections/SKILL.md (up to date)"), "{report}");
    assert!(report.contains(".claude/skills/projections/SKILL.md (up to date)"), "{report}");
    // A bare --claude is accepted, and is a no-op once Claude Code reads the skill.
    let report = succeed(cli(root, &["init", "--skills-dir", ".claude/skills", "--claude"]));
    assert!(report.contains("Claude Code already reads .claude/skills"), "{report}");
    assert!(
        report.contains(".github/skills/projections/SKILL.md (removed, so agents see one copy)"),
        "{report}"
    );
    let error = fail(cli(root, &["init", "--skills-dir", "../elsewhere"]));
    assert!(error.contains("--skills-dir must be a directory inside the repository"), "{error}");
}

#[test]
fn init_no_skill_writes_the_projection_alone() {
    let repo = repository(None);
    let root = repo.path();
    let report = succeed(cli(root, &["init", "x", "--language", "go", "--no-skill"]));
    assert!(report.contains("Agent skill: not written (--no-skill)\n"), "{report}");
    assert!(report.contains("follow the guide `projections help authoring` prints"), "{report}");
    assert!(root.join(".github/projections/x.json").is_file());
    for directory in [".agents", ".claude", ".github/skills"] {
        assert!(!root.join(directory).exists(), "{directory}");
    }
    let error = fail(cli(root, &["init", "--no-skill"]));
    assert!(error.contains("<ID>"), "{error}");
    // Without it, init says what it wrote and how to skip it.
    let report = succeed(cli(root, &["init", "y", "--language", "go"]));
    assert!(report.contains(".agents/skills/projections/SKILL.md (created)"), "{report}");
    assert!(report.contains("--no-skill doesn't write it"), "{report}");
}

#[test]
fn init_uses_built_in_components_when_asked() {
    let repo = repository(Some("package.json"));
    let root = repo.path();
    succeed(cli(
        root,
        &[
            "init",
            "deps",
            "--extractor",
            "workspace-dependencies",
            "--renderer",
            "dependencies",
        ],
    ));
    let definition = read(root, ".github/projections/deps.json");
    assert_eq!(definition["extractor"], "workspace-dependencies");
    assert_eq!(definition["renderer"], "dependencies");
    assert!(!root.join(".github/projections/deps").exists());
    let error = fail(cli(root, &["init", "other", "--extractor", "nonsense"]));
    assert!(error.contains("projections extractor list"), "{error}");
}

#[test]
fn help_authoring_prints_the_skill() {
    let directory = tempfile::tempdir().unwrap();
    let guide = succeed(cli(directory.path(), &["help", "authoring"]));
    assert!(guide.starts_with("# Building a custom projection"));
    assert!(guide.contains("Start with what already fits"));
    assert!(guide.contains("projections explore --sweep --json"));
    let help = succeed(cli(directory.path(), &["help", "init"]));
    assert!(help.contains("--renderer custom"), "{help}");
    let error = fail(cli(directory.path(), &["help", "nonsense"]));
    assert!(error.contains("topics: authoring"), "{error}");
}

#[test]
fn raw_extractor_output_is_shown_and_checked_without_running_the_extractor() {
    let repo = repository(Some("package.json"));
    let root = repo.path();
    git(root, &["commit", "--quiet", "--allow-empty", "-m", "Start"]);
    succeed(cli(root, &["init", "service-map"]));
    let raw = root.join("hand-made.json");
    fs::write(
        &raw,
        r#"{"protocolVersion": 0, "schema": "graph/v0",
            "entities": [{"id": "service:b", "kind": "service", "label": "B"},
                         {"id": "service:a", "kind": "service", "label": "A"}],
            "relationships": [{"id": "calls:a->b", "kind": "calls", "from": "service:a", "to": "service:b"}]}"#,
    )
    .unwrap();
    let raw = raw.to_str().unwrap();

    // Without the projection it says what the file is.
    let error = fail(cli(root, &["show", "--from", raw]));
    assert!(error.contains("extractor output"), "{error}");
    assert!(error.contains("-p ID"), "{error}");

    // With it, the working tree's definition normalizes, digests and validates
    // it; no extractor runs, so no --trust is needed.
    let document: Value = serde_json::from_str(&succeed(cli(root, &["show", "--from", raw, "-p", "service-map", "--json"]))).unwrap();
    assert_eq!(document["format"], "projections.extraction");
    assert_eq!(document["projection"]["id"], "service-map");
    assert_eq!(document["extraction"]["entities"][0]["id"], "service:a");
    assert_eq!(document["digest"].as_str().unwrap().len(), 64);
    assert_eq!(document["provenance"]["reproducibility"], "unknown");
    let saved = root.join("saved.json");
    fs::write(&saved, serde_json::to_vec(&document).unwrap()).unwrap();
    succeed(cli(root, &["validate", saved.to_str().unwrap(), "--quiet"]));
    let text = succeed(cli(root, &["show", "--from", raw, "-p", "service-map"]));
    assert!(text.contains("Supplied as extractor output"), "{text}");

    let report: Value = serde_json::from_str(&succeed(cli(
        root,
        &["check", "-p", "service-map", "--from", raw, "--no-render", "--json"],
    )))
    .unwrap();
    let steps = &report["projections"][0]["steps"];
    assert_eq!(steps[1]["title"], "Supplied extraction");
    assert_eq!(steps[1]["status"], "pass");
    assert_eq!(steps[2]["status"], "skip");

    // An invalid one fails with the offending item's path.
    fs::write(
        root.join("broken.json"),
        r#"{"protocolVersion": 0, "schema": "graph/v0", "entities": [],
            "relationships": [{"id": "x", "kind": "k", "from": "a", "to": "b"}]}"#,
    )
    .unwrap();
    let output = cli(root, &["show", "--from", "broken.json", "-p", "service-map", "--json"]);
    assert!(!output.status.success());
    let error: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(error["error"]["code"], "INVALID_EXTRACTION");
    assert_eq!(error["error"]["diagnostics"][0]["path"], "/relationships/0/from");
}

#[test]
fn init_accepts_only_built_in_renderers_the_guide_lists() {
    let repo = repository(Some("package.json"));
    let root = repo.path();
    git(root, &["commit", "--quiet", "--allow-empty", "-m", "Start"]);
    let guide = succeed(cli(root, &["help", "authoring"]));
    if guide.contains("doesn't include the built-in renderers") {
        eprintln!("skipped: this build embeds no renderers to check against");
        return;
    }
    let error = fail(cli(root, &["init", "files", "--renderer", "tree"]));
    assert!(error.contains("There is no built-in renderer tree"), "{error}");
    assert!(!root.join(".github/projections/files.json").exists());
    // Every renderer the error offers is one the guide lists, and is accepted.
    let offered = error
        .split("Built-in renderers: ")
        .nth(1)
        .and_then(|rest| rest.split(';').next())
        .unwrap();
    for name in offered.split(", ") {
        assert!(guide.contains(&format!("`{name}`")), "{name} is not in the guide");
    }
    succeed(cli(root, &["init", "files", "--renderer", "dag"]));
    let definition: Value = serde_json::from_slice(&fs::read(root.join(".github/projections/files.json")).unwrap()).unwrap();
    assert_eq!(definition["renderer"], "dag");
}

#[test]
fn uncommitted_projection_code_compares_real_history() {
    let repo = repository(Some("package.json"));
    let root = repo.path();
    git(root, &["commit", "--quiet", "--allow-empty", "-m", "Start"]);
    succeed(cli(root, &["init", "files"]));
    git(root, &["add", "-A"]);
    git(root, &["commit", "--quiet", "-m", "Scaffold files"]);
    git(root, &["tag", "v1"]);
    fs::create_dir_all(root.join("docs")).unwrap();
    fs::write(root.join("docs/readme.md"), "x\n").unwrap();
    git(root, &["add", "-A"]);
    git(root, &["commit", "--quiet", "-m", "Add docs"]);
    git(root, &["tag", "v2"]);
    // An uncommitted extractor edit applies only with --definition-revision working-tree.
    let extractor = root.join(".github/projections/files/extract.mjs");
    let source = fs::read_to_string(&extractor).unwrap();
    fs::write(&extractor, source.replace("label: name,", "label: name.toUpperCase(),")).unwrap();
    let labels = |document: &Value| -> Vec<String> {
        document["after"]["extraction"]["entities"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entity| entity["label"].as_str().unwrap().to_owned())
            .collect()
    };
    let committed: Value = serde_json::from_str(&succeed(cli(root, &["compare", "v1..v2", "-p", "files", "--trust", "--json"]))).unwrap();
    assert!(labels(&committed).contains(&"docs".to_owned()), "{:?}", labels(&committed));
    let live: Value = serde_json::from_str(&succeed(cli(
        root,
        &[
            "compare",
            "v1..v2",
            "-p",
            "files",
            "--trust",
            "--json",
            "--definition-revision",
            "working-tree",
        ],
    )))
    .unwrap();
    assert!(labels(&live).contains(&"DOCS".to_owned()), "{:?}", labels(&live));
    assert!(
        live["notices"][0].as_str().unwrap().contains("working tree's definition"),
        "{}",
        live["notices"]
    );
}

#[test]
fn explore_proposes_applicable_projections_as_trials_without_writing() {
    let repo = repository(Some("package.json"));
    let root = repo.path();
    fs::create_dir_all(root.join("db")).unwrap();
    fs::write(root.join("db/schema.prisma"), "model User {\n  id Int @id\n}\n").unwrap();
    fs::create_dir_all(root.join("tests/fixtures")).unwrap();
    fs::write(root.join("tests/fixtures/main.tf"), "resource \"x\" \"y\" {}\n").unwrap();
    git(root, &["add", "-A"]);
    git(root, &["commit", "--quiet", "-m", "Start"]);
    let before = fs::read_dir(root).unwrap().count();

    let listed: Value = serde_json::from_str(&succeed(cli(root, &["explore", "--list", "--json"]))).unwrap();
    assert_eq!(listed["format"], "projections.explore");
    let candidates = listed["candidates"].as_array().unwrap();
    let ids: Vec<&str> = candidates.iter().map(|item| item["id"].as_str().unwrap()).collect();
    assert!(ids.contains(&"workspace-dependencies"), "{ids:?}");
    assert!(ids.contains(&"prisma-schema"), "{ids:?}");
    // Fixtures describe other systems.
    assert!(!ids.contains(&"terraform-infrastructure"), "{ids:?}");
    // Specific detections come before the ones every repository matches.
    assert!(ids.iter().position(|id| *id == "prisma-schema") < ids.iter().position(|id| *id == "repository-map"));
    let prisma = candidates.iter().find(|item| item["id"] == "prisma-schema").unwrap();
    assert_eq!(prisma["basis"]["examples"][0], "db/schema.prisma");
    assert_eq!(prisma["requiresTrust"], false);
    assert!(prisma["adopted"].is_null());
    let text = succeed(cli(root, &["explore", "--list"]));
    assert!(text.contains("found `db/schema.prisma`"), "{text}");
    // Nothing was written.
    assert_eq!(fs::read_dir(root).unwrap().count(), before);
    assert!(!root.join(".github").exists());

    // A trial definition runs like an authored one, without its file.
    let runner = projections_cli::runtime::Runner::new(root.to_path_buf(), false)
        .with_executable(env!("CARGO_BIN_EXE_projections"))
        .with_trials(vec![prisma["definition"].clone()])
        .unwrap();
    let shown = runner.show("prisma-schema", "HEAD", None).unwrap();
    assert_eq!(shown["extraction"]["schema"], "database/v0");

    // An authored definition with the extractor marks it adopted.
    succeed(cli(
        root,
        &["init", "data", "--extractor", "prisma-schema", "--renderer", "database"],
    ));
    let listed: Value = serde_json::from_str(&succeed(cli(root, &["explore", "--list", "--json"]))).unwrap();
    let prisma = listed["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == "prisma-schema")
        .unwrap()
        .clone();
    assert_eq!(prisma["adopted"], "data");
}

#[test]
fn explore_proposes_one_workflow_projection_per_workflow_and_skips_vendored_trees() {
    let repo = repository(None);
    let root = repo.path();
    fs::create_dir_all(root.join(".github/workflows")).unwrap();
    for name in ["ci.yml", "release.yaml"] {
        fs::write(
            root.join(".github/workflows").join(name),
            "on: push\njobs:\n  build:\n    runs-on: x\n",
        )
        .unwrap();
    }
    fs::create_dir_all(root.join(".repos/upstream")).unwrap();
    fs::write(root.join(".repos/upstream/tsconfig.json"), "{}").unwrap();
    fs::write(root.join(".gitattributes"), ".repos/** linguist-vendored\n").unwrap();
    git(root, &["add", "-A"]);
    git(root, &["commit", "--quiet", "-m", "Start"]);

    let listed: Value = serde_json::from_str(&succeed(cli(root, &["explore", "--list", "--json"]))).unwrap();
    let candidates = listed["candidates"].as_array().unwrap();
    let ids: Vec<&str> = candidates.iter().map(|item| item["id"].as_str().unwrap()).collect();
    assert!(!ids.contains(&"github-actions-jobs"), "{ids:?}");
    // Vendored code proposes nothing.
    assert!(!ids.contains(&"typescript-public-api"), "{ids:?}");
    let release = candidates.iter().find(|item| item["id"] == "github-actions-jobs-release").unwrap();
    assert_eq!(release["extractor"], "github-actions-jobs");
    assert_eq!(release["definition"]["inputs"]["workflowPath"], ".github/workflows/release.yaml");
    assert_eq!(release["title"], "GitHub Actions jobs: release.yaml");
    let map = candidates.iter().find(|item| item["id"] == "repository-map").unwrap();
    assert_eq!(map["definition"]["inputs"]["exclude"], json!([".repos/**"]));
    assert_eq!(map["basis"]["skipped"], 1);

    // The trial runs with its input, and adopting it writes the input.
    succeed(cli(root, &["adopt", "github-actions-jobs-ci", "--bookmarks", "0"]));
    let written: Value =
        serde_json::from_str(&fs::read_to_string(root.join(".github/projections/github-actions-jobs-ci.json")).unwrap()).unwrap();
    assert_eq!(written["inputs"]["workflowPath"], ".github/workflows/ci.yml");
    let listed: Value = serde_json::from_str(&succeed(cli(root, &["explore", "--list", "--json"]))).unwrap();
    let adopted = |id: &str| {
        listed["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == id)
            .unwrap()["adopted"]
            .clone()
    };
    assert_eq!(adopted("github-actions-jobs-ci"), "github-actions-jobs-ci");
    assert!(adopted("github-actions-jobs-release").is_null());
}

fn merge(root: &Path, branch: &str, number: u32, title: &str, change: impl FnOnce()) {
    git(root, &["checkout", "--quiet", "-b", branch]);
    change();
    git(root, &["add", "-A"]);
    git(root, &["commit", "--quiet", "-m", title]);
    git(root, &["checkout", "--quiet", "-"]);
    let subject = format!("Merge pull request #{number} from acme/{branch}");
    git(root, &["merge", "--quiet", "--no-ff", branch, "-m", &subject, "-m", title]);
}

#[test]
fn explore_sweeps_recent_merges_with_each_projection() {
    let repo = repository(None);
    let root = repo.path();
    fs::create_dir_all(root.join("prisma")).unwrap();
    let schema = "model User {\n  id Int @id\n}\n";
    fs::write(root.join("prisma/schema.prisma"), schema).unwrap();
    git(root, &["add", "-A"]);
    git(root, &["commit", "--quiet", "-m", "Start"]);
    merge(root, "posts", 7, "Add posts", || {
        fs::write(
            root.join("prisma/schema.prisma"),
            format!("{schema}model Post {{\n  id Int @id\n}}\n"),
        )
        .unwrap();
    });
    merge(root, "docs", 8, "Write docs", || {
        fs::write(root.join("README.md"), "# Docs\n").unwrap();
    });

    let swept: Value = serde_json::from_str(&succeed(cli(root, &["explore", "--sweep", "--json", "-p", "prisma-schema"]))).unwrap();
    assert_eq!(swept["format"], "projections.sweep");
    let changes = swept["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 2, "{changes:?}");
    assert_eq!(changes[0]["number"], 8);
    assert_eq!(changes[0]["title"], "Write docs");
    assert_eq!(changes[1]["kind"], "merge");
    let cell = |number: usize| {
        swept["cells"]
            .as_array()
            .unwrap()
            .iter()
            .find(|cell| cell["after"] == changes[number]["after"])
            .unwrap()
            .clone()
    };
    assert_eq!(cell(0)["status"], "unchanged");
    assert_eq!(cell(1)["status"], "changed");
    assert_eq!(cell(1)["counts"]["added"].as_u64().map(|count| count > 0), Some(true));
    assert!(cell(1)["steps"].as_u64().unwrap() >= 1);
    let text = succeed(cli(root, &["explore", "--sweep", "-p", "prisma-schema"]));
    assert!(text.contains("prisma-schema: changed in 1 of 2: #7 ("), "{text}");

    // A projection that runs repository code is skipped without --trust; the others still sweep.
    succeed(cli(root, &["init", "tool", "--language", "node"]));
    let swept: Value = serde_json::from_str(&succeed(cli(
        root,
        &["explore", "--sweep", "--json", "--last", "1", "-p", "tool", "-p", "prisma-schema"],
    )))
    .unwrap();
    let rows = swept["projections"].as_array().unwrap();
    let tool = rows.iter().find(|row| row["projection"] == "tool").unwrap();
    assert_eq!(tool["status"], "trust");
    assert!(
        swept["cells"]
            .as_array()
            .unwrap()
            .iter()
            .all(|cell| cell["projection"] == "prisma-schema")
    );
    assert_eq!(swept["changes"].as_array().unwrap().len(), 1);

    // Without merge commits, the latest commits are the changes.
    let linear = repository(None);
    let root = linear.path();
    fs::create_dir_all(root.join("prisma")).unwrap();
    fs::write(root.join("prisma/schema.prisma"), schema).unwrap();
    git(root, &["add", "-A"]);
    git(root, &["commit", "--quiet", "-m", "Start"]);
    fs::write(root.join("prisma/schema.prisma"), format!("{schema}enum Role {{\n  ADMIN\n}}\n")).unwrap();
    git(root, &["commit", "--quiet", "-am", "Add roles (#3)"]);
    let swept: Value = serde_json::from_str(&succeed(cli(root, &["explore", "--sweep", "--json", "-p", "prisma-schema"]))).unwrap();
    let changes = swept["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 1, "the root commit has nothing before it: {changes:?}");
    assert_eq!(changes[0]["kind"], "commit");
    assert_eq!(changes[0]["number"], 3);
    assert_eq!(swept["cells"][0]["status"], "changed");
}

#[test]
fn adopting_writes_definitions_and_bookmarks_and_ci_is_left_to_the_person() {
    let repo = repository(None);
    let root = repo.path();
    fs::create_dir_all(root.join("prisma")).unwrap();
    let schema = "model User {\n  id Int @id\n}\n";
    fs::write(root.join("prisma/schema.prisma"), schema).unwrap();
    git(root, &["add", "-A"]);
    git(root, &["commit", "--quiet", "-m", "Start"]);
    merge(root, "posts", 7, "Add posts", || {
        fs::write(
            root.join("prisma/schema.prisma"),
            format!("{schema}model Post {{\n  id Int @id\n}}\n"),
        )
        .unwrap();
    });

    let preview = succeed(cli(root, &["adopt", "prisma-schema", "--dry-run"]));
    assert!(preview.contains("Would create .github/projections/prisma-schema.json"), "{preview}");
    assert!(!root.join(".github").exists());
    let adopted: Value = serde_json::from_str(&succeed(cli(root, &["adopt", "prisma-schema", "--json"]))).unwrap();
    assert_eq!(adopted["written"], true);
    assert_eq!(adopted["bookmarked"][0]["id"], "prisma-schema-pr-7");
    let definition = read(root, ".github/projections/prisma-schema.json");
    assert_eq!(definition["extractor"], "prisma-schema");
    // The bookmark runs like any other.
    let listed: Value = serde_json::from_str(&succeed(cli(root, &["bookmark", "list", "--json"]))).unwrap();
    assert_eq!(listed["bookmarks"][0]["title"], "#7 Add posts");
    // Adopting again never replaces the file; unknown IDs name the candidates.
    assert!(fail(cli(root, &["adopt", "prisma-schema"])).contains("already adopted"));
    assert!(fail(cli(root, &["adopt", "nope", "--bookmarks", "0"])).contains("prisma-schema"));

    // Where the CI step goes is the person's decision: nothing writes a workflow, and
    // the removed command says where its guide is.
    let removed = fail(cli(root, &["publish", "--dry-run"]));
    assert!(removed.contains("projections help agents ci"), "{removed}");
    assert!(!root.join(".github/workflows").exists());
    let guide = succeed(cli(root, &["help", "agents", "ci"]));
    assert!(guide.starts_with("# Add Projections to CI"), "{guide}");
    assert!(guide.contains("fetch-depth: 0"), "{guide}");
}

#[test]
fn a_nested_project_keeps_its_own_definitions() {
    let repo = repository(None);
    let root = repo.path();
    fs::create_dir_all(root.join(".projections")).unwrap();
    fs::write(
        root.join(".projections/whole.json"),
        r#"{"id":"whole","extractor":"repository-map","renderer":"file-packing"}"#,
    )
    .unwrap();
    let app = root.join("packages/app");
    fs::create_dir_all(app.join(".github/projections")).unwrap();
    fs::create_dir_all(app.join("src")).unwrap();
    fs::write(app.join("src/index.ts"), "export {}\n").unwrap();
    // Its paths are relative to the project, as if it were the repository's root.
    fs::write(
        app.join(".github/projections/app.json"),
        r#"{"id":"app","extractor":"repository-map","renderer":"file-packing","inputs":{"include":["src/**"]}}"#,
    )
    .unwrap();
    git(root, &["add", "-A"]);
    git(root, &["commit", "--quiet", "-m", "Start"]);
    let ids = |cwd: &Path, extra: &[&str]| -> Vec<String> {
        let mut args = vec!["list", "--json"];
        args.extend(extra);
        let listed: Value = serde_json::from_str(&succeed(cli(cwd, &args))).unwrap();
        listed["projections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["id"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(ids(root, &[]), ["whole"]);
    // From inside the nested project, its definitions are the ones found.
    assert_eq!(ids(&app.join("src"), &[]), ["app"]);
    assert_eq!(ids(root, &["--root", "packages/app"]), ["app"]);
    let shown: Value = serde_json::from_str(&succeed(cli(&app, &["show", "-p", "app", "--json"]))).unwrap();
    let files: Vec<&str> = entity_ids(&shown);
    assert!(
        files.iter().any(|id| id.ends_with("src/index.ts")) && !files.iter().any(|id| id.contains("packages/app")),
        "a built-in sees the project as its root: {files:?}"
    );
    // Init writes into the project.
    succeed(cli(&app, &["init", "more", "--extractor", "repository-map"]));
    assert!(app.join(".github/projections/more.json").is_file());
    assert!(fail(cli(root, &["list", "--root", "/"])).contains("outside the repository"));
}

fn entity_ids(document: &Value) -> Vec<&str> {
    document["extraction"]["entities"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|entity| entity["id"].as_str())
        .collect()
}

#[test]
fn a_nested_project_s_paths_are_relative_to_it_and_its_extractors_run_there() {
    let repo = repository(Some("package.json"));
    let root = repo.path();
    let app = root.join("packages/app");
    fs::create_dir_all(app.join("src")).unwrap();
    fs::create_dir_all(root.join("packages/shared")).unwrap();
    fs::write(app.join("src/index.ts"), "export {}\n").unwrap();
    fs::write(app.join("package.json"), "{}\n").unwrap();
    fs::write(root.join("packages/shared/README.md"), "shared\n").unwrap();
    // A starter extractor, written by init with paths relative to the project.
    succeed(cli(root, &["--root", "packages/app", "init", "tool", "--language", "node"]));
    let tool: Value = serde_json::from_str(&fs::read_to_string(app.join(".github/projections/tool.json")).unwrap()).unwrap();
    assert_eq!(
        tool["extractor"]["command"],
        json!(["node", ".github/projections/tool/extract.mjs"])
    );
    assert_eq!(tool["extractor"]["sources"], json!([".github/projections/tool/extract.mjs"]));
    // An extractor that reports where it runs and what its request says.
    fs::create_dir_all(app.join(".github/projections/probe")).unwrap();
    fs::write(
        app.join(".github/projections/probe/extract.mjs"),
        r#"import {readFileSync, realpathSync} from 'node:fs'
import {relative, sep} from 'node:path'
const request = JSON.parse(readFileSync(0, 'utf8'))
const cwd = relative(realpathSync(request.repository.root), realpathSync(process.cwd())).split(sep).join('/')
const data = {cwd, project: request.repository.project, scope: request.repository.scope ?? []}
process.stdout.write(JSON.stringify({protocolVersion: 0, schema: 'graph/v0', relationships: [],
  entities: [{id: 'probe', kind: 'probe', label: 'probe', data}]}))
"#,
    )
    .unwrap();
    let probe = |id: &str, scope: Option<Value>| {
        let mut definition = json!({"id": id, "renderer": "graph", "extractor": {
            "command": ["node", ".github/projections/probe/extract.mjs"],
            "sources": [".github/projections/probe/extract.mjs"]}});
        if let Some(scope) = scope {
            definition["execution"] = json!({"scope": scope});
        }
        fs::write(app.join(format!(".github/projections/{id}.json")), definition.to_string()).unwrap();
    };
    probe("probe", None);
    // A nested project reads outside itself only by widening its scope.
    probe("wide", Some(json!([".", "../shared"])));
    // A path that leaves the repository is refused, naming the field.
    let escape = json!({"id": "escape", "renderer": "graph",
        "extractor": {"command": ["node", "x.mjs"], "sources": [format!("{}outside", "../".repeat(3))]}});
    fs::write(app.join(".github/projections/escape.json"), escape.to_string()).unwrap();
    git(root, &["add", "-A"]);
    git(root, &["commit", "--quiet", "-m", "Start"]);
    let data = |id: &str| -> Value {
        let shown: Value = serde_json::from_str(&succeed(cli(&app, &["show", "-p", id, "--trust", "--json"]))).unwrap();
        shown["extraction"]["entities"][0]["data"].clone()
    };
    assert_eq!(
        data("probe"),
        json!({"cwd": "packages/app", "project": "packages/app", "scope": ["packages/app"]})
    );
    assert_eq!(data("wide")["scope"], json!(["packages/app", "packages/shared"]));
    // A commit that isn't checked out runs in a copy (or workspace), from the project there too.
    let first = String::from_utf8(
        Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(root)
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    fs::write(app.join("src/other.ts"), "export {}\n").unwrap();
    git(root, &["add", "-A"]);
    git(root, &["commit", "--quiet", "-m", "More"]);
    let shown: Value = serde_json::from_str(&succeed(cli(&app, &["show", first.trim(), "-p", "probe", "--trust", "--json"]))).unwrap();
    let data = &shown["extraction"]["entities"][0]["data"];
    assert_eq!(
        (&data["cwd"], &data["project"]),
        (&json!("packages/app"), &json!("packages/app")),
        "{shown}"
    );
    let output = cli(&app, &["list", "--json"]);
    assert!(!output.status.success());
    let listed: Value = serde_json::from_slice(&output.stdout).unwrap();
    let invalid = &listed["invalid"][0];
    assert_eq!(invalid["id"], "escape");
    let message = invalid["diagnostics"][0]["message"].as_str().unwrap();
    assert!(message.contains("leaves the repository"), "{message}");
    assert_eq!(invalid["diagnostics"][0]["pointer"], "/extractor/sources/0");
    // The starter describes the project's directories.
    let starter: Value = serde_json::from_str(&succeed(cli(&app, &["show", "-p", "tool", "--trust", "--json"]))).unwrap();
    assert_eq!(entity_ids(&starter), ["directory:src"]);
}

#[test]
fn definitions_in_two_projects_with_the_same_paths_do_not_share_cached_extractions() {
    let repo = repository(None);
    let root = repo.path();
    for (project, file) in [("a", "one.ts"), ("b", "two.ts")] {
        let directory = root.join(project);
        fs::create_dir_all(directory.join(".projections")).unwrap();
        fs::create_dir_all(directory.join("src")).unwrap();
        fs::write(directory.join("src").join(file), "export {}\n").unwrap();
        fs::write(
            directory.join(".projections/map.json"),
            r#"{"id":"map","extractor":"repository-map","renderer":"file-packing"}"#,
        )
        .unwrap();
    }
    git(root, &["add", "-A"]);
    git(root, &["commit", "--quiet", "-m", "Start"]);
    let cache = root.join(".git/test-cache");
    let show = |project: &str, reference: &str| -> Vec<String> {
        let output = Command::new(env!("CARGO_BIN_EXE_projections"))
            .args(["show", reference, "-p", "map", "--json"])
            .current_dir(root.join(project))
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("PROJECTIONS_CACHE_DIR", &cache)
            .output()
            .unwrap();
        let shown: Value = serde_json::from_str(&succeed(output)).unwrap();
        entity_ids(&shown).into_iter().map(str::to_owned).collect()
    };
    for reference in ["working-tree", "HEAD"] {
        let a = show("a", reference);
        let b = show("b", reference);
        assert!(
            a.iter().any(|id| id.ends_with("src/one.ts")) && !a.iter().any(|id| id.contains("two")),
            "{a:?}"
        );
        assert!(
            b.iter().any(|id| id.ends_with("src/two.ts")) && !b.iter().any(|id| id.contains("one")),
            "{b:?}"
        );
    }
}
