//! .NET: the host and design-time conventions, Roslyn and EF Core, NuGet
//! restore and API compatibility.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use projections_cli::{collectors, runtime::Runner};
use regex::Regex;
use serde_json::{Value, json};

use crate::common::{
    ECOSYSTEM_ENVIRONMENT, Scratch, api_compatibility, canonical, collect, compare, copy, count, definition, ecosystem, fixtures, items,
    modified_entities, selected, status_count, succeed, tool, tool_command, verdicts,
};

/// The helper ships prebuilt: publish it once per test run, as the Projections build does.
fn publish_dotnet_helper(dotnet: &str) {
    static PUBLISHED: std::sync::Once = std::sync::Once::new();
    PUBLISHED.call_once(|| {
        succeed(
            Command::new(tool("PROJECTIONS_NODE", "node"))
                .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("../extractors/dotnet-support/scripts/publish.mjs"))
                .env("PROJECTIONS_DOTNET_EXECUTABLE", dotnet),
        )
    });
}

/// Restores `projects` from the package feed proxy into a fresh package folder, the way CI restores
/// its own projects, then removes every package source from `root`, so extraction
/// can only use packages that are already cached.
fn prime_nuget_packages(dotnet: &str, scratch: &Path, root: &Path, projects: &[&str]) -> PathBuf {
    let packages = scratch.join("packages");
    let prime = scratch.join("prime");
    copy(root, &prime, &[]);
    for project in projects {
        let mut restore = tool_command(dotnet, &prime, &["HOME", "TMPDIR", "DOTNET_ROOT"]);
        restore
            .args([
                "restore",
                project,
                "--source",
                "https://packagefeedproxy.microsoft.io/nuget/v3/index.json",
                "--verbosity",
                "quiet",
            ])
            .env("NUGET_PACKAGES", &packages)
            .env("DOTNET_CLI_HOME", scratch.join("home"))
            .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1")
            .env("DOTNET_NOLOGO", "1");
        succeed(&mut restore);
    }
    fs::write(
        root.join("nuget.config"),
        "<configuration><packageSources><clear /></packageSources><auditSources><clear /></auditSources></configuration>\n",
    )
    .unwrap();
    packages
}

