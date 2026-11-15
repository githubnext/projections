/// An absolute path to a fake `dotnet` on this platform.
const FAKE_DOTNET: &str = if cfg!(windows) {
    r"C:\dotnet\dotnet.exe"
} else {
    "/opt/dotnet/dotnet"
};

use super::*;
use projections_extractor_sdk::{Output, testing};
use serde_json::json;
use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::sync::{Arc, Mutex};

const CONTRACT: Contract = Contract {
    id: "dotnet-public-api",
    schema: "api/v0",
    composition: false,
    validate: |_| Ok(()),
};

type Environment = BTreeMap<String, String>;

/// Records argv instead of running tools; `assets` simulates an installed layout.
struct Fake {
    assets: Option<PathBuf>,
    missing: bool,
    runs: Arc<Mutex<Vec<Vec<String>>>>,
    environments: Arc<Mutex<Vec<Environment>>>,
    /// The variables the definition grants and this process received.
    user: Environment,
    /// What `dotnet nuget locals` reports when the repository configures a folder.
    repository_packages: Option<String>,
    msbuild: &'static str,
}

impl Fake {
    fn new(assets: Option<PathBuf>, missing: bool) -> Self {
        Self {
            assets,
            missing,
            runs: Arc::default(),
            environments: Arc::default(),
            user: BTreeMap::new(),
            repository_packages: None,
            msbuild: "17.11.48.46605",
        }
    }

    fn runs(&self) -> Vec<Vec<String>> {
        self.runs.lock().unwrap().clone()
    }

    fn environments(&self) -> Vec<Environment> {
        self.environments.lock().unwrap().clone()
    }

    /// A trusted context granting `user`, with this fake's helpers and tools.
    fn context(&self, root: &Path, mut definition: Value) -> Context {
        definition["execution"] = json!({"environment": self.user.keys().collect::<Vec<_>>()});
        let assets = self.assets.clone();
        let (runs, environments) = (self.runs.clone(), self.environments.clone());
        let (missing, msbuild) = (self.missing, self.msbuild);
        let repository_packages = self.repository_packages.clone();
        testing::trusted(root, definition)
            .with_environment(self.user.clone())
            .with_helpers(move || Ok(assets.clone()))
            .with_tools(move |call| {
                let (argv, environment) = (call.argv, call.environment);
                runs.lock().unwrap().push(argv.to_vec());
                environments.lock().unwrap().push(environment.clone());
                if missing {
                    return Err(
                        anyhow::Error::new(std::io::Error::from(ErrorKind::NotFound)).context(format!("Could not start {}", argv[0]))
                    );
                }
                let stdout = match argv.get(1).map(String::as_str) {
                    Some("msbuild") => format!("MSBuild version {msbuild}\n{msbuild}\n"),
                    Some("nuget") => format!(
                        "global-packages: {}/\n",
                        repository_packages.clone().unwrap_or_else(|| {
                            Path::new(&environment["DOTNET_CLI_HOME"])
                                .join(".nuget/packages")
                                .to_string_lossy()
                                .into_owned()
                        })
                    ),
                    Some("build") => {
                        let results = r#"{"Properties":{},"Items":{}}"#;
                        match argv.iter().find_map(|arg| arg.strip_prefix("-getResultOutputFile:")) {
                            Some(file) => {
                                fs::write(file, results)?;
                                "Build succeeded.".into()
                            }
                            None => results.into(),
                        }
                    }
                    _ => r#"{"protocolVersion":0,"schema":"api/v0","entities":[],"relationships":[],"metadata":{}}"#.into(),
                };
                Ok(Output {
                    stdout,
                    stderr: String::new(),
                })
            })
    }
}

struct Fixture(PathBuf);

