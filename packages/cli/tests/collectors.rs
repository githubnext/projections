use projections_cli::{artifact, collectors, runtime::Runner};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let parent = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/collector-tests");
        fs::create_dir_all(&parent).unwrap();
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        for attempt in 0..100 {
            let root = parent.join(format!("{}-{stamp}-{attempt}", std::process::id()));
            match fs::create_dir(&root) {
                Ok(()) => return Self(root),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("Cannot allocate collector fixture: {error}"),
            }
        }
        panic!("Cannot allocate unique collector fixture")
    }
    fn put(&self, filename: &str, content: &str) {
        let p = self.0.join(filename);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }
    fn json(&self, filename: &str, value: Value) {
        self.put(filename, &serde_json::to_string(&value).unwrap());
    }
    fn collect(&self, id: &str, inputs: Value) -> anyhow::Result<Value> {
        collectors::collect(
            &self.0,
            &definition(id, inputs),
            &Runner::new(self.0.clone(), false).with_executable(env!("CARGO_BIN_EXE_projections")),
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn definition(id: &str, inputs: Value) -> Value {
    json!({"id":"fixture","extractor":id,"renderer":"graph","inputs":inputs})
}

fn fixtures(id: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../extractors")
        .join(id)
        .join("tests/fixtures")
        .canonicalize()
        .unwrap()
}

fn ecosystem(id: &str, inputs: Value) -> Value {
    let root = fixtures(id);
    collectors::collect(
        &root,
        &definition(id, inputs),
        &Runner::new(root.clone(), false).with_executable(env!("CARGO_BIN_EXE_projections")),
    )
    .unwrap()
}

#[test]
fn catalog_advertises_all_independent_contracts_and_default_selection() {
    let catalog = collectors::catalog();
    let entries = catalog["extractors"].as_array().unwrap();
    assert_eq!(entries.len(), collectors::IDS.len());
    for (id, entry) in collectors::IDS.iter().zip(entries) {
        assert_eq!(entry["id"], *id);
        assert!(entry.get("persistentCache").is_none());
        let validated = artifact::validate_definition(&entry["template"]).unwrap();
        assert_eq!(validated["extractor"], *id);
        assert!(entry["inputs"].is_object());
    }
    let defaults = collectors::default_definitions();
    assert_eq!(defaults.len(), 2);
    assert_eq!(defaults[0]["extractor"], "workspace-dependencies");
    assert_eq!(defaults[1]["extractor"], "repository-map");
    assert!(collectors::requires_trust(&definition("cargo-dependencies", json!({}))));
    assert!(!collectors::requires_trust(&definition(
        "cargo-dependencies",
        json!({"metadataPath":"metadata.json"})
    )));
    assert!(!collectors::requires_trust(&definition(
        "django-schema",
        json!({"snapshot":"schema.json"})
    )));
    assert!(collectors::requires_trust(
        &json!({"extractor":{"command":["python3","custom.py"]}})
    ));
}

#[test]
fn native_manifest_workspace_graph_preserves_ids_and_authoritative_evidence() {
    let fixture = Fixture::new();
    fixture.json(
        "package.json",
        json!({"name":"root","workspaces":{"packages":["packages/*","!packages/ignored"]}}),
    );
    fixture.json(
        "packages/api/package.json",
        json!({"name":"@example/api","dependencies":{"shared":"workspace:*","external":"^1.2.3"}}),
    );
    fixture.json(
        "packages/shared/package.json",
        json!({"name":"shared","devDependencies":{"external":"~1.0"}}),
    );
    fixture.json("packages/ignored/package.json", json!({"name":"ignored"}));
    let state = fixture.collect("workspace-dependencies", json!({})).unwrap();
    assert_eq!(state["entities"].as_array().unwrap().len(), 4);
    let api = state["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["label"] == "@example/api")
        .unwrap();
    assert_eq!(api["id"], "workspace:@example/api");
    assert_eq!(api["evidence"][0]["source"], "packages/api/package.json");
    let dependency = state["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["to"] == "package:external" && e["from"] == "workspace:@example/api")
        .unwrap();
    assert_eq!(dependency["id"], "dependency:[\"@example/api\",\"dependencies\",\"external\"]");
    assert_eq!(dependency["data"], json!({"type":"dependencies","version":"^1.2.3"}));
    assert_eq!(dependency["confidence"], "authoritative");
    fixture.json("packages/shared/package.json", json!({"name":"@example/api"}));
    assert!(fixture.collect("workspace-dependencies", json!({})).is_err());
}

#[test]
fn repository_map_is_native_and_globs_match_original_grammar() {
    let fixture = Fixture::new();
    fixture.put("src/app.ts", "const a = 1;\n");
    fixture.put("src/deep/lib.ts", "export {};\n");
    fixture.put("README.md", "hello\n");
    fixture.put("src/[literal].ts", "[]\n");
    let state = fixture
        .collect("repository-map", json!({"include":["src/**/*.ts"],"exclude":["**/deep/**"]}))
        .unwrap();
    assert_eq!(state["entities"].as_array().unwrap().len(), 4);
    assert!(
        state["entities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == "file:src/app.ts" && n["data"]["size"] == 13)
    );
    let literal = fixture.collect("repository-map", json!({"include":["src/[literal].ts"]})).unwrap();
    assert_eq!(literal["entities"].as_array().unwrap().len(), 3);
    let file = |state: &Value, id: &str| state["entities"].as_array().unwrap().iter().find(|n| n["id"] == id).unwrap()["data"].clone();
    assert!(file(&state, "file:src/app.ts").get("lines").is_none());
    fixture.put("bin/blob.dat", "a\0b");
    fixture.put("notes.txt", "one\ntwo");
    let counted = fixture.collect("repository-map", json!({"lines":true})).unwrap();
    assert_eq!(file(&counted, "file:README.md"), json!({"path":"README.md","size":6,"lines":1}));
    assert_eq!(file(&counted, "file:notes.txt")["lines"], 2);
    assert!(file(&counted, "file:bin/blob.dat").get("lines").is_none());
    assert!(fixture.collect("repository-map", json!({"lines":"yes"})).is_err());
}

#[test]
fn statistics_preserve_physical_counts_language_overrides_and_skipped_metadata() {
    let fixture = Fixture::new();
    fixture.put("src/app.rs", "// note\nlet url = \"//\";\n\n/* outer\n/* inner */\n*/\n");
    fixture.put("node_modules/ignored.ts", "let x = 1;\n");
    fixture.put("unknown.unknownext", "not measured\n");
    fixture.put("custom.xyz", "{\"marker\":\"//\"}\n");
    fixture.put("binary.py", "a\0b");
    let state = fixture.collect("code-statistics", json!({"languages":{".xyz":"JSON"}})).unwrap();
    let rust = state["entities"].as_array().unwrap().iter().find(|n| n["label"] == "Rust").unwrap();
    assert_eq!(
        rust["data"],
        json!({"language":"Rust","files":1,"code":1,"comment":4,"blank":1,"lines":6,
        "bytes":49,"testFiles":0,"testCode":0,"testComment":0,"testBlank":0,"testLines":0,
        "value":1,"unit":"lines of code"})
    );
    assert_eq!(
        state["metadata"]["skipped"],
        json!({"unrecognized":1,"binary":1,"oversize":0,"unreadable":0})
    );
    assert_eq!(rust["evidence"][0]["source"], "src/app.rs");
    assert!(fixture.collect("code-statistics", json!({"languages":{".x":"Made Up"}})).is_err());
}

#[test]
fn data_only_ecosystem_collectors_consume_existing_native_export_fixtures() {
    let cargo = ecosystem("cargo-dependencies", json!({"metadataPath":"cargo-metadata.json"}));
    assert_eq!(cargo["entities"].as_array().unwrap().len(), 2);
    assert_eq!(cargo["relationships"].as_array().unwrap().len(), 1);
    assert_eq!(cargo["relationships"][0]["data"]["name"], "example_support");
    assert!(!cargo.to_string().contains("/fixture/checkout"));
    let nuget = ecosystem("nuget-dependencies", json!({"assetsPaths":["nuget/project.assets.json"]}));
    assert_eq!(
        nuget["entities"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|n| n["kind"] == "target-framework")
            .count(),
        3
    );
    assert!(
        nuget["relationships"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "direct-dependency")
    );
    let terraform = ecosystem("terraform-infrastructure", json!({"planJsonPath":"terraform-1.14-plan.json"}));
    assert!(!terraform.to_string().contains("native-secret-never-persist"));
    assert!(terraform.to_string().contains("(sensitive value)"));
    assert!(terraform.to_string().contains("(known after apply)"));
    let azure = ecosystem(
        "azure-what-if",
        json!({"whatIfJsonPath":"head/what-if.json","templateJsonPath":"head/main.json"}),
    );
    assert!(azure["entities"].as_array().unwrap().iter().any(|e| e["kind"] == "resource-group"));
    let terraform = ecosystem("terraform-infrastructure", json!({"planJsonPath":"aws/head.plan.json"}));
    assert!(
        terraform["relationships"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "references")
    );
}

#[test]
fn github_actions_jobs_are_the_declared_needs_graph() {
    let jobs = ecosystem("github-actions-jobs", json!({"workflowPath":"workflow.yml"}));
    let labels: Vec<_> = jobs["entities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["label"].as_str().unwrap())
        .collect();
    assert_eq!(labels, ["Build packages", "lint", "publish"]);
    let edges: Vec<_> = jobs["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["from"].as_str().unwrap(), e["to"].as_str().unwrap()))
        .collect();
    assert_eq!(edges, [("job:build", "job:publish"), ("job:lint", "job:publish")]);
    assert_eq!(jobs["entities"][0]["evidence"][0]["source"], "workflow.yml");
    assert!(!collectors::requires_trust(&definition(
        "github-actions-jobs",
        json!({"workflowPath":"workflow.yml"})
    )));
}

#[test]
fn github_actions_jobs_reject_malformed_yaml_dangling_needs_and_cycles() {
    let fixture = Fixture::new();
    let error = |workflow: &str| {
        fixture.put("workflow.yml", workflow);
        format!(
            "{:#}",
            fixture
                .collect("github-actions-jobs", json!({"workflowPath":"workflow.yml"}))
                .unwrap_err()
        )
    };
    for (workflow, expected) in [
        ("jobs:\n  a: {\n", "Invalid YAML in workflow.yml"),
        ("jobs:\n  a: {}\n  a: {}\n", "Duplicate YAML key"),
        ("on: push\n", "workflow.jobs must be an object"),
        ("jobs: {}\n", "declares no jobs"),
        ("jobs:\n  a: [1]\n", "jobs.a must be an object"),
        ("jobs:\n  a:\n    needs: [1]\n", "jobs.a.needs"),
        (
            "jobs:\n  a:\n    needs: missing\n",
            "jobs.a.needs names missing, which the workflow does not declare",
        ),
        ("jobs:\n  a:\n    needs: ${{ fromJSON(x) }}\n", "uses an expression"),
        (
            "jobs:\n  a:\n    needs: [c]\n  b:\n    needs: [a]\n  c:\n    needs: [b]\n",
            "needs cycle: a → c → b → a",
        ),
        ("jobs:\n  a:\n    needs: a\n", "needs cycle: a → a"),
    ] {
        let message = error(workflow);
        assert!(message.contains(expected), "{workflow}: {message}");
    }
    for removed in [json!({"graphPath":"pipeline.json"}), json!({"command":["/bin/sh"]})] {
        assert!(
            fixture.collect("github-actions-jobs", removed).is_err(),
            "evaluated-graph and command modes are not part of github-actions-jobs"
        );
    }
}

#[test]
fn all_pre_exported_schema_and_dotnet_inputs_are_native_without_trust() {
    for (id, fixture, filename) in [
        ("dotnet-public-api", "dotnet-public-api", "api.json"),
        ("dotnet-di", "dotnet-di", "di.json"),
        ("nestjs-di", "nestjs-di", "nestjs.json"),
        ("spring-di", "spring-di", "spring.json"),
        ("efcore-schema", "efcore-schema", "schema.json"),
        ("django-schema", "django-schema", "django.extraction.json"),
        ("prisma-schema", "django-schema", "django.extraction.json"),
    ] {
        let root = fixtures(fixture);
        let state = collectors::collect(
            &root,
            &definition(id, json!({"snapshot":filename})),
            &Runner::new(root.clone(), false).with_executable(env!("CARGO_BIN_EXE_projections")),
        )
        .unwrap();
        assert!(!state["entities"].as_array().unwrap().is_empty());
        if id == "django-schema" || id == "prisma-schema" {
            assert_eq!(state["metadata"]["authority"], "pre-exported database schema");
            assert_eq!(state["metadata"]["snapshot"], filename);
        }
    }
}

#[test]
fn prisma_source_schemas_are_parsed_natively_without_node_or_prisma() {
    let fixture = Fixture::new();
    fixture.put(
        "prisma/schema/base.prisma",
        "datasource db {\n  provider = \"sqlite\"\n  url = env(\"DATABASE_URL\")\n}\n",
    );
    fixture.put(
        "prisma/schema/models/item.prisma",
        "model Item {\n  id Int @id\n  name String @unique\n}\n",
    );
    let runner = Runner::new(fixture.0.clone(), false).with_executable(env!("CARGO_BIN_EXE_projections"));
    let state = collectors::collect(
        &fixture.0,
        &json!({"id":"fixture","extractor":"prisma-schema","renderer":"database","inputs":{"schema":"prisma/schema"},"execution":{"environment":[]}}),
        &runner,)
    .unwrap();
    assert_eq!(state["schema"], "database/v0");
    let labels: Vec<_> = state["entities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["label"].as_str().unwrap())
        .collect();
    assert!(labels.contains(&"Item") && labels.contains(&"name"), "{labels:?}");
    assert!(
        fixture
            .collect("prisma-schema", json!({"schema":"prisma/schema/base.prisma"}))
            .is_ok()
    );
    fixture.put("broken.prisma", "model Broken {\n  id Int @id\n  other Missing\n}\n");
    let error = fixture.collect("prisma-schema", json!({"schema":"broken.prisma"})).unwrap_err();
    assert!(format!("{error:#}").contains("broken.prisma:3"));
}

#[test]
fn package_version_bumps_compare_as_one_modified_package() {
    let modified = |id: &str, before: &str, after: &str, inputs: Value| {
        let fixture = Fixture::new();
        let source = fixtures(id);
        let path = inputs
            .as_object()
            .unwrap()
            .values()
            .flat_map(|v| v.as_array().cloned().unwrap_or_else(|| vec![v.clone()]))
            .next()
            .unwrap();
        let path = path.as_str().unwrap();
        let original = fs::read_to_string(source.join(path)).unwrap();
        fixture.put(path, &original);
        let first = fixture.collect(id, inputs.clone()).unwrap();
        fixture.put(path, &original.replace(before, after));
        let second = fixture.collect(id, inputs).unwrap();
        let comparison = projections_comparator_default::compare(&first, &second, &json!({})).unwrap();
        comparison["changes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|change| (change["status"].clone(), change["id"].clone()))
            .collect::<Vec<_>>()
    };
    let cargo = modified(
        "cargo-dependencies",
        "\"version\": \"0.3.0\"",
        "\"version\": \"0.4.0\"",
        json!({"metadataPath":"cargo-metadata.json"}),
    );
    assert_eq!(cargo.len(), 1, "{cargo:?}");
    assert_eq!(cargo[0].0, "modified");
    let nuget = modified(
        "nuget-dependencies",
        "Example.Core/1.4.2",
        "Example.Core/1.5.0",
        json!({"assetsPaths":["nuget/project.assets.json"]}),
    );
    assert!(!nuget.is_empty(), "{nuget:?}");
    assert!(nuget.iter().all(|(status, _)| status == "modified"), "{nuget:?}");
}

#[test]
fn scip_index_from_scip_typescript_becomes_file_references_without_trust() {
    // index.scip was written by `scip-typescript index` (0.6.1) for this fixture.
    let root = fixtures("scip-file-references").join("scip-typescript");
    let inputs = json!({"index":"index.scip"});
    assert!(!collectors::requires_trust(&definition("scip-file-references", inputs.clone())));
    let state = collectors::collect(
        &root,
        &definition("scip-file-references", inputs.clone()),
        &Runner::new(root.clone(), false).with_executable(env!("CARGO_BIN_EXE_projections")),
    )
    .unwrap();
    let edges: Vec<_> = state["relationships"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["id"].as_str().unwrap(), e["data"]["references"].as_u64().unwrap()))
        .collect();
    assert_eq!(
        edges,
        [
            ("references:src%2Fapp.ts:src%2Flib.ts", 6),
            ("references:src%2Fmain.ts:src%2Fapp.ts", 3)
        ]
    );
    // An index naming a document the revision lacks is stale.
    let fixture = Fixture::new();
    for file in ["index.scip", "src/lib.ts", "src/main.ts"] {
        fs::create_dir_all(fixture.0.join(file).parent().unwrap()).unwrap();
        fs::copy(root.join(file), fixture.0.join(file)).unwrap();
    }
    let stale = collectors::collect(
        &fixture.0,
        &definition("scip-file-references", inputs),
        &Runner::new(fixture.0.clone(), false).with_executable(env!("CARGO_BIN_EXE_projections")),
    );
    assert!(stale.is_err());
    assert!(collectors::requires_trust(&definition(
        "scip-file-references",
        json!({"indexer":["scip-typescript","index"]})
    )));
}

#[cfg(unix)]
#[test]
fn no_follow_inputs_and_untrusted_execution_are_enforced() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    fixture.json("metadata.json", json!({"version":1}));
    symlink("metadata.json", fixture.0.join("link.json")).unwrap();
    for filename in ["../outside.json", "/outside.json", "link.json"] {
        assert!(fixture.collect("cargo-dependencies", json!({"metadataPath":filename})).is_err());
    }
    fixture.put("Cargo.toml", "[package]\nname=\"fixture\"\nversion=\"0.1.0\"\n");
    for (id, inputs) in [
        (
            "command-output",
            json!({"commands":[{"id":"probe","label":"Probe","command":["/bin/sh","-c","touch executed"]}]}),
        ),
        ("cargo-dependencies", json!({"cargoPath":"/bin/sh"})),
        ("django-schema", json!({"settings":"app.settings","python":"/bin/sh"})),
        ("dotnet-public-api", json!({"project":"Cargo.toml","dotnet":"/bin/sh"})),
        (
            "terraform-infrastructure",
            json!({"planPath":"metadata.json","terraformPath":"/bin/sh"}),
        ),
        ("terraform-infrastructure", json!({"terraformPath":"/bin/sh"})),
        (
            "azure-what-if",
            json!({"templateFile":"Cargo.toml","resourceGroup":"rg","azPath":"/bin/sh"}),
        ),
    ] {
        let error = fixture.collect(id, inputs).unwrap_err();
        assert!(
            format!("{error:#}").contains("--trust"),
            "Expected trust refusal for {id}: {error:#}"
        );
    }
    assert!(!fixture.0.join("executed").exists());
}

#[cfg(unix)]
#[test]
fn trusted_command_output_is_native_and_rejects_binary_or_oversize_stdout() {
    let fixture = Fixture::new();
    let runner = Runner::new(fixture.0.clone(), true).with_executable(env!("CARGO_BIN_EXE_projections"));
    let config = definition(
        "command-output",
        json!({"commands":[
            {"id":"plain","label":"Plain","presentation":"prose","command":["/bin/sh","-c","printf 'hello\\n'"]},
            {"id":"ansi","label":"Environment","command":["/bin/sh","-c","printf '%s:%s' \"$NO_COLOR\" \"$TERM\""]},
        ]}),
    );
    let state = collectors::collect(&fixture.0, &config, &runner).unwrap();
    // As for every extractor, the extractor's own stdout, the extraction that
    // carries the captured output, is recorded for diagnostics.
    assert!(
        runner
            .outputs
            .lock()
            .unwrap()
            .iter()
            .any(|output| { output["stdout"].as_str().is_some_and(|stdout| stdout.contains("output:plain")) })
    );
    assert!(
        state["entities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == "output:plain" && n["data"]["text"] == "hello\n" && n["data"]["presentation"] == "prose")
    );
    assert!(
        state["entities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == "output:ansi" && n["data"]["text"] == "1:dumb")
    );
    let bad = definition(
        "command-output",
        json!({"commands":[{"id":"bad","label":"Bad","command":["/bin/sh","-c","printf '\\001'"]}]}),
    );
    assert!(collectors::collect(&fixture.0, &bad, &runner).is_err());
}

#[test]
#[ignore = "Explicit native tool qualification; requires an installed .NET 8+ SDK and the published helper (packages/extractors/dotnet-support/scripts/publish.mjs)"]
fn native_dotnet_prebuilt_helper_collects_real_compiled_public_api() {
    let source = fixtures("dotnet-support").join("application");
    let fixture = Fixture::new();
    for filename in ["Fixture.csproj", "Composition.cs"] {
        fixture.put(filename, &fs::read_to_string(source.join(filename)).unwrap());
    }
    let mut d = definition("dotnet-public-api", json!({"project":"Fixture.csproj","configuration":"Release"}));
    d["execution"] = json!({"timeoutMs":300000,"network":true,"environment":["NUGET_PACKAGES","DOTNET_ROOT"]});
    let state = collectors::collect(
        &fixture.0,
        &d,
        &Runner::new(fixture.0.clone(), true).with_executable(env!("CARGO_BIN_EXE_projections")),
    )
    .unwrap();
    assert_eq!(state["schema"], "api/v0");
    assert!(state["entities"].as_array().unwrap().iter().any(|n| n["kind"] == "assembly"));
    assert!(
        state["entities"]
            .as_array()
            .unwrap()
            .iter()
            .all(|n| n["data"]["signature"].is_string())
    );
    for (id, method, kind, count) in [
        ("dotnet-di", "Services", "registration", 9),
        ("efcore-schema", "Database", "table", 2),
    ] {
        let mut d = definition(
            id,
            json!({"project":"Fixture.csproj","configuration":"Release",
            "assembly":"bin/Fixture/release/Fixture.dll","factoryType":"Fixture.Composition","factoryMethod":method,"variant":"baseline"}),
        );
        d["execution"] = json!({"timeoutMs":300000,"network":true,"environment":["NUGET_PACKAGES","DOTNET_ROOT"]});
        let state = collectors::collect(
            &fixture.0,
            &d,
            &Runner::new(fixture.0.clone(), true).with_executable(env!("CARGO_BIN_EXE_projections")),
        )
        .unwrap();
        assert_eq!(
            state["entities"].as_array().unwrap().iter().filter(|n| n["kind"] == kind).count(),
            count
        );
    }
    assert!(!fixture.0.join("bin").exists());
    assert!(!fixture.0.join("obj").exists());
    assert!(
        !fs::read_dir(&fixture.0)
            .unwrap()
            .any(|e| { e.unwrap().file_name().to_string_lossy().starts_with(".projections-dotnet-") })
    );
}

#[test]
fn extractor_requests_name_the_working_checkout() {
    let fixture = Fixture::new();
    let definition = definition("custom", json!({}));
    let trusted = Runner::new(fixture.0.clone(), true)
        .with_executable(env!("CARGO_BIN_EXE_projections"))
        .extractor_request(&definition, &fixture.0);
    assert_eq!(
        trusted["repository"]["checkout"],
        json!(projections_extractor_sdk::canonical(&fixture.0).unwrap())
    );
    let untrusted = Runner::new(fixture.0.clone(), false)
        .with_executable(env!("CARGO_BIN_EXE_projections"))
        .extractor_request(&definition, &fixture.0);
    assert_eq!(untrusted["repository"]["checkout"], trusted["repository"]["checkout"]);
}

#[test]
fn cargo_path_packages_sharing_a_name_are_identified_by_their_directory() {
    let fixture = Fixture::new();
    let mut metadata: Value =
        serde_json::from_str(&fs::read_to_string(fixtures("cargo-dependencies").join("cargo-metadata.json")).unwrap()).unwrap();
    for package in metadata["packages"].as_array_mut().unwrap() {
        package["name"] = json!("shared");
    }
    fixture.json("metadata.json", metadata);
    let state = fixture
        .collect("cargo-dependencies", json!({"metadataPath":"metadata.json"}))
        .unwrap();
    let mut ids: Vec<_> = state["entities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    ids.sort();
    assert_eq!(ids, ["cargo:shared:local@api", "cargo:shared:local@support"]);
}

/// A declared input the revision lacks (one before it was added, or after it was
/// removed) is an empty extraction that names it, for every built-in whose
/// inputs name files, folders or globs; tool modes run no tool for it.
#[test]
fn every_built_in_extracts_a_missing_declared_input_as_empty_and_names_it() {
    let fixture = Fixture::new();
    fixture.put("README.md", "No projects yet\n");
    let snapshot = json!({"snapshot":"exports/state.json"});
    let cases = [
        (
            "prisma-schema",
            json!({"schema":"packages/api/prisma/schema.prisma"}),
            false,
            vec!["packages/api/prisma/schema.prisma"],
        ),
        (
            "prisma-schema",
            json!({"schemas":["prisma/a.prisma","prisma/models"]}),
            false,
            vec!["prisma/a.prisma", "prisma/models"],
        ),
        ("prisma-schema", snapshot.clone(), false, vec!["exports/state.json"]),
        ("django-schema", snapshot.clone(), false, vec!["exports/state.json"]),
        ("dotnet-public-api", snapshot.clone(), false, vec!["exports/state.json"]),
        ("dotnet-di", snapshot.clone(), false, vec!["exports/state.json"]),
        ("efcore-schema", snapshot.clone(), false, vec!["exports/state.json"]),
        ("nestjs-di", snapshot.clone(), false, vec!["exports/state.json"]),
        ("spring-di", snapshot.clone(), false, vec!["exports/state.json"]),
        (
            "github-actions-jobs",
            json!({"workflowPath":".github/workflows/ci.yml"}),
            false,
            vec![".github/workflows/ci.yml"],
        ),
        ("workspace-dependencies", json!({}), false, vec!["package.json"]),
        ("workspace-dependencies", json!({"root":"web"}), false, vec!["web/package.json"]),
        (
            "cargo-dependencies",
            json!({"metadataPath":"cargo-metadata.json"}),
            false,
            vec!["cargo-metadata.json"],
        ),
        (
            "cargo-dependencies",
            json!({"manifestPath":"crates/core/Cargo.toml"}),
            true,
            vec!["crates/core/Cargo.toml"],
        ),
        (
            "rust-public-api",
            json!({"rustdocJson":"target/doc/core.json"}),
            false,
            vec!["target/doc/core.json"],
        ),
        ("rust-public-api", json!({}), true, vec!["Cargo.toml"]),
        (
            "nuget-dependencies",
            json!({"assetsPaths":["src/App/obj/project.assets.json"]}),
            false,
            vec!["src/App/obj/project.assets.json"],
        ),
        (
            "nuget-dependencies",
            json!({"projects":["src/App/App.csproj"]}),
            true,
            vec!["src/App/App.csproj"],
        ),
        (
            "terraform-infrastructure",
            json!({"planJsonPath":"infra/plan.json"}),
            false,
            vec!["infra/plan.json"],
        ),
        (
            "terraform-infrastructure",
            json!({"planPath":"infra/saved.tfplan"}),
            false,
            vec!["infra/saved.tfplan"],
        ),
        ("terraform-infrastructure", json!({"directory":"infra"}), true, vec!["infra"]),
        (
            "azure-what-if",
            json!({"whatIfJsonPath":"infra/what-if.json"}),
            false,
            vec!["infra/what-if.json"],
        ),
        (
            "azure-what-if",
            json!({"templateFile":"infra/main.bicep","resourceGroup":"rg"}),
            true,
            vec!["infra/main.bicep"],
        ),
        (
            "tetragon-policies",
            json!({"paths":["deploy/tetragon/*.yaml"],"agentValuesPath":"deploy/values.yaml"}),
            false,
            vec!["deploy/tetragon/*.yaml", "deploy/values.yaml"],
        ),
        (
            "dotnet-di",
            json!({"project":"src/App/App.csproj"}),
            true,
            vec!["src/App/App.csproj"],
        ),
        ("nestjs-di", json!({"entry":"src/main.ts"}), true, vec!["src/main.ts"]),
        ("spring-di", json!({"project":"services/orders"}), true, vec!["services/orders"]),
        ("scip-file-references", json!({"index":"index.scip"}), false, vec!["index.scip"]),
        (
            "typescript-public-api",
            json!({"tsconfig":"packages/core/tsconfig.json","entrypoints":{".":"packages/core/src/index.ts"}}),
            false,
            vec!["packages/core/src/index.ts", "packages/core/tsconfig.json"],
        ),
        (
            "go-public-api",
            json!({"patterns":["./services/api/..."]}),
            true,
            vec!["services/api"],
        ),
    ];
    for (id, inputs, trusted, missing) in cases {
        let extraction = collectors::collect(
            &fixture.0,
            &definition(id, inputs.clone()),
            &Runner::new(fixture.0.clone(), trusted).with_executable(env!("CARGO_BIN_EXE_projections")),
        )
        .unwrap_or_else(|error| panic!("{id} {inputs}: {error:#}"));
        assert_eq!(extraction["entities"], json!([]), "{id} {inputs}");
        assert_eq!(extraction["relationships"], json!([]), "{id} {inputs}");
        assert_eq!(extraction["missingInputs"], json!(missing), "{id} {inputs}");
    }
    // A declared input that exists but doesn't parse is still a failure.
    fixture.put(".github/workflows/ci.yml", "jobs: [\n");
    let error = fixture
        .collect("github-actions-jobs", json!({"workflowPath":".github/workflows/ci.yml"}))
        .unwrap_err();
    assert!(format!("{error:#}").contains("ci.yml"), "{error:#}");
}
