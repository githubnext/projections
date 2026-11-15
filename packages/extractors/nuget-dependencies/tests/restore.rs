//! Importing a revision's assets, and restoring each revision when they aren't part of it.

use projections_extractor_nuget_dependencies::{collect, requires_trust};
use projections_extractor_sdk::{Context, Output, canonical, testing};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

const ASSETS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/nuget/project.assets.json");

struct Fixture(PathBuf);

impl Fixture {
    fn new(name: &str) -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../target/nuget-dependencies-tests")
            .join(format!("{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        // As the context canonicalizes it: without the `\\?\` prefix Windows adds.
        Self(canonical(&root).unwrap())
    }
    fn put(&self, relative: &str, content: &str) {
        let file = self.0.join(relative);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, content).unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn definition(inputs: Value) -> Value {
    json!({"id":"nuget","extractor":"nuget-dependencies","renderer":"dependencies","inputs":inputs})
}

fn labels(extraction: &Value) -> Vec<&str> {
    extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entity| entity["label"].as_str().unwrap())
        .collect()
}

#[test]
fn explicit_assets_git_ignores_are_named_not_treated_as_missing() {
    let fixture = Fixture::new("ignored");
    let git = |args: &[&str]| assert!(Command::new("git").args(args).current_dir(&fixture.0).status().unwrap().success());
    git(&["init", "--quiet", "--template="]);
    fixture.put(".gitignore", "obj/\n");
    fixture.put("App.csproj", "<Project />");
    fixture.put("obj/project.assets.json", &fs::read_to_string(ASSETS).unwrap());
    let mut request = testing::request(&fixture.0, definition(json!({"assetsPaths":["obj/project.assets.json"]})), false);
    request["repository"]["mode"] = json!("in-place");
    let cx = Context::new("nuget-dependencies", request).unwrap();
    let error = collect(&cx).unwrap_err().to_string();
    assert!(error.contains("obj/project.assets.json is ignored by Git"), "{error}");
    assert!(error.contains("Omit inputs.assetsPaths to restore each revision"), "{error}");
}

/// A trusted context whose `dotnet restore` writes the fixture's assets where it is told to.
fn restoring(root: &Path, inputs: Value, runs: Arc<Mutex<Vec<Vec<String>>>>) -> Context {
    testing::trusted(root, definition(inputs)).with_tools(move |call| {
        runs.lock().unwrap().push(call.argv.to_vec());
        let stdout = match call.argv[1].as_str() {
            "nuget" => format!("global-packages: {}/.nuget/packages/\n", call.environment["DOTNET_CLI_HOME"]),
            "restore" => {
                let output = call
                    .argv
                    .iter()
                    .find_map(|arg| arg.strip_prefix("-p:MSBuildProjectExtensionsPath="))
                    .unwrap();
                fs::create_dir_all(output)?;
                fs::copy(ASSETS, Path::new(output).join("project.assets.json"))?;
                String::new()
            }
            other => panic!("Unexpected dotnet {other}"),
        };
        Ok(Output {
            stdout,
            stderr: String::new(),
        })
    })
}

#[test]
fn without_assets_paths_each_project_is_restored_into_a_private_folder() {
    let fixture = Fixture::new("restore");
    fixture.put("src/App/App.csproj", "<Project />");
    fixture.put("README.md", "");
    assert!(requires_trust(&json!({})));
    assert!(!requires_trust(&json!({"assetsPaths":[]})));
    let runs = Arc::default();
    let extraction = collect(&restoring(&fixture.0, json!({}), Arc::clone(&runs))).unwrap();
    assert!(labels(&extraction).contains(&"Example.Client"), "{extraction}");
    assert!(
        extraction["metadata"]["limitations"][0]
            .as_str()
            .unwrap()
            .starts_with("Each revision is restored")
    );
    let runs = runs.lock().unwrap();
    let restore = runs.iter().find(|argv| argv[1] == "restore").expect("dotnet restore ran");
    assert_eq!(restore[2], fixture.0.join("src").join("App").join("App.csproj").to_string_lossy());
    assert!(restore.contains(&"-p:RestoreRecursive=false".to_owned()), "{restore:?}");
    // Nothing is written beside the project.
    assert!(!fixture.0.join("src/App/obj").exists());
    assert!(
        fs::read_dir(&fixture.0)
            .unwrap()
            .all(|entry| { !entry.unwrap().file_name().to_string_lossy().starts_with(".projections-") })
    );
}

#[test]
fn restoring_needs_trust_and_a_revision_without_projects_has_no_packages() {
    let fixture = Fixture::new("untrusted");
    fixture.put("App.csproj", "<Project />");
    let error = collect(&testing::context(&fixture.0, definition(json!({}))))
        .unwrap_err()
        .to_string();
    assert!(error.contains("trust"), "{error}");
    let empty = Fixture::new("empty");
    empty.put("README.md", "");
    let runs = Arc::default();
    let extraction = collect(&restoring(&empty.0, json!({}), Arc::clone(&runs))).unwrap();
    assert_eq!(extraction["entities"], json!([]));
    assert!(runs.lock().unwrap().is_empty(), "nothing runs without a project");
}
