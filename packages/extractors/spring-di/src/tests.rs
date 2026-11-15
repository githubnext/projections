use super::*;
use projections_extractor_sdk::{Output, testing};
use std::sync::{Arc, Mutex};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

#[test]
fn running_the_application_requires_trust() {
    let definition = json!({"id":"beans","extractor":ID,"inputs":{"project":"app"}});
    let error = format!("{:#}", collect(&testing::context(&fixtures(), definition.clone())).unwrap_err());
    assert!(error.contains("pass --trust"), "{error}");
    assert!(requires_trust(&definition["inputs"]));
}

#[test]
fn a_pre_exported_snapshot_needs_no_trust_or_jdk() {
    let definition = json!({"id":"beans","extractor":ID,"inputs":{"snapshot":"spring.json"}});
    assert!(!requires_trust(&definition["inputs"]));
    let state = collect(&testing::context(&fixtures(), definition)).unwrap();
    assert!(
        state["entities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entity| entity["kind"] == "registration")
    );
}

#[test]
fn the_helper_is_first_party_java_source_using_only_the_jdk_and_the_applications_spring() {
    fn walk(directory: &Path, root: &Path, found: &mut Vec<String>) {
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(&path, root, found);
            } else {
                found.push(path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"));
            }
        }
    }
    let helper = Path::new(env!("CARGO_MANIFEST_DIR")).join("helper");
    let mut found = Vec::new();
    walk(&helper, &helper, &mut found);
    found.sort();
    let mut expected = SOURCES.to_vec();
    expected.sort();
    assert_eq!(found, expected, "only the helper's own sources ship");
    for source in SOURCES {
        let text = fs::read_to_string(helper.join(source)).unwrap();
        for line in text.lines().filter(|line| line.starts_with("import ")) {
            let name = line.trim_start_matches("import ").trim_start_matches("static ");
            assert!(
                name.starts_with("java.") || name.starts_with("org.springframework."),
                "{source} imports {name}"
            );
        }
    }
}

#[test]
fn builds_are_detected_and_wrappers_preferred() {
    let gradle = fixtures().join("app");
    assert_eq!(detect(&gradle), Some(Build::Gradle));
    assert_eq!(detect(&fixtures()), None);
    assert_eq!(launcher(&gradle, &gradle, "gradlew", "gradle"), "gradle");
}

#[test]
fn jdk_tools_are_the_java_home_executables() {
    let bin = Path::new("/opt/jdk").join("bin");
    assert_eq!(jdk_tool(Some("/opt/jdk"), "javac", ".exe"), bin.join("javac.exe").to_string_lossy());
    assert_eq!(jdk_tool(Some("/opt/jdk"), "java", ""), bin.join("java").to_string_lossy());
    assert_eq!(jdk_tool(None, "java", ".exe"), "java");
}

#[test]
fn argument_files_quote_every_argument() {
    assert_eq!(
        argument_file(&["-cp".into(), r#"C:\a b\"x".jar"#.into()]),
        "\"-cp\"\n\"C:\\\\a b\\\\\\\"x\\\".jar\"\n"
    );
}

/// Runs the extractor with tools that record their argv instead of running,
/// answering each like the real tool.
fn orchestrate(build: &str, java_home: Option<&'static str>) -> Vec<Vec<String>> {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../target/spring-di-unit-tests")
        .join(format!(
            "{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
    fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let runs = Arc::new(Mutex::new(Vec::new()));
    let recorded = runs.clone();
    let definition = json!({"id":"beans","extractor":ID,"inputs":{"build":build,"mainClass":"com.example.App","profiles":["demo"],"properties":{"app.mode":"x"}}});
    let environment = java_home
        .map(|home| BTreeMap::from([("JAVA_HOME".to_owned(), home.to_owned())]))
        .unwrap_or_default();
    let cx = testing::trusted(&root, definition)
        .with_environment(environment)
        .with_tools(move |call| {
            let argv = call.argv;
            recorded.lock().unwrap().push(argv.to_vec());
            let report = |prefix: &str| argv.iter().find_map(|arg| arg.strip_prefix(prefix));
            let stdout = if let Some(file) = report("-Pprojections.output=") {
                fs::write(file, "/deps/spring-core.jar:/build/classes\n/build/classes\n")?;
                String::new()
            } else if let Some(file) = report("-Dmdep.outputFile=") {
                fs::write(file, "/deps/spring-core.jar")?;
                String::new()
            } else if Path::new(&argv[0]).file_stem().is_some_and(|stem| stem == "java") {
                r#"{"protocolVersion":0,"schema":"architecture/v0","entities":[],"relationships":[]}"#.into()
            } else {
                String::new()
            };
            Ok(Output {
                stdout,
                stderr: String::new(),
            })
        });
    collect(&cx).unwrap();
    let _ = fs::remove_dir_all(&root);
    runs.lock().unwrap().clone()
}

#[test]
fn gradle_reports_the_classpath_and_the_users_jdk_compiles_and_runs_the_helper() {
    let runs = orchestrate("gradle", Some("/opt/jdk"));
    assert_eq!(runs.len(), 3, "{runs:?}");
    assert_eq!(runs[0][0], "gradle");
    for flag in ["--init-script", "--no-daemon", "projectionsClasspath"] {
        assert!(runs[0].contains(&flag.to_owned()), "{:?}", runs[0]);
    }
    let jdk = |tool: &str| {
        Path::new("/opt/jdk")
            .join("bin")
            .join(format!("{tool}{}", std::env::consts::EXE_SUFFIX))
            .to_string_lossy()
            .into_owned()
    };
    assert_eq!(runs[1][0], jdk("javac"));
    assert!(runs[1][1].starts_with('@'));
    assert_eq!(runs[2][0], jdk("java"));
}

#[test]
fn maven_compiles_and_reports_runtime_dependencies() {
    let runs = orchestrate("maven", None);
    assert_eq!(runs[0][0], "mvn");
    for flag in ["process-classes", "-Dmdep.includeScope=runtime"] {
        assert!(runs[0].contains(&flag.to_owned()), "{:?}", runs[0]);
    }
    assert_eq!([runs[1][0].as_str(), runs[2][0].as_str()], ["javac", "java"]);
}
