//! First-party components get no privileges. A built-in extractor is a process
//! speaking the public extractor protocol, so a definition that runs it as a
//! custom extractor command, `projections __extract <id>`, gets exactly the
//! extraction the built-in definition does.

use projections_cli::{collectors, runtime::Runner};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(unix)]
#[path = "../src/test_support.rs"]
mod test_support;

const EXECUTABLE: &str = env!("CARGO_BIN_EXE_projections");

fn extractors() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../extractors").canonicalize().unwrap()
}

fn copy(source: &Path, destination: &Path) {
    if source.is_dir() {
        fs::create_dir_all(destination).unwrap();
        for entry in fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            copy(&entry.path(), &destination.join(entry.file_name()));
        }
    } else {
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::copy(source, destination).unwrap();
    }
}

fn git(root: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(["-c", "core.hooksPath=/dev/null"])
        .args(args)
        .current_dir(root)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?}");
}

/// Whether the TypeScript extractors' toolchain is present: Node.js on PATH and
/// the built Node helper.
fn node_toolchain() -> bool {
    let helper = extractors().join("typescript-support/dist/extractor.mjs");
    helper.is_file()
        && Command::new("node")
            .arg("--version")
            .output()
            .is_ok_and(|output| output.status.success())
}

/// Each built-in extractor with inputs that need no toolchain beyond Node.js:
/// pre-exported snapshots, imported tool output, or a shell command.
fn cases(root: &Path) -> Vec<(&'static str, Value)> {
    let fixtures = |id: &str| extractors().join(id).join("tests/fixtures");
    copy(&fixtures("workspace-dependencies").join("npm"), &root.join("npm"));
    copy(&fixtures("cargo-dependencies"), &root.join("cargo"));
    copy(&fixtures("nuget-dependencies"), &root.join("nuget"));
    copy(
        &fixtures("terraform-infrastructure").join("aws/base.plan.json"),
        &root.join("terraform/plan.json"),
    );
    copy(&fixtures("azure-what-if").join("base"), &root.join("azure"));
    copy(&fixtures("rust-public-api").join("minimal.json"), &root.join("rust/rustdoc.json"));
    copy(
        &fixtures("github-actions-jobs").join("workflow.yml"),
        &root.join("workflows/ci.yml"),
    );
    copy(&fixtures("prisma-schema").join("schema.prisma"), &root.join("prisma/schema.prisma"));
    copy(&fixtures("rails-schema").join("storefront/db"), &root.join("rails/db"));
    copy(&fixtures("rails-routes").join("storefront/config"), &root.join("rails/config"));
    copy(&fixtures("scip-file-references").join("scip-typescript"), &root.join("scip"));
    copy(&fixtures("tetragon-policies").join("library/repo/policies"), &root.join("tetragon"));
    copy(
        &fixtures("github-agentic-workflows").join("public/.github"),
        &root.join("agentic/.github"),
    );
    for (id, file) in [
        ("dotnet-public-api", "api.json"),
        ("dotnet-di", "di.json"),
        ("efcore-schema", "schema.json"),
        ("nestjs-di", "nestjs.json"),
        ("spring-di", "spring.json"),
        ("django-schema", "django.extraction.json"),
    ] {
        copy(&fixtures(id).join(file), &root.join("snapshots").join(id).join(file));
    }
    // Renderer scenarios, one compared: the built-in and the command both compare in the CLI's sandbox.
    let graph = |ids: &[&str]| {
        json!({"protocolVersion": 0, "schema": "graph/v0", "relationships": [],
            "entities": ids.iter().map(|id| json!({"id": id, "kind": "service", "label": id})).collect::<Vec<_>>()})
    };
    fs::create_dir_all(root.join("scenarios")).unwrap();
    fs::write(
        root.join("scenarios/scenarios.json"),
        serde_json::to_vec_pretty(
            &json!({"format": "projections.scenarios", "version": 0, "renderer": "graph", "scenarios": [
                {"id": "one", "title": "One revision", "extraction": graph(&["a"])},
                {"id": "split", "title": "A split", "before": graph(&["a"]), "after": graph(&["b", "c"])}
            ]}),
        )
        .unwrap(),
    )
    .unwrap();
    let snapshot = |id: &str, file: &str| json!({"snapshot": format!("snapshots/{id}/{file}")});
    let mut cases = vec![
        ("workspace-dependencies", json!({"root": "npm"})),
        ("repository-map", json!({})),
        ("code-statistics", json!({})),
        ("cargo-dependencies", json!({"metadataPath": "cargo/cargo-metadata.json"})),
        ("nuget-dependencies", json!({"assetsPaths": ["nuget/nuget/project.assets.json"]})),
        ("terraform-infrastructure", json!({"planJsonPath": "terraform/plan.json"})),
        (
            "azure-what-if",
            json!({"whatIfJsonPath": "azure/what-if.json", "templateJsonPath": "azure/main.json"}),
        ),
        ("rust-public-api", json!({"rustdocJson": "rust/rustdoc.json"})),
        ("github-actions-jobs", json!({"workflowPath": "workflows/ci.yml"})),
        ("github-agentic-workflows", json!({"paths": ["agentic/.github/workflows/*.md"]})),
        ("prisma-schema", json!({"schema": "prisma/schema.prisma"})),
        ("rails-schema", json!({"schema": "rails/db/schema.rb"})),
        ("rails-routes", json!({"routes": "rails/config/routes.rb"})),
        ("renderer-scenarios", json!({"include": ["scenarios/**/scenarios.json"]})),
        (
            "tetragon-policies",
            json!({"paths": ["tetragon/**/*.yaml"], "namespace": "security"}),
        ),
        ("scip-file-references", json!({"index": "scip/index.scip", "root": "scip"})),
        ("dotnet-public-api", snapshot("dotnet-public-api", "api.json")),
        ("dotnet-di", snapshot("dotnet-di", "di.json")),
        ("efcore-schema", snapshot("efcore-schema", "schema.json")),
        ("nestjs-di", snapshot("nestjs-di", "nestjs.json")),
        ("spring-di", snapshot("spring-di", "spring.json")),
        ("django-schema", snapshot("django-schema", "django.extraction.json")),
    ];
    #[cfg(unix)]
    {
        // A stand-in for the Go helper's api mode: the helper protocol, without Go.
        let helper = root.join("tools/go-helper");
        fs::create_dir_all(helper.parent().unwrap()).unwrap();
        test_support::write_executable(
            &helper,
            "#!/bin/sh\nprintf '%s' '{\"protocolVersion\":0,\"schema\":\"api/v0\",\"entities\":[{\"id\":\"go:example.Reader\",\"kind\":\"interface\",\"label\":\"Reader\",\"data\":{\"signature\":\"type Reader interface{ Read() }\"}}],\"relationships\":[],\"metadata\":{\"ecosystem\":\"go\"}}'\n",
        );
        cases.push(("go-public-api", json!({"goHelperPath": helper, "patterns": ["./..."]})));
        cases.push((
            "command-output",
            json!({"commands": [{"id": "greeting", "label": "Greeting", "command": ["/bin/sh", "-c", "printf 'hello\\n'"]}]}),
        ));
    }
    if node_toolchain() {
        let opensource = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for file in [
            "packages/schemas/package.json",
            "packages/schemas/tsconfig.json",
            "packages/schemas/src",
            "tsconfig.base.json",
        ] {
            copy(&opensource.join(file), &root.join("api").join(file));
        }
        // The project's own TypeScript and the schemas' TypeBox, installed in the working checkout.
        for package in ["node_modules/typescript", "node_modules/typebox"] {
            copy(&opensource.join(package), &root.join(package));
        }
        cases.push((
            "typescript-public-api",
            json!({"tsconfig": "api/packages/schemas/tsconfig.json", "entrypoints": {".": "api/packages/schemas/src/index.ts"}}),
        ));
    } else {
        eprintln!("typescript-public-api is not compared: it needs Node.js and the built Node helper (npm run build)");
    }
    cases
}

