//! The `projections` Python module: its own tests, and Python extractors that
//! import it with nothing installed, because the runner puts it on PYTHONPATH.

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

fn repository(files: &[(&str, &str)]) -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    git(root.path(), &["init", "--template=", "--quiet"]);
    git(root.path(), &["config", "user.name", "Python fixture"]);
    git(root.path(), &["config", "user.email", "python@example.invalid"]);
    for (path, text) in files {
        let path = root.path().join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    git(root.path(), &["add", "."]);
    git(root.path(), &["commit", "--quiet", "--allow-empty", "-m", "Start"]);
    root
}

/// Runs the CLI with its own cache and no PYTHONPATH of the caller's.
fn cli(cwd: &Path, cache: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_projections"))
        .args(args)
        .current_dir(cwd)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("PROJECTIONS_CACHE_DIR", cache)
        .env_remove("PYTHONPATH")
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

#[test]
fn the_modules_own_tests_pass() {
    // The Python 3 a definition's python3 runs, which Windows names python or py -3.
    let python = projections_cli::python::find("python3").expect("Python 3 is on PATH");
    let output = Command::new(&python[0])
        .args(&python[1..])
        .args(["-m", "unittest", "discover", "-s", "python/tests"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .output()
        .expect("Python runs the module's tests");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

const EXTRACTOR: &str = r#"
from projections import request, result
import mine

with open(request.root + "/teams.txt") as teams:
    names = teams.read().split()
result(
    entities={f"team:{name}": {"kind": "team", "label": name} for name in names},
    relationships=[{"id": f"next:{a}", "kind": "next", "from": f"team:{a}", "to": f"team:{b}"} for a, b in zip(names, names[1:])],
    metadata={"by": mine.NAME, "project": request.project},
)
"#;

#[test]
fn a_python_extractor_imports_the_module_with_nothing_installed() {
    let definition = json!({"id": "teams", "renderer": "graph", "extractor": {"command": ["python3", "extract.py"], "sources": ["extract.py"]},
        "execution": {"environment": ["PYTHONPATH"]}});
    let repo = repository(&[
        ("api/.github/projections/teams.json", &definition.to_string()),
        ("api/extract.py", EXTRACTOR),
        ("api/teams.txt", "zeta alpha mu\n"),
    ]);
    let cache = tempfile::tempdir().unwrap();
    // A PYTHONPATH the definition passes through still works, after the module's directory.
    let mine = tempfile::tempdir().unwrap();
    fs::write(mine.path().join("mine.py"), "NAME = 'mine'\n").unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_projections"))
        .args(["show", "-p", "teams", "--trust", "--json"])
        .current_dir(repo.path().join("api"))
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("PROJECTIONS_CACHE_DIR", cache.path())
        .env("PYTHONPATH", mine.path())
        .output()
        .unwrap();
    let saved: Value = serde_json::from_str(&succeed(output)).unwrap();
    let extraction = &saved["extraction"];
    assert_eq!(extraction["schema"], "graph/v0");
    let ids: Vec<&str> = extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["team:alpha", "team:mu", "team:zeta"]);
    assert_eq!(extraction["relationships"][0]["id"], "next:alpha");
    assert_eq!(extraction["relationships"][1]["to"], "team:alpha");
    assert_eq!(extraction["metadata"], json!({"by": "mine", "project": "api"}));

    let directory = succeed(cli(repo.path(), cache.path(), &["__python-path"]));
    let directory = Path::new(directory.trim());
    assert!(directory.starts_with(cache.path()), "{}", directory.display());
    assert!(directory.join("projections/__init__.py").is_file());
}

#[test]
fn the_python_starter_runs_as_is() {
    let repo = repository(&[
        ("pyproject.toml", "[project]\nname = \"shop\"\n"),
        ("services/payments/app.yaml", "name: x\n"),
    ]);
    let cache = tempfile::tempdir().unwrap();
    succeed(cli(repo.path(), cache.path(), &["init", "services"]));
    let starter = fs::read_to_string(repo.path().join(".github/projections/services/extract.py")).unwrap();
    assert!(starter.contains("from projections import request, result"), "{starter}");
    let saved: Value = serde_json::from_str(&succeed(cli(
        repo.path(),
        cache.path(),
        &["show", "-p", "services", "--trust", "--json"],
    )))
    .unwrap();
    assert_eq!(saved["extraction"]["entities"][0]["id"], "directory:services");
    assert_eq!(saved["extraction"]["entities"][0]["data"]["files"], json!(1));
}
