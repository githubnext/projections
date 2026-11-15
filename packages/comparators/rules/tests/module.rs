//! The interpreter runs in the engine's WebAssembly build: compiled as a
//! comparator module (zero imports, the comparator ABI) and run in the
//! sandboxed comparator runtime (wasmi, with fuel and memory bounds), it
//! produces the same comparisons as natively, and the runtime's bounds stop
//! rules that would compute without end or grow without bound.

mod common;

use common::{canonicalize, read, root, rules_text};
use projections_comparator_rules::compare;
use projections_comparator_runtime::{ComparatorError, ComparatorModule, Limits};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::process::Command;

fn build() -> PathBuf {
    let target = root().join("target/comparator-module-test");
    let status = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .current_dir(root())
        .args([
            "rustc",
            "--locked",
            "--release",
            "-p",
            "projections-comparator-rules",
            "--target",
            "wasm32-unknown-unknown",
            "--lib",
            "--crate-type",
            "cdylib",
            "--target-dir",
        ])
        .arg(&target)
        .args(["--", "-C", "link-arg=--max-memory=268435456"])
        .env_remove("RUSTC_WORKSPACE_WRAPPER")
        .env_remove("RUSTC_WRAPPER")
        .env_remove("CARGO_ENCODED_RUSTFLAGS")
        .env_remove("RUSTFLAGS")
        .status()
        .expect("run cargo");
    assert!(status.success(), "build the rules comparator module");
    target.join("wasm32-unknown-unknown/release/projections_comparator_rules.wasm")
}

fn run(module: &ComparatorModule, rules: &str, before: &Value, after: &Value, limits: &Limits) -> Result<Value, ComparatorError> {
    let input = json!({"protocolVersion": 0, "before": before, "after": after,
        "baseline": {"protocolVersion": 0, "changes": [], "steps": []}, "options": {"rules": rules}});
    module.compare(&input, limits)
}

/// `f0(s) = s + s`, `f1(s) = f0(s + s)`, ...: an acyclic call graph whose
/// result is 2^depth times its input.
pub fn doubling(depth: usize) -> String {
    let mut functions = serde_json::Map::new();
    functions.insert("f0".into(), json!({"params": ["s"], "body": "s + s"}));
    for level in 1..depth {
        functions.insert(
            format!("f{level}"),
            json!({"params": ["s"], "body": format!("f{}(s + s)", level - 1)}),
        );
    }
    // JSON is YAML, too.
    json!({"format": "projections.comparator", "version": 0, "functions": functions,
        "metadata": {"values": {"size": format!("size(f{}('x'))", depth - 1)}}})
    .to_string()
}

#[test]
fn the_module_runs_the_rules_in_the_sandbox() {
    common::with_stack(the_module_runs_the_rules_in_the_sandbox_);
}

fn the_module_runs_the_rules_in_the_sandbox_() {
    let bytes = std::fs::read(build()).unwrap();
    eprintln!("rules.wasm: {} bytes", bytes.len());
    // Loading checks zero imports and the comparator ABI exports.
    let module = ComparatorModule::load(&bytes).unwrap();
    // Editors' language service is a separate module (`rules-editor.wasm`),
    // so viewers don't download it.
    assert!(
        !bytes
            .windows(b"projections_rules_editor".len())
            .any(|window| window == b"projections_rules_editor"),
        "rules.wasm must not carry the editor language service"
    );
    let limits = Limits::default();
    let fixtures = root().join("packages/renderers");
    let pairs = [
        (
            "priority-order",
            fixtures.join("graph/fixtures/platform-before.json"),
            fixtures.join("graph/fixtures/platform-after.json"),
        ),
        (
            "priority-order",
            fixtures.join("file-packing/fixtures/opensource-before.json"),
            fixtures.join("file-packing/fixtures/opensource-after.json"),
        ),
        (
            "moved-components",
            root().join("examples/comparators/moved-components/fixtures/before.json"),
            root().join("examples/comparators/moved-components/fixtures/after.json"),
        ),
        (
            "runtime-policy",
            root().join("packages/extractors/tetragon-policies/tests/fixtures/credentials/before.expected.json"),
            root().join("packages/extractors/tetragon-policies/tests/fixtures/credentials/after.expected.json"),
        ),
        (
            "api-compatibility",
            fixtures.join("api/fixtures/go-before.json"),
            fixtures.join("api/fixtures/go-after.json"),
        ),
        (
            "api-compatibility",
            fixtures.join("api/fixtures/typescript-before.json"),
            fixtures.join("api/fixtures/typescript-after.json"),
        ),
    ];
    for (name, before, after) in pairs {
        // A quick run (debug builds) interprets the module in an unoptimized
        // runtime: it leaves out the largest fixture and the API rules.
        let large = before.to_string_lossy().contains("file-packing");
        if common::quick() && (large || name == "api-compatibility") {
            continue;
        }
        let (text, before, after) = (rules_text(name), read(&before), read(&after));
        let native = compare(&text, &before, &after, &json!({})).unwrap();
        let sandboxed = run(&module, &text, &before, &after, &limits).unwrap();
        assert_eq!(canonicalize(&sandboxed), canonicalize(&native), "{name}");
        // The runtime runs the same module for a rules file, and identifies it
        // by the digest this crate defines.
        let rules = ComparatorModule::load_rules(&bytes, text.as_bytes()).unwrap();
        assert!(rules.is_rules());
        let canonical = projections_comparator_rules::Comparator::from_yaml(&text).unwrap();
        assert_eq!(
            rules.digest(),
            projections_comparator_rules::digest(&projections_comparator_runtime::interpreter_digest(&bytes), canonical.canonical())
        );
        let input = json!({"protocolVersion": 0, "before": before, "after": after,
            "baseline": {"protocolVersion": 0, "changes": [], "steps": []}, "options": {}});
        assert_eq!(
            canonicalize(&rules.compare(&input, &Limits::rules()).unwrap()),
            canonicalize(&native),
            "{name}"
        );
    }

    // CEL terminates, but not cheaply: a quadratic comprehension over its range
    // limit is 10^12 steps. The cost budget, or before it the runtime's fuel, stops it.
    let busy = json!({"format": "projections.comparator", "version": 0,
        "metadata": {"values": {"busy": "lists.range(1000000).filter(i, lists.range(1000000).exists(j, j == i + 1000000)).size()"}}})
    .to_string();
    let empty = json!({"protocolVersion": 0, "schema": "graph/v0", "entities": [], "relationships": []});
    let fuel = Limits {
        fuel: 2_000_000_000,
        ..Limits::default()
    };
    let result = run(&module, &busy, &empty, &empty, &fuel);
    assert!(
        matches!(&result, Err(ComparatorError::OutOfFuel { .. }))
            || matches!(&result, Err(ComparatorError::Comparator(message)) if message.contains("cost-limit")),
        "{result:?}"
    );

    // Acyclic functions can still build a value exponential in the rules' size:
    // 2^32 bytes from 32 functions. The runtime's memory bound (here 32 MiB)
    // stops it.
    let small_memory = Limits {
        max_memory_bytes: 32 * 1024 * 1024,
        ..Limits::default()
    };
    let result = run(&module, &doubling(32), &empty, &empty, &small_memory);
    assert!(
        matches!(result, Err(ComparatorError::MemoryLimit { .. } | ComparatorError::Trap(_)))
            || matches!(&result, Err(ComparatorError::Comparator(message)) if message.contains("cost-limit")),
        "{result:?}"
    );
    // Problems in a rules file are found when it loads, with their lines.
    let invalid = ComparatorModule::load_rules(
        &bytes,
        b"format: projections.comparator\nversion: 0\nmetadata:\n  values:\n    x: nope(1)\n",
    )
    .unwrap_err();
    assert!(
        invalid.to_string().contains("Line 5, column 8: Undeclared function `nope`"),
        "{invalid}"
    );
    // The same shape at a harmless depth runs.
    let small = run(&module, &doubling(4), &empty, &empty, &limits).unwrap();
    assert_eq!(small["metadata"]["size"], 16);
}

