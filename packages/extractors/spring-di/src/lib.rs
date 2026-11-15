//! Spring Boot beans and the dependencies the application's own bean factory
//! resolves, read from the application context its main method builds.
//!
//! `helper/` is first-party Java source, shipped with Projections and compiled at
//! extraction time with the repository's own JDK against the application's own
//! runtime classpath, which the project's Gradle or Maven build reports. No Spring
//! (or any other library) is bundled.

use anyhow::{Context as _, Result, bail, ensure};
use projections_extractor_sdk::{
    Context, Descriptor, Scratch, Trust, execute, exported, input, object, parse_json, path, read_json, strings,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

pub const ID: &str = "spring-di";

const SCHEMA: &str = "architecture/v0";

/// The helper's sources, relative to the helper directory.
const SOURCES: [&str; 11] = [
    "projections/spring/Extractor.java",
    "projections/spring/MainClass.java",
    "projections/spring/Composition.java",
    "projections/spring/BootReports.java",
    "projections/spring/Registration.java",
    "projections/spring/DefinitionFacts.java",
    "projections/spring/Injections.java",
    "projections/spring/InjectionPoints.java",
    "projections/spring/BeanTypes.java",
    "projections/spring/RecordingBeanFactory.java",
    "projections/spring/Json.java",
];

/// The Java release the helper is compiled for: Spring Boot 3's baseline.
const RELEASE: &str = "17";

const JDK: &str = "spring-di requires the repository's JDK (17 or newer, with javac): set JAVA_HOME or put java and javac on PATH, as the project's own build does";

/// Reports the selected project's runtime classpath and class directories, and moves
/// every project's build output into the extraction's scratch directory.
const GRADLE_INIT: &str = r#"// Projections spring-di: reports the runtime classpath of the selected project.
def options = gradle.startParameter.projectProperties
def output = new File(options['projections.output'])
def buildRoot = new File(options['projections.buildRoot'])
def selected = new File(options['projections.project']).canonicalFile
gradle.allprojects { project ->
    project.layout.buildDirectory.set(new File(buildRoot, project.path == ':' ? '_root' : project.path.substring(1).replace(':', '_')))
    if (project.projectDir.canonicalFile == selected) {
        project.plugins.withId('java') {
            project.tasks.register('projectionsClasspath') { task ->
                def main = project.extensions.getByName('sourceSets').getByName('main')
                def runtime = main.runtimeClasspath
                def classes = main.output.classesDirs
                task.dependsOn(runtime)
                task.doLast {
                    output.text = runtime.files.collect { it.absolutePath }.join(File.pathSeparator) + '\n' +
                        classes.files.collect { it.absolutePath }.join(File.pathSeparator) + '\n'
                }
            }
        }
    }
}
"#;

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Spring dependency injection",
        description: "Spring Boot beans and the dependencies the application's own bean factory resolves",
        schema: SCHEMA,
        renderer: "dependency-injection",
        trust: Trust::WhenExecutingTools,
        access: projections_extractor_sdk::Access::Checkout,
        determinism: projections_extractor_sdk::Determinism::Environmental,
        inputs: json!({
            "project": "Application project directory; default the repository root",
            "build": "gradle or maven; default detected from the project",
            "mainClass": "Main class; default the one @SpringBootApplication class with a main method",
            "profiles": "Spring profiles to activate",
            "properties": "Extra Spring properties, name to value",
            "include": "application (default: beans in the application's packages and the beans they inject) or all",
            "snapshot": "Pre-exported DI state",
        }),
        template_inputs: None,
        detects: &["**/*Application.java", "**/*Application.kt"],
    }
}

