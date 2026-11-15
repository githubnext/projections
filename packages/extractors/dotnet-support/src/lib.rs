//! Shared .NET helper and build orchestration for `dotnet-public-api`,
//! `dotnet-di` and `efcore-schema`.
//!
//! `helper/` is the slim `Projections.Dotnet` program that reads the requested
//! state. It ships no third-party code: it borrows Roslyn from the SDK that built
//! the project and reads dependency injection and EF Core from the application's
//! own assemblies. It is published once when Projections is built and ships
//! prebuilt (framework-dependent, .NET 8 or newer); extraction runs it with the
//! repository's own `dotnet` and never restores or builds it.

use anyhow::{Context as _, Result, ensure};
use projections_extractor_sdk::{Context, Scratch, exported, extraction, input, parse_json, path, read_json, relative_path};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

mod toolchain;
pub use toolchain::Dotnet;

/// The prebuilt helper's entry assembly, run as `dotnet Projections.Dotnet.dll`.
const HELPER: &str = "Projections.Dotnet.dll";

/// Where `scripts/publish.mjs` writes the helper in a source checkout.
const SOURCE_PUBLISH: &str = "helper/publish";

/// MSBuild switches (17.8+, .NET SDK 8.0.100+) that make the project's real build
/// report its compiler invocation as JSON on stdout.
const DESIGN_TIME: [&str; 5] = [
    "-t:Build",
    "-p:ProvideCommandLineArgs=true",
    "-getItem:CscCommandLineArgs",
    "-getProperty:RoslynTargetsPath",
    "-getProperty:MSBuildProjectDirectory",
];

/// MSBuild switches that make an application build report its output assembly and
/// project directory, used by the host and design-time conventions.
const COMPOSITION: [&str; 3] = ["-t:Build", "-getProperty:TargetPath", "-getProperty:MSBuildProjectDirectory"];

/// The largest MSBuild results file the helper reads.
const MAX_BUILD_RESULTS: u64 = 256 * 1024 * 1024;

/// Whether the selected SDK's MSBuild supports `-getResultOutputFile` (MSBuild 17.10,
/// .NET SDK 8.0.300). Older SDKs report results on stdout.
fn results_to_file(cx: &Context, cwd: &Path, dotnet: &Dotnet) -> Result<bool> {
    let output = dotnet.run(cx, cwd, vec!["msbuild".into(), "-version".into(), "-nologo".into()], None)?;
    let version = output.lines().last().unwrap_or_default().trim();
    let mut parts = version.split('.').map(|part| part.parse::<u32>());
    Ok(match (parts.next(), parts.next()) {
        (Some(Ok(major)), Some(Ok(minor))) => (major, minor) >= (17, 10),
        _ => false,
    })
}

/// What one .NET extractor produces from the shared helper.
pub struct Contract {
    pub id: &'static str,
    pub schema: &'static str,
    /// Composition extractors load a factory from an assembly instead of compiling a public API.
    pub composition: bool,
    pub validate: fn(&Value) -> Result<()>,
}

pub fn requires_trust(inputs: &Value) -> bool {
    inputs.get("snapshot").is_none()
}