impl Fixture {
    fn new(name: &str) -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../target/dotnet-support-unit-tests")
            .join(format!("{name}-{}-{}", std::process::id(), {
                static SEQUENCE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
                SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            }));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("repository")).unwrap();
        fs::write(root.join("repository/App.csproj"), "<Project />").unwrap();
        Self(root)
    }
    fn collect(&self, fake: &Fake) -> Result<Value> {
        let definition = json!({"id":"api","extractor":"dotnet-public-api",
                "inputs":{"project":"App.csproj","dotnet":FAKE_DOTNET}});
        collect(&fake.context(&self.0.join("repository"), definition), &CONTRACT)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn installed_helper_runs_prebuilt_without_restoring_or_building_it() {
    let fixture = Fixture::new("installed");
    let helper = fixture.0.join("collectors/helpers/dotnet");
    fs::create_dir_all(&helper).unwrap();
    fs::write(helper.join(HELPER), "").unwrap();
    let fake = Fake::new(Some(fixture.0.join("collectors")), false);
    fixture.collect(&fake).unwrap();
    let runs = fake.runs();
    let commands = runs.iter().map(|argv| argv[1].as_str()).collect::<Vec<_>>();
    assert_eq!(commands[1..], ["msbuild", "build", commands[3]], "{runs:?}");
    assert_eq!(commands[0], "nuget");
    let build = &runs[2];
    assert!(build[2].ends_with("App.csproj"));
    assert!(
        DESIGN_TIME.iter().all(|flag| build.contains(&flag.to_string())),
        "the public API build reports its compiler invocation: {build:?}"
    );
    assert_eq!(
        runs[3],
        [
            FAKE_DOTNET.to_owned(),
            fixture
                .0
                .join("collectors")
                .join("helpers/dotnet")
                .join(HELPER)
                .to_string_lossy()
                .into_owned()
        ]
    );
    assert!(
        !runs
            .iter()
            .flatten()
            .any(|arg| arg.contains("Projections.Dotnet.csproj") || arg == "restore" || arg == "publish")
    );
}

fn installed(name: &str) -> Fixture {
    let fixture = Fixture::new(name);
    let helper = fixture.0.join("collectors/helpers/dotnet");
    fs::create_dir_all(&helper).unwrap();
    fs::write(helper.join(HELPER), "").unwrap();
    fixture
}

#[test]
fn composition_needs_only_the_project_and_pairs_factory_inputs() {
    const COMPOSITION_CONTRACT: Contract = Contract {
        id: "dotnet-di",
        // The fake helper output's schema; only the orchestration is under test.
        schema: "api/v0",
        composition: true,
        validate: |_| Ok(()),
    };
    let fixture = installed("composition");
    let fake = Fake::new(Some(fixture.0.join("collectors")), false);
    let collect = |inputs: Value| {
        let definition = json!({"id":"services","extractor":"dotnet-di","inputs":inputs});
        collect(&fake.context(&fixture.0.join("repository"), definition), &COMPOSITION_CONTRACT)
    };
    collect(json!({"project":"App.csproj","dotnet":FAKE_DOTNET})).unwrap();
    let runs = fake.runs();
    let build = runs.iter().find(|argv| argv[1] == "build").unwrap();
    assert!(
        COMPOSITION.iter().all(|flag| build.contains(&flag.to_string())),
        "the application build reports its assembly: {build:?}"
    );
    assert!(!build.iter().any(|arg| arg.starts_with("-getItem")));
    assert!(
        !runs.iter().any(|argv| argv[1] == "msbuild"),
        "small property results stay on stdout"
    );
    let error = format!(
        "{:#}",
        collect(json!({"project":"App.csproj","factoryType":"App.Adapter"})).unwrap_err()
    );
    assert!(error.contains("together, or neither"), "{error}");
    let error = format!(
        "{:#}",
        collect(json!({"factoryType":"App.Adapter","factoryMethod":"Services"})).unwrap_err()
    );
    assert!(error.contains("inputs.assembly"), "{error}");
}

/// The build's NUGET_PACKAGES, if any, and whether NuGet was asked about the repository.
fn restore_packages(user: &[(&str, &str)], repository: Option<&str>) -> (Option<String>, bool) {
    let fixture = installed("packages");
    let mut fake = Fake::new(Some(fixture.0.join("collectors")), false);
    fake.user = user.iter().map(|(name, value)| (name.to_string(), value.to_string())).collect();
    fake.repository_packages = repository.map(str::to_owned);
    fixture.collect(&fake).unwrap();
    let runs = fake.runs();
    let environments = fake.environments();
    let build = runs.iter().position(|argv| argv[1] == "build").unwrap();
    assert_eq!(
        environments[build].get("HOME").map(String::as_str),
        user.iter().find(|(name, _)| *name == "HOME").map(|(_, value)| *value),
        "HOME reaches the build only as granted"
    );
    (
        environments[build].get("NUGET_PACKAGES").cloned(),
        runs.iter().any(|argv| argv[1] == "nuget"),
    )
}

#[test]
fn application_restores_reuse_the_users_nuget_packages_folder() {
    let home = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let users = Path::new("/users/me")
        .join(".nuget")
        .join("packages")
        .to_string_lossy()
        .into_owned();
    assert_eq!(restore_packages(&[(home, "/users/me")], None), (Some(users), true));
    assert_eq!(
        restore_packages(&[(home, "/users/me"), ("DOTNET_CLI_HOME", "/cli")], None),
        (
            Some(Path::new("/cli").join(".nuget").join("packages").to_string_lossy().into_owned()),
            true
        )
    );
    let (isolated, _) = restore_packages(&[], None);
    assert!(isolated.unwrap().contains(".projections-dotnet-"));
}

#[test]
fn the_repositorys_nuget_configuration_wins_over_the_users_folder() {
    let home = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    // nuget.config sets globalPackagesFolder: NuGet chooses, so nothing is set.
    assert_eq!(restore_packages(&[(home, "/users/me")], Some("/repository/packages")), (None, true));
    // An explicit NUGET_PACKAGES overrides configuration, as in NuGet itself.
    assert_eq!(
        restore_packages(
            &[(home, "/users/me"), ("NUGET_PACKAGES", "/ci/nuget")],
            Some("/repository/packages")
        ),
        (Some("/ci/nuget".into()), false)
    );
}

#[test]
fn compiler_arguments_go_to_a_file_where_msbuild_supports_it() {
    for (msbuild, to_file) in [("17.11.48.46605", true), ("17.8.43.35803", false)] {
        let fixture = installed("results");
        let mut fake = Fake::new(Some(fixture.0.join("collectors")), false);
        fake.msbuild = msbuild;
        fixture.collect(&fake).unwrap();
        let runs = fake.runs();
        let build = runs.iter().find(|argv| argv[1] == "build").unwrap();
        assert_eq!(
            build.iter().any(|arg| arg.starts_with("-getResultOutputFile:")),
            to_file,
            "MSBuild {msbuild}: {build:?}"
        );
        let helper = fake.environments().pop().unwrap();
        assert!(helper["PROJECTIONS_DOTNET_BUILD"].ends_with("build.json"));
    }
}

#[test]
fn distribution_without_the_prebuilt_helper_fails_explicitly() {
    let fixture = Fixture::new("incomplete");
    fs::create_dir_all(fixture.0.join("collectors/helpers")).unwrap();
    let fake = Fake::new(Some(fixture.0.join("collectors")), false);
    let error = format!("{:#}", fixture.collect(&fake).unwrap_err());
    assert!(error.contains("built without the prebuilt .NET helper"), "{error}");
    assert!(fake.runs().is_empty());
}

#[test]
fn missing_dotnet_reports_the_runtime_requirement() {
    let fixture = Fixture::new("missing");
    let helper = fixture.0.join("collectors/helpers/dotnet");
    fs::create_dir_all(&helper).unwrap();
    fs::write(helper.join(HELPER), "").unwrap();
    let fake = Fake::new(Some(fixture.0.join("collectors")), true);
    let error = format!("{:#}", fixture.collect(&fake).unwrap_err());
    assert!(
        error.contains(".NET extraction requires the repository's .NET SDK (8.0 or newer)"),
        "{error}"
    );
}
