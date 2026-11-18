use std::{env, fs, path::Path};

fn copy(source: &Path, destination: &Path, names: &mut Vec<String>, prefix: &str) {
    fs::create_dir_all(destination).expect("Create native asset staging directory");
    for entry in fs::read_dir(source).expect("Read built Inspector assets") {
        let entry = entry.expect("Read Inspector asset entry");
        let metadata = fs::symlink_metadata(entry.path()).expect("Read Inspector asset metadata");
        assert!(!metadata.is_symlink(), "Inspector assets must not contain symlinks");
        let name = format!("{prefix}{}", entry.file_name().to_str().expect("UTF8 Inspector asset name"));
        if metadata.is_dir() {
            copy(&entry.path(), &destination.join(entry.file_name()), names, &format!("{name}/"));
        } else {
            assert!(metadata.is_file(), "Inspector assets must be regular files");
            fs::copy(entry.path(), destination.join(entry.file_name())).expect("Stage built Inspector asset");
            names.push(name);
        }
    }
}

const IGNORED: &[&str] = &[
    "bin",
    "obj",
    "node_modules",
    "target",
    "__pycache__",
    ".venv",
    ".git",
    ".cache",
    ".data",
];

/// Collects the regular files under `source` as `prefix/relative` names, skipping
/// build and tool caches.
fn tree(source: &Path, prefix: &str, files: &mut Vec<(String, std::path::PathBuf)>) {
    let mut entries: Vec<_> = fs::read_dir(source)
        .expect("Read extractor helper directory")
        .map(|entry| entry.expect("Read extractor helper entry"))
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name().to_str().expect("UTF8 extractor helper name").to_owned();
        if IGNORED.contains(&name.as_str()) {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path()).expect("Read extractor helper metadata");
        assert!(!metadata.is_symlink(), "Extractor helpers must not contain symlinks");
        if metadata.is_dir() {
            tree(&entry.path(), &format!("{prefix}/{name}"), files);
        } else {
            assert!(metadata.is_file(), "Extractor helpers must be regular files");
            files.push((format!("{prefix}/{name}"), entry.path()));
        }
    }
}

/// A distribution build (`PROJECTIONS_EMBED_HELPERS=1`) embeds the extractor helpers,
/// which the CLI unpacks into its per-user cache on first use. Other builds embed none
/// and resolve the helpers from their crates in this source checkout.
/// `PROJECTIONS_REQUIRE_HELPERS=1` makes a missing helper a build failure.
fn helpers(destination: &Path) -> String {
    println!("cargo:rerun-if-env-changed=PROJECTIONS_EMBED_HELPERS");
    println!("cargo:rerun-if-env-changed=PROJECTIONS_REQUIRE_HELPERS");
    let mut generated = "static HELPERS:&[(&str,&[u8])]=&[\n".to_owned();
    if env::var("PROJECTIONS_EMBED_HELPERS").as_deref() != Ok("1") {
        return generated + "];\n";
    }
    let required = env::var("PROJECTIONS_REQUIRE_HELPERS").as_deref() == Ok("1");
    let mut files = Vec::new();
    for (installed, source, description) in [
        ("helpers/go", "../extractors/go-support/helper", "The Go helper source"),
        ("helpers/python", "../extractors/django-schema/helper", "The Django helper"),
        ("helpers/spring", "../extractors/spring-di/helper", "The Spring helper source"),
        (
            "helpers/dotnet",
            "../extractors/dotnet-support/helper/publish",
            "The prebuilt .NET helper (node packages/extractors/dotnet-support/scripts/publish.mjs)",
        ),
        (
            "helpers/node/extractor.mjs",
            "../extractors/typescript-support/dist/extractor.mjs",
            "The TypeScript helper (npm run build --workspace @githubnext/projections-typescript-support)",
        ),
    ] {
        let source = Path::new(source);
        println!("cargo:rerun-if-changed={}", source.display());
        if source.is_file() {
            files.push((installed.to_owned(), source.to_owned()));
        } else if source.is_dir() {
            tree(source, installed, &mut files);
        } else if required {
            panic!(
                "{description} is missing at {}; PROJECTIONS_REQUIRE_HELPERS=1 requires every helper",
                source.display()
            );
        } else {
            println!(
                "cargo:warning={description} is missing at {}; this build omits it",
                source.display()
            );
        }
    }
    let staging = destination.parent().expect("Cargo output parent").join("helper-assets");
    if staging.exists() {
        fs::remove_dir_all(&staging).expect("Replace owned helper staging directory");
    }
    fs::create_dir(&staging).expect("Create helper staging directory");
    for (index, (name, source)) in files.iter().enumerate() {
        let staged = staging.join(index.to_string());
        fs::copy(source, &staged).expect("Stage extractor helper");
        generated.push_str(&format!(
            "({name:?},include_bytes!(concat!(env!(\"OUT_DIR\"),\"/helper-assets/{index}\"))),\n"
        ));
    }
    generated + "];\n"
}

fn main() {
    let source = Path::new("../host/inspector/dist/client");
    println!("cargo:rerun-if-changed={}", source.display());
    let destination = std::path::PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output directory")).join("inspector-assets");
    if destination.exists() {
        fs::remove_dir_all(&destination).expect("Replace owned Cargo asset staging directory");
    }
    fs::create_dir(&destination).expect("Create Cargo asset directory");
    let mut names = Vec::new();
    if source.is_dir() {
        copy(source, &destination, &mut names, "");
    }
    names.sort();
    let mut embedded = "static INSPECTOR:&[(&str,&[u8])]=&[\n".to_owned();
    for name in names {
        embedded.push_str(&format!(
            "({name:?},include_bytes!(concat!(env!(\"OUT_DIR\"),\"/inspector-assets/\",{name:?}))),\n"
        ));
    }
    embedded.push_str("];\n");
    // The default comparator module identifies the comparator that produced a
    // comparison; viewers rerun the same module to verify it.
    let comparator = Path::new("../comparators/default/dist/default-comparator.wasm");
    println!("cargo:rerun-if-changed={}", comparator.display());
    if comparator.is_file() {
        let staged = destination.join("default-comparator.wasm");
        fs::copy(comparator, &staged).expect("Stage the default comparator module");
        embedded.push_str("static DEFAULT_COMPARATOR:Option<&[u8]>=Some(include_bytes!(concat!(env!(\"OUT_DIR\"),\"/inspector-assets/default-comparator.wasm\")));\n");
    } else {
        embedded.push_str("static DEFAULT_COMPARATOR:Option<&[u8]>=None;\n");
    }
    // The rules comparator module runs every rules file, sandboxed.
    let rules = Path::new("../comparators/rules/dist/rules.wasm");
    println!("cargo:rerun-if-changed={}", rules.display());
    if rules.is_file() {
        let staged = destination.join("rules.wasm");
        fs::copy(rules, &staged).expect("Stage the rules comparator module");
        embedded.push_str(
            "static RULES_COMPARATOR:Option<&[u8]>=Some(include_bytes!(concat!(env!(\"OUT_DIR\"),\"/inspector-assets/rules.wasm\")));\n",
        );
    } else {
        embedded.push_str("static RULES_COMPARATOR:Option<&[u8]>=None;\n");
    }
    embedded.push_str(&helpers(&destination));
    fs::write(
        destination.parent().expect("Cargo output parent").join("inspector-assets.rs"),
        embedded,
    )
    .expect("Generate native Inspector embedding");
}
