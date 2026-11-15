//! Rust public API, from rustdoc's JSON output.
//!
//! Runs the project's own `cargo rustdoc` with a nightly toolchain (rustdoc
//! JSON is unstable) and converts the documented public items into `api/v0`
//! declarations with the contract facts the Cargo SemVer reference's rules
//! inspect. A pre-generated rustdoc JSON file can be imported instead.

mod model;

pub use model::{FORMAT_VERSIONS, api};

use anyhow::{Context as _, Result, bail, ensure};
use projections_extractor_sdk::{Context, Descriptor, Scratch, Trust, execute, input, parse_json, path, read_file, read_json, strings};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

pub const ID: &str = "rust-public-api";

/// The largest rustdoc JSON document read, which includes paths into std.
const MAX_RUSTDOC_BYTES: usize = 32 * 1024 * 1024;

const NIGHTLY: &str = "`rust-public-api` reads rustdoc's JSON output, which requires a nightly toolchain: \
    set `inputs.toolchain` to an installed nightly (for example `nightly-2026-09-17`), or import a generated file with `inputs.rustdocJson`";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Rust public API",
        description: "rustdoc JSON public items",
        schema: "api/v0",
        renderer: "api",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({
            "manifestPath": "Cargo.toml path; default Cargo.toml",
            "package": "Package to document in a workspace",
            "toolchain": "rustup toolchain with rustdoc JSON, such as a pinned nightly",
            "features": "Features to enable",
            "allFeatures": "Enable every feature",
            "noDefaultFeatures": "Disable default features",
            "cargoPath": "Cargo executable",
            "rustdocJson": "Pre-generated rustdoc JSON file; otherwise runs cargo rustdoc"
        }),
        template_inputs: Some(json!({"toolchain": "nightly"})),
        detects: &["Cargo.toml", "**/Cargo.toml"],
    }
}

pub fn requires_trust(inputs: &Value) -> bool {
    inputs.get("rustdocJson").is_none()
}

pub fn collect(cx: &Context) -> Result<Value> {
    let (root, definition) = (cx.root(), cx.definition());
    let declared = match definition["inputs"].get("rustdocJson") {
        Some(_) => input(definition, "rustdocJson", None)?,
        None => input(definition, "manifestPath", Some("Cargo.toml"))?,
    };
    // A revision without the declared rustdoc JSON or manifest (before it was added) has no API.
    if !cx.input_exists(declared)? {
        return Ok(projections_extractor_sdk::extraction(
            "api/v0",
            vec![],
            vec![],
            Some(serde_json::json!({"ecosystem": "rust"})),
        ));
    }
    let (document, base) = if definition["inputs"].get("rustdocJson").is_some() {
        (read_json(root, declared)?, ".".to_owned())
    } else {
        rustdoc(root, definition, cx)?
    };
    api(&document, &base)
}

/// Runs `cargo rustdoc` for the package's library and reads its JSON output.
/// Returns the document and the manifest's directory relative to the root,
/// which rustdoc's span paths are relative to.
fn rustdoc(root: &Path, d: &Value, cx: &Context) -> Result<(Value, String)> {
    cx.require_trust()?;
    let manifest_input = input(d, "manifestPath", Some("Cargo.toml"))?;
    let manifest = path(root, manifest_input, false, false)?;
    let base = Path::new(manifest_input)
        .parent()
        .map(|parent| parent.to_string_lossy().replace('\\', "/"))
        .filter(|parent| !parent.is_empty())
        .unwrap_or_else(|| ".".into());
    let scratch = Scratch::new(root, "rustdoc")?;
    let mut argv = vec![
        input(d, "cargoPath", Some("cargo"))?.to_owned(),
        "rustdoc".into(),
        "--lib".into(),
        "--manifest-path".into(),
        manifest.to_string_lossy().into_owned(),
        "--target-dir".into(),
        scratch.0.to_string_lossy().into_owned(),
    ];
    if d["inputs"].get("package").is_some() {
        argv.extend(["--package".into(), input(d, "package", None)?.to_owned()]);
    }
    if let Some(features) = d["inputs"].get("features") {
        let features = strings(features, "inputs.features")?;
        if !features.is_empty() {
            argv.extend(["--features".into(), features.join(",")]);
        }
    }
    for (name, flag) in [("allFeatures", "--all-features"), ("noDefaultFeatures", "--no-default-features")] {
        if let Some(value) = d["inputs"].get(name) {
            ensure!(value.is_boolean(), "`inputs.{name}` must be a boolean");
            if value == true {
                argv.push(flag.into());
            }
        }
    }
    argv.extend([
        "--".into(),
        "-Z".into(),
        "unstable-options".into(),
        "--output-format".into(),
        "json".into(),
    ]);
    let mut overrides = BTreeMap::new();
    if d["inputs"].get("toolchain").is_some() {
        let toolchain = input(d, "toolchain", None)?;
        ensure!(
            !toolchain.starts_with('-') && !toolchain.contains(['/', '\\']),
            "`inputs.toolchain` must name a rustup toolchain"
        );
        overrides.insert("RUSTUP_TOOLCHAIN".to_owned(), toolchain.to_owned());
    }
    execute(cx, root, argv, None, overrides, true).map_err(|error| {
        let detail = format!("{error:#}");
        if detail.contains("only accepted on the nightly") || detail.contains("unstable-options") {
            error.context(NIGHTLY)
        } else {
            error
        }
    })?;
    let documents: Vec<_> = fs::read_dir(scratch.0.join("doc"))
        .context("`cargo rustdoc` wrote no documentation")?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|file| file.extension().is_some_and(|extension| extension == "json"))
        .collect();
    let [document] = documents.as_slice() else {
        bail!(
            "`cargo rustdoc` wrote {} JSON documents; select one library with `inputs.package`",
            documents.len()
        );
    };
    let bytes = read_file(document, MAX_RUSTDOC_BYTES)?;
    let text = String::from_utf8(bytes).context("rustdoc JSON is not UTF-8")?;
    Ok((parse_json(&text).context("rustdoc wrote invalid JSON")?, base))
}