pub fn collect(cx: &Context, contract: &Contract) -> Result<Value> {
    let (root, d) = (cx.root(), cx.definition());
    let parse = |value| -> Result<Value> {
        let value = exported(value, contract.schema)?;
        (contract.validate)(&value)?;
        Ok(value)
    };
    // A revision without the declared snapshot, project or assembly (before it was
    // added) describes nothing.
    let absent = || parse(extraction(contract.schema, vec![], vec![], None));
    if d["inputs"].get("snapshot").is_some() {
        let snapshot = input(d, "snapshot", None)?;
        if !cx.input_exists(snapshot)? {
            return absent();
        }
        return parse(read_json(root, snapshot)?);
    }
    cx.require_trust()?;
    // Validates inputs.dotnet before anything else runs.
    Dotnet::executable(cx)?;
    let configuration = input(d, "configuration", Some("Release"))?;
    if d["inputs"].get("project").is_some() && !cx.input_exists(input(d, "project", None)?)? {
        return absent();
    }
    let project = d["inputs"]
        .get("project")
        .map(|_| path(root, input(d, "project", None)?, false, false))
        .transpose()?;
    ensure!(contract.composition || project.is_some(), "{} requires inputs.project", contract.id);
    if contract.composition {
        // With a project, the assembly defaults to the build's $(TargetPath).
        if project.is_none() || d["inputs"].get("assembly").is_some() {
            let assembly = input(d, "assembly", None)?;
            if project.is_some() {
                relative_path(assembly)?;
            } else {
                if !cx.input_exists(assembly)? {
                    return absent();
                }
                path(root, assembly, false, false)?;
            }
        }
        // Without an explicit factory, the helper uses the application's own host
        // (and, for EF Core, design-time factories), as `dotnet ef` does.
        let factory = ["factoryType", "factoryMethod"].map(|name| d["inputs"].get(name).is_some());
        ensure!(
            factory[0] == factory[1],
            "{} requires inputs.factoryType and inputs.factoryMethod together, or neither to use the application's host",
            contract.id
        );
        if factory[0] {
            input(d, "factoryType", None)?;
            input(d, "factoryMethod", None)?;
        }
        for name in ["context", "environment"] {
            if d["inputs"].get(name).is_some() {
                input(d, name, None)?;
            }
        }
    }
    let helper = helper(cx)?;
    let scratch = Scratch::new(root, "dotnet")?;
    let artifacts = scratch.0.join("application");
    fs::create_dir(&artifacts)?;
    let mut dotnet = Dotnet::new(cx, &scratch.0)?;
    let flags = [
        "-p:UseSharedCompilation=false",
        "-nodeReuse:false",
        "--disable-build-servers",
        "--nologo",
        "--verbosity",
        "quiet",
    ];
    if let Some(project) = project {
        dotnet.use_packages(cx, project.parent().unwrap_or(root), &scratch.0)?;
        let mut argv = vec![
            "build".into(),
            project.to_string_lossy().into_owned(),
            "--artifacts-path".into(),
            artifacts.to_string_lossy().into_owned(),
            "--configuration".into(),
            configuration.into(),
            "-p:CopyLocalLockFileAssemblies=true".into(),
        ];
        argv.extend(flags.iter().map(|s| s.to_string()));
        if d["inputs"].get("framework").is_some() {
            argv.extend(["--framework".into(), input(d, "framework", None)?.into()]);
        }
        // The successful build reports what the helper needs as JSON: for the public
        // API, its exact csc arguments and compiler location, which the helper replays
        // with that SDK's Roslyn instead of re-evaluating MSBuild.
        let reported: &[&str] = if contract.composition { &COMPOSITION } else { &DESIGN_TIME };
        argv.extend(reported.iter().map(|s| s.to_string()));
        let build = scratch.0.join("build.json");
        // The compiler arguments grow with the project; where MSBuild can write them
        // to a file, they are not bounded by the tool stdout limit.
        let to_file = !contract.composition && results_to_file(cx, root, &dotnet)?;
        if to_file {
            argv.push(format!("-getResultOutputFile:{}", build.display()));
        }
        let output = dotnet.run(cx, root, argv, None)?;
        if to_file {
            let size = fs::symlink_metadata(&build)
                .ok()
                .filter(|metadata| metadata.is_file())
                .map(|metadata| metadata.len())
                .context("MSBuild did not write the requested build results")?;
            ensure!(size <= MAX_BUILD_RESULTS, "MSBuild build results exceed {MAX_BUILD_RESULTS} bytes");
        } else {
            fs::write(&build, output)?;
        }
        dotnet
            .env
            .insert("PROJECTIONS_DOTNET_BUILD".into(), build.to_string_lossy().into_owned());
    }
    dotnet
        .env
        .insert("PROJECTIONS_DOTNET_ARTIFACTS".into(), artifacts.to_string_lossy().into_owned());
    let request = serde_json::to_string(&cx.request())?;
    // The prebuilt framework-dependent helper runs directly on the repository's
    // own .NET installation; it is never restored or built here.
    let output = dotnet.run(cx, root, vec![helper.to_string_lossy().into_owned()], Some(&request))?;
    parse(parse_json(&output)?)
}

/// The prebuilt helper entry assembly: `collectors/helpers/dotnet` in an
/// installed distribution, or the published output in a source checkout.
fn helper(cx: &Context) -> Result<PathBuf> {
    let installed = cx.helper_directory()?.is_some();
    let directory = cx.helper("helpers/dotnet", Path::new(env!("CARGO_MANIFEST_DIR")).join(SOURCE_PUBLISH))?;
    let helper = directory.join(HELPER);
    if installed {
        ensure!(
            helper.is_file(),
            "This Projections distribution was built without the prebuilt .NET helper ({} is missing). Install a complete distribution, or rebuild Projections with the .NET 8 SDK available; extraction never builds or restores the helper",
            helper.display()
        );
    } else {
        ensure!(
            helper.is_file(),
            "The prebuilt .NET helper is missing from this source checkout ({}). Publish it explicitly with `node packages/extractors/dotnet-support/scripts/publish.mjs` (requires the .NET 8 SDK and NuGet access once); extraction never builds or restores the helper",
            helper.display()
        );
    }
    Ok(helper)
}

#[cfg(test)]
mod tests;