/// Loose regression ceilings for rules in the sandbox, the way every host runs
/// them: they catch pathological regressions, not small slowdowns. Each is the
/// best of three runs on a loaded machine; typical times are well below them
/// (docs/design/declarative-comparators.md, Performance). They need optimized
/// code (`cargo test --release`, or `DECLARATIVE_FULL`): an unoptimized wasmi
/// is 50-100 times slower.
#[test]
fn rules_stay_within_their_sandboxed_regression_ceilings() {
    if cfg!(debug_assertions) {
        eprintln!("Regression ceilings are measured in optimized builds: cargo test --release");
        return;
    }
    common::with_stack(rules_stay_within_their_sandboxed_regression_ceilings_);
}

fn rules_stay_within_their_sandboxed_regression_ceilings_() {
    use std::time::{Duration, Instant};
    let interpreter = ComparatorModule::load(&std::fs::read(build()).unwrap()).unwrap();
    let fixtures = root().join("packages/renderers");
    let ceilings = [
        // The largest fixture: 1,600 entities on each side.
        (
            "priority-order",
            fixtures.join("file-packing/fixtures/opensource-before.json"),
            fixtures.join("file-packing/fixtures/opensource-after.json"),
            Duration::from_secs(2),
        ),
        (
            "api-compatibility",
            fixtures.join("api/fixtures/typescript-before.json"),
            fixtures.join("api/fixtures/typescript-after.json"),
            Duration::from_millis(500),
        ),
        (
            "api-compatibility",
            fixtures.join("api/fixtures/go-before.json"),
            fixtures.join("api/fixtures/go-after.json"),
            Duration::from_millis(500),
        ),
        (
            "runtime-policy",
            root().join("packages/extractors/tetragon-policies/tests/fixtures/credentials/before.expected.json"),
            root().join("packages/extractors/tetragon-policies/tests/fixtures/credentials/after.expected.json"),
            Duration::from_millis(500),
        ),
    ];
    for (name, before, after, ceiling) in ceilings {
        let fixture = before.display().to_string();
        let input = json!({"protocolVersion": 0, "before": read(&before), "after": read(&after),
            "baseline": {"protocolVersion": 0, "changes": [], "steps": []}, "options": {}});
        // Checked once per content, as hosts cache it; each comparison then
        // runs in a fresh sandboxed instance.
        let rules = ComparatorModule::rules(&interpreter, rules_text(name).as_bytes()).unwrap();
        let best = (0..3)
            .map(|_| {
                let start = Instant::now();
                rules.compare(&input, &Limits::rules()).unwrap();
                start.elapsed()
            })
            .min()
            .unwrap();
        eprintln!("{name} on {fixture}: {} ms in the sandbox", best.as_millis());
        assert!(
            best <= ceiling,
            "{name} on {fixture} took {} ms in the sandbox; its ceiling is {} ms",
            best.as_millis(),
            ceiling.as_millis()
        );
    }
}