#[cfg(test)]
mod tests {
    use super::*;
    use projections_extractor_sdk::{Output, testing};
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    type Run = (Vec<String>, BTreeMap<String, String>);

    /// A trusted context whose `cargo rustdoc` writes the fixture's JSON, or, on a
    /// stable toolchain, refuses `-Z`. Runs are recorded in `runs`.
    fn context(root: &Path, definition: Value, stable: bool, runs: Arc<Mutex<Vec<Run>>>) -> Context {
        testing::trusted(root, definition).with_tools(move |call| {
            let (argv, environment) = (call.argv, call.environment);
            runs.lock().unwrap().push((argv.to_vec(), environment.clone()));
            if stable {
                bail!("error: the option `Z` is only accepted on the nightly compiler");
            }
            let target = &argv[argv.iter().position(|arg| arg == "--target-dir").unwrap() + 1];
            fs::create_dir_all(Path::new(target).join("doc"))?;
            fs::write(
                Path::new(target).join("doc/fixture.json"),
                include_str!("../tests/fixtures/minimal.json"),
            )?;
            Ok(Output {
                stdout: String::new(),
                stderr: String::new(),
            })
        })
    }

    fn scratch_root() -> PathBuf {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../target/rust-public-api-unit-tests")
            .join(format!(
                "{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            ));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("Cargo.toml"), "[package]\nname = \"fixture\"\n").unwrap();
        root.canonicalize().unwrap()
    }

    #[test]
    fn runs_cargo_rustdoc_with_the_selected_toolchain_and_reads_its_json() {
        let root = scratch_root();
        let runs = Arc::default();
        let definition = json!({"id": "api", "extractor": ID, "inputs": {"toolchain": "nightly-2026-09-17", "features": ["serde"], "noDefaultFeatures": true}});
        let extraction = collect(&context(&root, definition, false, Arc::clone(&runs))).unwrap();
        assert_eq!(extraction["metadata"]["ecosystem"], "rust");
        let runs = runs.lock().unwrap();
        let (argv, environment) = &runs[0];
        assert_eq!(argv[..3], ["cargo", "rustdoc", "--lib"]);
        assert!(argv.windows(2).any(|pair| pair == ["--features", "serde"]));
        assert!(argv.contains(&"--no-default-features".to_owned()));
        assert_eq!(argv[argv.len() - 5..], ["--", "-Z", "unstable-options", "--output-format", "json"]);
        assert_eq!(environment["RUSTUP_TOOLCHAIN"], "nightly-2026-09-17");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_stable_toolchain_reports_the_nightly_requirement() {
        let root = scratch_root();
        let definition = json!({"id": "api", "extractor": ID, "inputs": {}});
        let error = format!("{:#}", collect(&context(&root, definition, true, Arc::default())).unwrap_err());
        assert!(error.contains("requires a nightly toolchain"), "{error}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn importing_rustdoc_json_needs_no_trust() {
        assert!(!requires_trust(&json!({"rustdocJson": "api.json"})));
        assert!(requires_trust(&json!({})));
    }
}