#[test]
fn every_built_in_extractor_runs_identically_as_a_custom_extractor_command() {
    let scratch = tempfile::tempdir().unwrap();
    let root = scratch.path().join("repository");
    fs::create_dir_all(root.join(".projections")).unwrap();
    let cases = cases(&root);
    fs::write(root.join(".gitignore"), "node_modules\n").unwrap();
    for (id, inputs) in &cases {
        let builtin = json!({"id": id, "extractor": id, "renderer": "graph", "inputs": inputs,
            "execution": {"timeoutMs": 120000}});
        let mut command = builtin.clone();
        command["id"] = json!(format!("{id}-command"));
        command["extractor"] = json!({"command": [EXECUTABLE, "__extract", id]});
        for definition in [builtin, command] {
            fs::write(
                root.join(".projections")
                    .join(format!("{}.json", definition["id"].as_str().unwrap())),
                serde_json::to_vec_pretty(&definition).unwrap(),
            )
            .unwrap();
        }
    }
    git(&root, &["init", "-q"]);
    git(&root, &["add", "--all"]);
    git(
        &root,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-qm",
            "fixture",
        ],
    );

    let covered: BTreeSet<&str> = cases.iter().map(|(id, _)| *id).collect();
    let expected: BTreeSet<&str> = collectors::IDS
        .iter()
        .copied()
        .filter(|id| cfg!(unix) || !["go-public-api", "command-output"].contains(id))
        .filter(|id| node_toolchain() || *id != "typescript-public-api")
        .collect();
    assert_eq!(covered, expected, "every built-in extractor is compared");

    // A custom command is repository code, so it always needs trust; the built-in
    // runs with the same grant, so both receive the same request.
    let runner = Runner::new(root.clone(), true).with_executable(EXECUTABLE);
    let batch = runner.show_all("HEAD", &[]).unwrap();
    let extracted = |id: &str| {
        let result = batch["results"]
            .as_array()
            .unwrap()
            .iter()
            .find(|result| result["id"] == id)
            .unwrap_or_else(|| panic!("{id} was not extracted"));
        assert_eq!(result["status"], "extracted", "{id}: {result}");
        result["extraction"].clone()
    };
    for (id, _) in &cases {
        let builtin = extracted(id);
        let custom = extracted(&format!("{id}-command"));
        assert!(
            !builtin["extraction"]["entities"].as_array().unwrap().is_empty(),
            "{id} extracted nothing"
        );
        assert_eq!(
            serde_json::to_string(&builtin["extraction"]).unwrap(),
            serde_json::to_string(&custom["extraction"]).unwrap(),
            "{id}"
        );
        assert_eq!(builtin["digest"], custom["digest"], "{id}");
        assert_eq!(builtin["provenance"]["extractor"]["id"], *id);
    }
}