pub fn requires_trust(inputs: &Value) -> bool {
    inputs.get("snapshot").is_none()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Build {
    Gradle,
    Maven,
}

fn detect(project: &Path) -> Option<Build> {
    let has = |name: &str| project.join(name).is_file();
    if ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"]
        .iter()
        .any(|name| has(name))
    {
        Some(Build::Gradle)
    } else if has("pom.xml") {
        Some(Build::Maven)
    } else {
        None
    }
}

/// The project's build wrapper (`gradlew`, `mvnw`) in the project or a parent
/// directory within the repository, or the tool on PATH.
fn launcher(root: &Path, project: &Path, wrapper: &str, tool: &str) -> String {
    let wrapper = if cfg!(windows) {
        format!("{wrapper}.cmd")
    } else {
        wrapper.to_owned()
    };
    let mut directory = Some(project);
    while let Some(current) = directory {
        let candidate = current.join(&wrapper);
        if candidate.is_file() {
            return candidate.to_string_lossy().into_owned();
        }
        if current == root {
            break;
        }
        directory = current.parent();
    }
    tool.to_owned()
}

/// A JDK tool: under `JAVA_HOME/bin`, with the platform's executable suffix, or
/// else the bare name, which the process resolves on `PATH`.
fn jdk_tool(java_home: Option<&str>, tool: &str, suffix: &str) -> String {
    match java_home {
        Some(home) => Path::new(home)
            .join("bin")
            .join(format!("{tool}{suffix}"))
            .to_string_lossy()
            .into_owned(),
        None => tool.to_owned(),
    }
}

/// One quoted argument per line of a `javac` or `java` argument file.
fn argument_file(arguments: &[String]) -> String {
    arguments
        .iter()
        .map(|argument| format!("\"{}\"\n", argument.replace('\\', "\\\\").replace('"', "\\\"")))
        .collect()
}

/// Replaces a failure to start a tool with the explicit toolchain requirement.
fn unavailable(error: anyhow::Error, executable: &str, requirement: &str) -> anyhow::Error {
    let missing = error.chain().any(|cause| {
        cause
            .downcast_ref::<std::io::Error>()
            .is_some_and(|e| matches!(e.kind(), ErrorKind::NotFound | ErrorKind::PermissionDenied))
    });
    if missing {
        error.context(format!("{requirement}; `{executable}` could not be run"))
    } else {
        error
    }
}

fn properties(d: &Value) -> Result<BTreeMap<String, String>> {
    let mut properties = BTreeMap::new();
    if let Some(value) = d["inputs"].get("properties") {
        for (name, value) in object(value, "inputs.properties")? {
            let value = value
                .as_str()
                .with_context(|| format!("inputs.properties.{name} must be a string"))?;
            ensure!(
                !name.is_empty() && !name.contains(['=', '\n']) && !value.contains('\n'),
                "inputs.properties must map property names to single-line values"
            );
            properties.insert(name.clone(), value.to_owned());
        }
    }
    if let Some(value) = d["inputs"].get("profiles") {
        let profiles = strings(value, "inputs.profiles")?;
        properties.insert("spring.profiles.active".into(), profiles.join(","));
    }
    Ok(properties)
}

/// The vocabulary every extraction declares, defined in `docs/models/dependency-injection-model.md`.
pub const VOCABULARY: &str = "dependency-injection/v0";

pub fn collect(cx: &Context) -> Result<Value> {
    let mut extraction = extract(cx)?;
    extraction["vocabularies"] = json!([VOCABULARY]);
    Ok(extraction)
}

fn extract(cx: &Context) -> Result<Value> {
    let (root, d) = (cx.root(), cx.definition());
    // A revision without the declared snapshot or project (before it was added) has no beans.
    let absent = || Ok(projections_extractor_sdk::extraction(SCHEMA, vec![], vec![], None));
    if d["inputs"].get("snapshot").is_some() {
        let snapshot = input(d, "snapshot", None)?;
        if !cx.input_exists(snapshot)? {
            return absent();
        }
        return exported(read_json(root, snapshot)?, SCHEMA);
    }
    // The main method, the build and every bean's construction are repository code.
    cx.require_trust()?;
    let relative = input(d, "project", Some("."))?;
    if !cx.input_exists(relative)? {
        return absent();
    }
    let project = path(root, relative, false, false)?;
    ensure!(project.is_dir(), "inputs.project must be the application's project directory");
    let build = match d["inputs"].get("build") {
        None => detect(&project).context(
            "No Gradle or Maven build was found in the project directory. Set inputs.project to the Spring Boot application's project, or inputs.build",
        )?,
        Some(_) => match input(d, "build", None)? {
            "gradle" => Build::Gradle,
            "maven" => Build::Maven,
            other => bail!("inputs.build must be gradle or maven, not {other}"),
        },
    };
    let include = input(d, "include", Some("application"))?;
    ensure!(
        include == "application" || include == "all",
        "inputs.include must be application or all"
    );
    let properties = properties(d)?;

    let forwarded = cx.environment(&["JAVA_HOME".into(), "GRADLE_USER_HOME".into()]);
    let env: BTreeMap<String, String> = forwarded
        .iter()
        .filter(|(name, _)| *name == "JAVA_HOME" || *name == "GRADLE_USER_HOME")
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect();
    let jdk = |tool: &str| jdk_tool(env.get("JAVA_HOME").map(String::as_str), tool, std::env::consts::EXE_SUFFIX);
    let (java, javac) = (jdk("java"), jdk("javac"));

    let helper = cx.helper("helpers/spring", Path::new(env!("CARGO_MANIFEST_DIR")).join("helper"))?;
    for source in SOURCES {
        ensure!(
            helper.join(source).is_file(),
            "This Projections distribution is missing the Spring helper source {}",
            helper.join(source).display()
        );
    }
    let scratch = Scratch::new(root, "spring")?;
    let (classpath, classes) = match build {
        Build::Gradle => gradle(root, &project, cx, &scratch.0, &env)?,
        Build::Maven => maven(root, &project, cx, &scratch.0, &env)?,
    };
    ensure!(!classpath.is_empty(), "The build reported an empty runtime classpath");
    let joined = |paths: &[PathBuf]| -> Result<String> {
        Ok(std::env::join_paths(paths)
            .context("A classpath entry contains the path separator")?
            .to_string_lossy()
            .into_owned())
    };

    // The first-party helper is compiled against the application's own Spring.
    let output = scratch.0.join("helper");
    fs::create_dir(&output)?;
    let mut arguments = vec![
        "-d".to_owned(),
        output.to_string_lossy().into_owned(),
        "--release".into(),
        RELEASE.into(),
        "-proc:none".into(),
        "-nowarn".into(),
        "-encoding".into(),
        "UTF-8".into(),
        "-cp".into(),
        joined(&classpath)?,
    ];
    arguments.extend(SOURCES.iter().map(|source| helper.join(source).to_string_lossy().into_owned()));
    let compile = scratch.0.join("javac.args");
    fs::write(&compile, argument_file(&arguments))?;
    execute(
        cx,
        &project,
        vec![javac.clone(), format!("@{}", compile.display())],
        None,
        env.clone(),
        true,
    )
    .map_err(|error| unavailable(error, &javac, JDK))
    .map_err(|error| {
        if format!("{error:#}").contains("SpringApplicationHook") {
            error.context("spring-di requires Spring Boot 3.0 or newer on the application's runtime classpath")
        } else {
            error.context("Cannot compile the Spring helper against the application's runtime classpath")
        }
    })?;

    let mut runtime = vec![output];
    runtime.extend(classpath);
    let mut arguments = vec![
        "-Dfile.encoding=UTF-8".to_owned(),
        "-Djava.awt.headless=true".into(),
        "-cp".into(),
        joined(&runtime)?,
        "projections.spring.Extractor".into(),
        "--include".into(),
        include.into(),
    ];
    for directory in classes {
        arguments.extend(["--classes".into(), directory.to_string_lossy().into_owned()]);
    }
    if d["inputs"].get("mainClass").is_some() {
        arguments.extend(["--main-class".into(), input(d, "mainClass", None)?.into()]);
    }
    if !properties.is_empty() {
        let file = scratch.0.join("properties.txt");
        fs::write(
            &file,
            properties
                .iter()
                .map(|(name, value)| format!("{name}={value}\n"))
                .collect::<String>(),
        )?;
        arguments.extend(["--properties".into(), file.to_string_lossy().into_owned()]);
    }
    let launch = scratch.0.join("java.args");
    fs::write(&launch, argument_file(&arguments))?;
    let state = execute(cx, &project, vec![java.clone(), format!("@{}", launch.display())], None, env, true)
        .map_err(|error| unavailable(error, &java, JDK))?;
    exported(parse_json(&state).context("The Spring helper did not produce valid JSON")?, SCHEMA)
}

fn split(line: Option<&str>) -> Vec<PathBuf> {
    std::env::split_paths(line.unwrap_or_default().trim())
        .filter(|path| !path.as_os_str().is_empty())
        .collect()
}

/// Builds the selected Gradle project's main classes and reads its runtime classpath.
fn gradle(
    root: &Path,
    project: &Path,
    cx: &Context,
    scratch: &Path,
    env: &BTreeMap<String, String>,
) -> Result<(Vec<PathBuf>, Vec<PathBuf>)> {
    let executable = launcher(root, project, "gradlew", "gradle");
    let init = scratch.join("projections.init.gradle");
    fs::write(&init, GRADLE_INIT)?;
    let report = scratch.join("classpath.txt");
    let argv = vec![
        executable.clone(),
        "--no-daemon".into(),
        "--quiet".into(),
        "--console=plain".into(),
        "--no-configuration-cache".into(),
        "--init-script".into(),
        init.to_string_lossy().into_owned(),
        "--project-cache-dir".into(),
        scratch.join("gradle").to_string_lossy().into_owned(),
        format!("-Pprojections.output={}", report.display()),
        format!("-Pprojections.buildRoot={}", scratch.join("build").display()),
        format!("-Pprojections.project={}", project.display()),
        "projectionsClasspath".into(),
    ];
    execute(cx, project, argv, None, env.clone(), true)
        .map_err(|error| {
            unavailable(
                error,
                &executable,
                "spring-di runs the project's Gradle build: commit the Gradle wrapper (gradlew) or put gradle on PATH",
            )
        })
        .context("The project's Gradle build failed. inputs.project must be the Spring Boot application's project, which applies the java plugin")?;
    let text = fs::read_to_string(&report).context("Gradle did not report the runtime classpath")?;
    let mut lines = text.lines();
    Ok((split(lines.next()), split(lines.next())))
}

/// Compiles the Maven project and reads its runtime classpath.
fn maven(
    root: &Path,
    project: &Path,
    cx: &Context,
    scratch: &Path,
    env: &BTreeMap<String, String>,
) -> Result<(Vec<PathBuf>, Vec<PathBuf>)> {
    let executable = launcher(root, project, "mvnw", "mvn");
    let report = scratch.join("classpath.txt");
    let argv = vec![
        executable.clone(),
        "--batch-mode".into(),
        "--quiet".into(),
        "-f".into(),
        project.join("pom.xml").to_string_lossy().into_owned(),
        "-Dmaven.test.skip=true".into(),
        format!("-Dmdep.outputFile={}", report.display()),
        "-Dmdep.includeScope=runtime".into(),
        "process-classes".into(),
        "dependency:build-classpath".into(),
    ];
    execute(cx, project, argv, None, env.clone(), true)
        .map_err(|error| {
            unavailable(
                error,
                &executable,
                "spring-di runs the project's Maven build: commit the Maven wrapper (mvnw) or put mvn on PATH",
            )
        })
        .context("The project's Maven build failed")?;
    let text = fs::read_to_string(&report).context("Maven did not report the runtime classpath")?;
    // The project's own classes come first, as Spring Boot's launcher orders them.
    let classes = project.join("target").join("classes");
    let mut classpath = vec![classes.clone()];
    classpath.extend(split(Some(&text)));
    Ok((classpath, vec![classes]))
}

#[cfg(test)]
mod tests;