/// Applications without adapters: their hosts are discovered the way `dotnet ef`
/// discovers them, and EF Core design-time factories take precedence.
#[test]
fn native_dotnet_host_and_design_time_conventions() {
    if !selected(&["PROJECTIONS_NATIVE_DOTNET", "PROJECTIONS_NATIVE_TESTS"]) {
        return;
    }
    let dotnet = tool("PROJECTIONS_DOTNET_EXECUTABLE", "dotnet");
    publish_dotnet_helper(&dotnet);
    let scratch = Scratch::new();
    let root = &scratch.0.join("repository");
    copy(&fixtures("dotnet-support").join("hosts"), root, &["bin", "obj"]);
    let projects = [
        "GenericHost/GenericHost.csproj",
        "WebHost/WebHost.csproj",
        "MinimalHost/MinimalHost.csproj",
    ];
    let packages = prime_nuget_packages(&dotnet, &scratch.0, root, &projects);
    if let Ok(version) = std::env::var("PROJECTIONS_DOTNET_SDK_VERSION") {
        fs::write(
            root.join("global.json"),
            json!({"sdk":{"version":version,"rollForward":"latestFeature"}}).to_string(),
        )
        .unwrap();
    }
    let runner = Runner::new(root.to_owned(), true).with_executable(env!("CARGO_BIN_EXE_projections"));
    let mut values = std::collections::BTreeMap::from([("NUGET_PACKAGES".to_owned(), packages.to_string_lossy().into_owned())]);
    for name in ["HOME", "TMPDIR", "DOTNET_ROOT", "DOTNET_ROLL_FORWARD"] {
        if let Ok(value) = std::env::var(name) {
            values.insert(name.to_owned(), value);
        }
    }
    let host = runner.clone().with_variables(values);
    // Only the project: no assembly, factory or adapter.
    let collect = |id: &str, project: &str, options: Value| {
        let mut inputs = json!({"project":project,"dotnet":dotnet});
        for (key, value) in options.as_object().unwrap() {
            inputs[key] = value.clone();
        }
        let d = definition(
            id,
            inputs,
            json!({"timeoutMs":300000,"network":false,"environment":["HOME","TMPDIR","NUGET_PACKAGES","DOTNET_ROOT","DOTNET_ROLL_FORWARD"]}),
        );
        collectors::collect(root, &d, &host)
    };
    let services = |state: &Value| {
        items(state, "entities")
            .iter()
            .filter(|node| node["kind"] == "service")
            .map(|node| node["label"].as_str().unwrap().to_owned())
            .collect::<std::collections::BTreeSet<_>>()
    };
    let tables = |state: &Value| {
        items(state, "entities")
            .iter()
            .filter(|node| node["kind"] == "table")
            .map(|node| node["label"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>()
    };
    let never_started = |project: &str| {
        assert!(
            !root.join(project).join("started.txt").exists(),
            "{project}'s host must never start"
        );
    };

    // CreateHostBuilder: the host's complete collection, in the Development environment
    // by default, as `dotnet ef` uses.
    let generic = collect("dotnet-di", "GenericHost/GenericHost.csproj", json!({})).unwrap();
    let registered = services(&generic);
    for service in [
        "GenericHost.IClock",
        "GenericHost.Reporter",
        "GenericHost.IDevelopmentDiagnostics",
        "Microsoft.Extensions.Hosting.IHostApplicationLifetime",
        "Microsoft.Extensions.Hosting.IHostedService",
    ] {
        assert!(registered.contains(service), "{service} in {registered:?}");
    }
    let production = collect("dotnet-di", "GenericHost/GenericHost.csproj", json!({"environment":"Production"})).unwrap();
    assert!(!services(&production).contains("GenericHost.IDevelopmentDiagnostics"));
    let error = collect("efcore-schema", "GenericHost/GenericHost.csproj", json!({})).unwrap_err();
    assert!(format!("{error:#}").contains("More than one DbContext"), "{error:#}");
    assert_eq!(
        tables(
            &collect(
                "efcore-schema",
                "GenericHost/GenericHost.csproj",
                json!({"context":"OrdersContext"})
            )
            .unwrap()
        ),
        ["orders"]
    );
    assert_eq!(
        tables(
            &collect(
                "efcore-schema",
                "GenericHost/GenericHost.csproj",
                json!({"context":"GenericHost.AuditContext"})
            )
            .unwrap()
        ),
        ["audit_entries"]
    );
    never_started("GenericHost");

    // IDesignTimeDbContextFactory<T> takes precedence: the web host is never built.
    assert_eq!(
        tables(&collect("efcore-schema", "WebHost/WebHost.csproj", json!({})).unwrap()),
        ["products"]
    );
    assert!(!root.join("WebHost/startup-configured.txt").exists());
    // CreateWebHostBuilder: Startup.ConfigureServices registrations are included.
    let web = services(&collect("dotnet-di", "WebHost/WebHost.csproj", json!({})).unwrap());
    for service in ["WebHost.IGreeter", "Microsoft.AspNetCore.Hosting.IWebHostEnvironment"] {
        assert!(web.contains(service), "{service} in {web:?}");
    }
    assert!(root.join("WebHost/startup-configured.txt").exists());
    never_started("WebHost");

    // Minimal hosting: the entry point runs until it builds its host, despite its
    // catch-all handler; ASP.NET Core comes from the installed shared framework.
    let minimal = services(&collect("dotnet-di", "MinimalHost/MinimalHost.csproj", json!({})).unwrap());
    for service in ["MinimalHost.IGreeter", "Microsoft.AspNetCore.Hosting.IWebHostEnvironment"] {
        assert!(minimal.contains(service), "{service} in {minimal:?}");
    }
    let schema = collect("efcore-schema", "MinimalHost/MinimalHost.csproj", json!({})).unwrap();
    assert_eq!(tables(&schema), ["items"]);
    // A column's databaseType is its EF Core store type.
    for column in schema["entities"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entity| entity["kind"] == "column")
    {
        assert!(column["data"]["databaseType"].is_string(), "{column}");
        assert_eq!(column["data"]["databaseType"], column["data"]["type"], "{column}");
    }
    never_started("MinimalHost");

    // An explicit factory still overrides the conventions.
    let error = collect(
        "dotnet-di",
        "GenericHost/GenericHost.csproj",
        json!({"factoryType":"GenericHost.Program"}),
    )
    .unwrap_err();
    assert!(
        format!("{error:#}").contains("factoryType and inputs.factoryMethod together"),
        "{error:#}"
    );
}

#[test]
fn native_dotnet_roslyn_service_collection_and_ef_model_integration() {
    if !selected(&["PROJECTIONS_NATIVE_DOTNET", "PROJECTIONS_NATIVE_TESTS"]) {
        return;
    }
    let dotnet = tool("PROJECTIONS_DOTNET_EXECUTABLE", "dotnet");
    publish_dotnet_helper(&dotnet);
    let scratch = Scratch::new();
    let root = &scratch.0.join("repository");
    copy(&fixtures("dotnet-support").join("application"), root, &["bin", "obj"]);
    // Prime a package cache with only the fixture's own packages, the way CI restores
    // its project. Extraction then has no package sources: the application build
    // restores from the granted cache and the helper must need no packages at all.
    let packages = prime_nuget_packages(&dotnet, &scratch.0, root, &["Fixture.csproj"]);
    // Optionally select another installed SDK, e.g. 8.0.100, through the repository's global.json.
    if let Ok(version) = std::env::var("PROJECTIONS_DOTNET_SDK_VERSION") {
        fs::write(
            root.join("global.json"),
            json!({"sdk":{"version":version,"rollForward":"latestFeature"}}).to_string(),
        )
        .unwrap();
    }
    let cached = || {
        let mut names = fs::read_dir(&packages)
            .unwrap()
            .flat_map(|entry| {
                let entry = entry.unwrap();
                fs::read_dir(entry.path()).into_iter().flatten().map(move |version| {
                    format!(
                        "{}/{}",
                        entry.file_name().to_string_lossy(),
                        version.unwrap().file_name().to_string_lossy()
                    )
                })
            })
            .collect::<Vec<_>>();
        names.sort();
        names
    };
    let primed = cached();
    assert!(
        !primed
            .iter()
            .any(|name| name.starts_with("microsoft.codeanalysis") || name.starts_with("microsoft.build.locator")),
        "the fixture's own packages must not include the helper's"
    );
    let runner = Runner::new(root.to_owned(), true).with_executable(env!("CARGO_BIN_EXE_projections"));
    let mut values = std::collections::BTreeMap::from([("NUGET_PACKAGES".to_owned(), packages.to_string_lossy().into_owned())]);
    for name in ["HOME", "TMPDIR", "DOTNET_ROOT", "DOTNET_ROLL_FORWARD"] {
        if let Ok(value) = std::env::var(name) {
            values.insert(name.to_owned(), value);
        }
    }
    let host = runner.clone().with_variables(values);
    let collect = |id: &str, options: Value| {
        let mut inputs = json!({"project":"Fixture.csproj","dotnet":dotnet,
            "assembly":"bin/Fixture/release/Fixture.dll","factoryType":"Fixture.Composition","variant":"baseline"});
        for (key, value) in options.as_object().unwrap() {
            inputs[key] = value.clone();
        }
        let d = definition(
            id,
            inputs,
            json!({"timeoutMs":300000,"network":false,"environment":["HOME","TMPDIR","NUGET_PACKAGES","DOTNET_ROOT","DOTNET_ROLL_FORWARD"]}),
        );
        collectors::collect(root, &d, &host)
    };
    let api = collect("dotnet-public-api", json!({})).unwrap();
    let signatures = items(&api, "entities")
        .iter()
        .filter_map(|node| node["data"]["signature"].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    for pattern in [
        r"where T : class, new\(\)",
        r"Create\(System.Int32 count = 1\)",
        r"Create\(System.String name\)",
        r"where U : struct",
        r"Name \{ get; \}",
        r"public static class Fixture.Composition",
        r"public sealed class Fixture.Message : Fixture.IMessage",
        r"public enum Fixture.Status : System.Byte",
        r"public readonly record struct Fixture.Identifier",
        r"delegate TResult Fixture.Transform<in T, out TResult>\(T value\)",
        // Implemented only by the SDK's regex source generator.
        r"System.Text.RegularExpressions.Regex Fixture.Patterns.Digits\(\)",
    ] {
        assert!(Regex::new(pattern).unwrap().is_match(&signatures), "Missing {pattern}");
    }
    for hidden in ["Hidden", "secret", "PrivateNested"] {
        assert!(!signatures.contains(hidden));
    }
    assert_eq!(items(&api, "entities").iter().filter(|node| node["label"] == "Create").count(), 2);
    // The repository's own globalPackagesFolder wins over the user's folder: with an
    // empty user home and no NUGET_PACKAGES, the offline restore succeeds only from
    // the folder nuget.config names.
    let nuget = fs::read_to_string(root.join("nuget.config")).unwrap();
    fs::write(
        root.join("nuget.config"),
        nuget.replace(
            "<configuration>",
            &format!(
                "<configuration><config><add key=\"globalPackagesFolder\" value=\"{}\" /></config>",
                packages.display()
            ),
        ),
    )
    .unwrap();
    let empty_home = scratch.0.join("empty-home");
    fs::create_dir(&empty_home).unwrap();
    let mut configured = std::collections::BTreeMap::from([("HOME".to_owned(), empty_home.to_string_lossy().into_owned())]);
    for name in ["TMPDIR", "DOTNET_ROOT", "DOTNET_ROLL_FORWARD"] {
        if let Ok(value) = std::env::var(name) {
            configured.insert(name.to_owned(), value);
        }
    }
    let repository_configured = runner.clone().with_variables(configured);
    let d = definition(
        "dotnet-public-api",
        json!({"project":"Fixture.csproj","dotnet":dotnet}),
        json!({"timeoutMs":300000,"network":false,"environment":["TMPDIR","DOTNET_ROOT","DOTNET_ROLL_FORWARD"]}),
    );
    let configured_api = collectors::collect(root, &d, &repository_configured).unwrap();
    assert_eq!(canonical(&api), canonical(&configured_api));
    assert!(
        !empty_home.join(".nuget").exists(),
        "the user's default folder is not used when nuget.config names one"
    );
    fs::write(root.join("nuget.config"), nuget).unwrap();

    let source = root.join("Composition.cs");
    let before = fs::read_to_string(&source).unwrap();
    fs::write(
        &source,
        before
            .replace("secret += count", "secret += count + 17")
            .replace("private int secret = 1", "private int secret = 999"),
    )
    .unwrap();
    fs::rename(&source, root.join("Moved.cs")).unwrap();
    let unchanged = collect("dotnet-public-api", json!({})).unwrap();
    assert_eq!(
        canonical(&api),
        canonical(&unchanged),
        "bodies, private state and source moves are nonsemantic"
    );
    fs::write(
        root.join("Moved.cs"),
        before
            .replace("public T Create(int count = 1)", "public T Create(int count = 2)")
            .replace("public class PublicApi<T>", "public abstract class PublicApi<T>"),
    )
    .unwrap();
    let changed_api = collect("dotnet-public-api", json!({})).unwrap();
    let change = compare(&api, &changed_api);
    let modified = |predicate: &dyn Fn(&Value) -> bool| modified_entities(&change, &changed_api).into_iter().any(predicate);
    assert!(modified(&|after| after["kind"] == "type"));
    assert!(modified(&|after| after["label"] == "Create"));

    let di = collect("dotnet-di", json!({"factoryMethod":"Services"})).unwrap();
    let registrations: Vec<_> = items(&di, "entities")
        .iter()
        .filter(|node| node["kind"] == "registration")
        .collect();
    assert_eq!(registrations.len(), 9);
    assert_eq!(
        registrations
            .iter()
            .filter(|node| node["data"]["registrationKind"] == "factory")
            .count(),
        2
    );
    assert_eq!(
        registrations
            .iter()
            .filter(|node| node["data"]["keyed"].as_bool().unwrap_or(false) || node["data"]["keyed"].is_string())
            .count(),
        2
    );
    assert!(registrations.iter().any(|node| node["data"]["registrationKind"] == "instance"));
    assert!(registrations.iter().any(|node| {
        node["data"]["implementation"]
            .as_str()
            .is_some_and(|value| value.contains("Repository`1"))
    }));
    // Composition is only visible if constructor dependencies are resolved the way the container resolves them.
    let dependencies: Vec<_> = items(&di, "relationships")
        .iter()
        .filter(|edge| edge["kind"] == "dependsOn")
        .collect();
    let text = |value: &Value| value.as_str().unwrap_or("").to_owned();
    let greeter: Vec<_> = dependencies.iter().filter(|edge| text(&edge["from"]).contains("Greeter")).collect();
    assert_eq!(
        greeter.len(),
        5,
        "the greediest resolvable constructor wins and unregistered defaults are skipped"
    );
    assert!(greeter.iter().all(|edge| edge["confidence"] == "derived"));
    assert!(
        greeter
            .iter()
            .any(|edge| edge["data"]["parameter"] == "all" && edge["data"]["collection"] == true)
    );
    assert!(greeter.iter().any(|edge| edge["data"]["parameter"] == "message"
        && edge["data"]["collection"] == false
        && text(&edge["to"]).ends_with(":unkeyed")));
    assert!(
        greeter
            .iter()
            .any(|edge| edge["data"]["parameter"] == "blue" && text(&edge["to"]).contains("System.String:blue")),
        "keyed parameters resolve to the keyed service"
    );
    assert!(
        greeter
            .iter()
            .any(|edge| edge["data"]["parameter"] == "repository" && text(&edge["to"]).contains("IRepository`1")),
        "a closed generic parameter resolves to its open generic registration"
    );
    assert!(
        !greeter.iter().any(|edge| edge["data"]["parameter"] == "banner"),
        "an unregistered defaulted parameter is not a dependency"
    );
    assert!(
        !dependencies.iter().any(|edge| text(&edge["from"]).contains("Repository`1")),
        "an open generic implementation is not constructed"
    );
    let ids: std::collections::BTreeSet<_> = dependencies.iter().map(|edge| text(&edge["id"])).collect();
    assert_eq!(
        ids.len(),
        dependencies.len(),
        "repeated service types keep distinct edge identities"
    );
    let lifetime = collect("dotnet-di", json!({"factoryMethod":"Services","variant":"lifetime"})).unwrap();
    assert_eq!(
        status_count(&compare(&di, &lifetime), "modified"),
        1,
        "lifetime changes keep registration identity"
    );
    let asynchronous = collect("dotnet-di", json!({"factoryMethod":"AsyncServices"})).unwrap();
    assert_eq!(canonical(&di), canonical(&asynchronous));
    let parameterless = collect("dotnet-di", json!({"factoryMethod":"ParameterlessServices"})).unwrap();
    assert_eq!(count(&parameterless, "entities", "registration"), 1);

    let schema = collect("efcore-schema", json!({"factoryMethod":"Database"})).unwrap();
    assert_eq!(count(&schema, "entities", "table"), 2);
    assert!(
        items(&schema, "entities")
            .iter()
            .filter(|node| node["kind"] == "column")
            .all(|node| node["data"]["type"].is_string())
    );
    assert_eq!(count(&schema, "entities", "primary-key"), 2);
    assert!(count(&schema, "entities", "check-constraint") > 0);
    assert!(count(&schema, "entities", "index") > 0);
    assert_eq!(count(&schema, "relationships", "relation"), 1);
    assert_eq!(
        canonical(&schema),
        canonical(&collect("efcore-schema", json!({"factoryMethod":"Model"})).unwrap())
    );
    let changed = collect("efcore-schema", json!({"factoryMethod":"Database","variant":"schema"})).unwrap();
    let diff = compare(&schema, &changed);
    assert!(status_count(&diff, "added") >= 1 && status_count(&diff, "modified") >= 3);
    assert!(
        items(&changed, "entities")
            .iter()
            .any(|node| node["kind"] == "column" && node["label"] == "email")
    );
    assert_eq!(
        items(&changed, "relationships")
            .iter()
            .find(|edge| edge["kind"] == "relation")
            .unwrap()["data"]["onDelete"],
        "Restrict"
    );
    let error = collect("dotnet-di", json!({"factoryMethod":"Database"})).unwrap_err();
    assert!(format!("{error:#}").contains("Factory must return IServiceCollection"), "{error:#}");
    assert!(
        !fs::read_dir(root).unwrap().any(|entry| {
            let name = entry.unwrap().file_name();
            name == "bin" || name == "obj"
        }),
        "target stays free of build artifacts"
    );
    assert_eq!(
        cached(),
        primed,
        "extraction downloads no packages: the prebuilt helper is never restored"
    );
}

#[test]
fn native_nuget_restores_package_references_and_collects_actual_resolved_assets() {
    if !selected(&["PROJECTIONS_NATIVE_ECOSYSTEMS"]) {
        return;
    }
    let scratch = Scratch::new();
    let root = &scratch.0;
    fs::write(
        root.join("NativeNuget.csproj"),
        r#"<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup><PackageReference Include="Microsoft.Extensions.DependencyInjection" Version="8.0.1" /></ItemGroup>
</Project>
"#,
    )
    .unwrap();
    let mut restore = tool_command(&tool("PROJECTIONS_DOTNET_EXECUTABLE", "dotnet"), root, &ECOSYSTEM_ENVIRONMENT);
    restore
        .args([
            "restore",
            "NativeNuget.csproj",
            "--ignore-failed-sources",
            "--source",
            "https://packagefeedproxy.microsoft.io/nuget/v3/index.json",
            "-p:NuGetAudit=false",
            "--verbosity",
            "quiet",
        ])
        .env("DOTNET_CLI_HOME", root.join(".dotnet"))
        .env("DOTNET_SKIP_FIRST_TIME_EXPERIENCE", "1")
        .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1")
        .env("DOTNET_NOLOGO", "1");
    if let Ok(packages) = std::env::var("NUGET_PACKAGES") {
        restore.env("NUGET_PACKAGES", packages);
    }
    succeed(&mut restore);
    let state = collect(
        root,
        &ecosystem("nuget-dependencies", json!({"assetsPaths":["obj/project.assets.json"]})),
        false,
    )
    .unwrap();
    assert_eq!(state["schema"], "graph/v0");
    let find = |label: &str| {
        items(&state, "entities")
            .iter()
            .find(|node| node["label"] == label)
            .unwrap_or_else(|| panic!("Missing {label}"))
    };
    assert_eq!(find("NativeNuget")["kind"], "project");
    assert_eq!(find("net8.0")["kind"], "target-framework");
    let direct = find("Microsoft.Extensions.DependencyInjection");
    let transitive = find("Microsoft.Extensions.DependencyInjection.Abstractions");
    assert_eq!(direct["data"]["version"], "8.0.1");
    assert!(transitive["data"]["version"].as_str().unwrap().starts_with("8."));
    assert!(
        items(&state, "relationships")
            .iter()
            .any(|edge| edge["kind"] == "direct-dependency" && edge["to"] == direct["id"])
    );
    assert!(
        items(&state, "relationships")
            .iter()
            .any(|edge| edge["kind"] == "depends-on" && edge["from"] == direct["id"] && edge["to"] == transitive["id"])
    );
    assert!(!state.to_string().contains(root.to_str().unwrap()));
}

/// The api-compatibility comparator's classification of every change between two
/// real builds of a small library, with contract facts from the SDK's Roslyn.
#[test]
fn native_dotnet_api_compatibility_reproduces_apicompat_rules() {
    if !selected(&["PROJECTIONS_NATIVE_DOTNET", "PROJECTIONS_NATIVE_TESTS"]) {
        return;
    }
    let dotnet = tool("PROJECTIONS_DOTNET_EXECUTABLE", "dotnet");
    publish_dotnet_helper(&dotnet);
    let scratch = Scratch::new();
    let root = &scratch.0.join("repository");
    let fixture = fixtures("dotnet-public-api").join("compatibility");
    copy(&fixture.join("before"), root, &["bin", "obj"]);
    let packages = prime_nuget_packages(&dotnet, &scratch.0, root, &["Payments.csproj"]);
    let runner = Runner::new(root.to_owned(), true).with_executable(env!("CARGO_BIN_EXE_projections"));
    let mut values = std::collections::BTreeMap::from([("NUGET_PACKAGES".to_owned(), packages.to_string_lossy().into_owned())]);
    for name in ["HOME", "TMPDIR", "DOTNET_ROOT", "DOTNET_ROLL_FORWARD"] {
        if let Ok(value) = std::env::var(name) {
            values.insert(name.to_owned(), value);
        }
    }
    let host = runner.clone().with_variables(values);
    let collect = || {
        let d = definition(
            "dotnet-public-api",
            json!({"project":"Payments.csproj","dotnet":dotnet}),
            json!({"timeoutMs":300000,"network":false,"environment":["HOME","TMPDIR","NUGET_PACKAGES","DOTNET_ROOT","DOTNET_ROLL_FORWARD"]}),
        );
        collectors::collect(root, &d, &host).unwrap()
    };
    let before = collect();
    assert_eq!(before["metadata"]["ecosystem"], "dotnet");
    fs::copy(fixture.join("after/Payments.cs"), root.join("Payments.cs")).unwrap();
    let after = collect();
    let card = items(&before, "entities").iter().find(|entity| entity["label"] == "Card").unwrap();
    assert_eq!(
        card["data"]["contract"]["supertypes"],
        json!([{"relation": "extends", "type": "Payments.PaymentMethod"}])
    );
    assert_eq!(card["data"]["contract"].get("sealed"), None);

    let comparison = api_compatibility(&before, &after);
    let classification = &comparison["metadata"]["compatibility"];
    assert_eq!(classification["ecosystem"], "dotnet");
    let verdicts = verdicts(&comparison, &before, &after);
    for (label, level, rule) in [
        ("ChargeAsync", "breaking", "CP0006"),
        ("Name", "additive", "added"),
        ("Kind", "breaking", "CP0005"),
        ("Card", "breaking", "CP0009"),
        ("Number", "breaking", "accessor"),
        ("Failed", "breaking", "CP0011"),
        ("Refunded", "additive", "added"),
        ("MaxRetries", "breaking", "constant-value"),
        ("Pay", "breaking", "CP0017"),
        ("Refund", "breaking", "removed"),
        ("PayAsync", "additive", "added"),
        ("Wallet", "additive", "added"),
        ("Currency", "additive", "added"),
        ("Id", "compatible", "annotations"),
    ] {
        assert!(
            verdicts
                .iter()
                .any(|(found, found_level, rules)| found == label && found_level == level && rules.contains(&rule.to_owned())),
            "{label} is not {level} by {rule}: {verdicts:#?}"
        );
    }
    assert!(
        !verdicts.iter().any(|(_, level, _)| level == "unknown"),
        "every change is classified: {verdicts:#?}"
    );
    // Card.Kind overrides the new abstract member: an addition to a sealed type.
    assert!(verdicts.iter().any(|(label, level, _)| label == "Kind" && level == "additive"));

    // ApiCompat itself, the tool behind package validation, when PROJECTIONS_APICOMPAT=1
    // allows installing it (pinned) into a scratch tool path. Its findings, with the
    // two opt-in rules the comparator also applies, must be exactly the breaking
    // changes, except two it doesn't report: a constant's value (beyond ApiCompat)
    // and an enum member's value (CP0011, documented but not reported by this version).
    if std::env::var("PROJECTIONS_APICOMPAT").as_deref() != Ok("1") {
        eprintln!("PROJECTIONS_APICOMPAT is not 1; skipping the ApiCompat cross-check");
        return;
    }
    let names = ["HOME", "TMPDIR", "DOTNET_ROOT"];
    let tools = scratch.0.join("tools");
    succeed(
        tool_command(&dotnet, &scratch.0, &names)
            .args(["tool", "install", "--tool-path"])
            .arg(&tools)
            .args(["Microsoft.DotNet.ApiCompat.Tool", "--version", APICOMPAT_VERSION]),
    );
    let assembly = |side: &str| {
        let directory = scratch.0.join(format!("apicompat-{side}"));
        copy(&fixture.join(side), &directory, &["bin", "obj"]);
        succeed(
            tool_command(&dotnet, &directory, &names)
                .args(["build", "-c", "Release", "-o", "out", "-nologo", "-v", "q"])
                .env("NUGET_PACKAGES", &packages),
        );
        directory.join("out/Payments.dll")
    };
    let (left, right) = (assembly("before"), assembly("after"));
    let output = tool_command(&tools.join("apicompat").to_string_lossy(), &scratch.0, &names)
        .arg("-l")
        .arg(&left)
        .arg("-r")
        .arg(&right)
        .args(["--enable-rule-attributes-must-match", "--enable-rule-cannot-change-parameter-name"])
        .output()
        .unwrap();
    let report = String::from_utf8_lossy(&output.stdout).into_owned() + &String::from_utf8_lossy(&output.stderr);
    let mut reported: Vec<String> = report
        .lines()
        .filter(|line| line.starts_with("CP"))
        .map(|line| {
            let named = line.split('\'').nth(1).unwrap();
            let path = named.split('(').next().unwrap().rsplit(' ').next().unwrap();
            let segments: Vec<&str> = path.split('.').collect();
            let last = segments[segments.len() - 1];
            // An accessor is reported by its own name; the declaration is its property or event.
            if matches!(last, "get" | "set" | "init" | "add" | "remove") {
                segments[segments.len() - 2].to_owned()
            } else {
                last.to_owned()
            }
        })
        .chain(["Failed".to_owned(), "MaxRetries".to_owned()])
        .collect();
    reported.sort();
    reported.dedup();
    let mut breaking: Vec<String> = verdicts
        .iter()
        .filter(|(_, level, _)| level == "breaking")
        .map(|(label, ..)| label.clone())
        .collect();
    breaking.sort();
    breaking.dedup();
    assert_eq!(reported, breaking, "{report}");
}

/// Microsoft.DotNet.ApiCompat.Tool, pinned for the ApiCompat cross-check.
const APICOMPAT_VERSION: &str = "10.0.403";
