use super::*;

#[test]
fn a_development_build_runs_inside_the_checkout_it_was_built_from() {
    let root = tempfile::tempdir().unwrap();
    // As checkout_for reports it: canonical, without Windows' \\?\ prefix.
    let root = projections_extractor_sdk::canonical(root.path()).unwrap();
    let cli = root.join("packages").join("cli");
    fs::create_dir_all(cli.join("dist")).unwrap();
    fs::create_dir_all(root.join("packages").join("sdk")).unwrap();
    let manifest = root.join("packages").join("sdk").join("package.json");
    fs::write(&manifest, r#"{"name":"@githubnext/projections"}"#).unwrap();
    let built = cli.join("dist").join("projections");
    assert_eq!(checkout_for(&built, &cli), Some(root.clone()));
    let cargo = root.join("target").join("release").join("projections");
    assert_eq!(checkout_for(&cargo, &cli), Some(root.clone()));
    // A copy elsewhere (a release install, an extension's bundled CLI) is not.
    let elsewhere = tempfile::tempdir().unwrap();
    assert_eq!(checkout_for(&elsewhere.path().join("projections"), &cli), None);
    // Nor is a checkout that no longer holds the package.
    fs::write(&manifest, r#"{"name":"something-else"}"#).unwrap();
    assert_eq!(checkout_for(&built, &cli), None);
}

#[cfg(unix)]
#[test]
fn file_specifiers_are_relative_beside_the_checkout_and_absolute_otherwise() {
    let tarball = Path::new("/work/projections/dist/dogfood/githubnext-projections.tgz");
    assert_eq!(
        file_specifier(Path::new("/work/site/.github/projections/flags/renderer"), tarball),
        "file:../../../../../projections/dist/dogfood/githubnext-projections.tgz"
    );
    assert_eq!(
        file_specifier(Path::new("/tmp/site/renderer"), tarball),
        "file:/work/projections/dist/dogfood/githubnext-projections.tgz"
    );
}

#[cfg(windows)]
#[test]
fn file_specifiers_hold_drive_paths_whichever_way_windows_spelled_them() {
    // A canonical path is verbatim (\\?\C:\...); the renderer package's directory usually isn't.
    let tarball = Path::new(r"\\?\C:\work\projections\dist\dogfood\githubnext-projections.tgz");
    assert_eq!(
        file_specifier(Path::new(r"C:\work\site\renderer"), tarball),
        "file:../../projections/dist/dogfood/githubnext-projections.tgz"
    );
    assert_eq!(
        file_specifier(Path::new(r"D:\site\renderer"), tarball),
        "file:C:/work/projections/dist/dogfood/githubnext-projections.tgz"
    );
}

#[test]
fn a_development_build_scaffolds_a_renderer_on_the_checkout_tarball() {
    let repository = tempfile::tempdir().unwrap();
    let checkout = tempfile::tempdir().unwrap();
    let report = init(Options {
        root: repository.path().to_path_buf(),
        id: Some("flags".into()),
        title: None,
        extractor: Some(Extractor::Builtin("workspace-dependencies".into())),
        renderer: Some(Renderer::Custom),
        comparator: false,
        definition_directory: ".github/projections".into(),
        checkout: Some(checkout.path().to_path_buf()),
        skills: Default::default(),
    })
    .unwrap();
    let PackageSource::Checkout { tarball, specifier } = &report.renderer_package else {
        panic!("{:?}", report.renderer_package)
    };
    assert_eq!(tarball, &checkout.path().join(CHECKOUT_TARBALL));
    let manifest: Value =
        serde_json::from_str(&fs::read_to_string(repository.path().join(".github/projections/flags/renderer/package.json")).unwrap())
            .unwrap();
    assert_eq!(manifest["dependencies"][RENDERER_PACKAGE], json!(specifier));
    assert!(specifier.starts_with("file:"), "{specifier}");
    assert!(specifier.ends_with(CHECKOUT_TARBALL), "{specifier}");
    assert!(manifest.get("overrides").is_none());
}

#[test]
fn a_release_build_scaffolds_a_renderer_on_its_release_tarball() {
    let repository = tempfile::tempdir().unwrap();
    let report = init(Options {
        root: repository.path().to_path_buf(),
        id: Some("flags".into()),
        title: None,
        extractor: Some(Extractor::Builtin("workspace-dependencies".into())),
        renderer: Some(Renderer::Custom),
        comparator: false,
        definition_directory: ".github/projections".into(),
        checkout: None,
        skills: Default::default(),
    })
    .unwrap();
    assert_eq!(report.renderer_package, PackageSource::Release);
    let manifest: Value =
        serde_json::from_str(&fs::read_to_string(repository.path().join(".github/projections/flags/renderer/package.json")).unwrap())
            .unwrap();
    let url = format!("https://github.com/githubnext/projections/releases/download/v{VERSION}/githubnext-projections-{VERSION}.tgz");
    assert_eq!(manifest["dependencies"][RENDERER_PACKAGE], json!(url));
    assert_eq!(release_tarball(VERSION), url);
    assert!(manifest.get("overrides").is_none());
    let package = repository.path().join(".github/projections/flags/renderer");
    assert_eq!(renderer_package_version(&package).as_deref(), Some(VERSION));
    assert_eq!(version_mismatch(&package, "renderer"), None);
}

#[test]
fn a_renderer_package_version_comes_from_its_install_else_its_dependency() {
    let package = tempfile::tempdir().unwrap();
    let package = package.path();
    let depend = |specifier: &str| {
        fs::write(
            package.join("package.json"),
            json!({"dependencies": {RENDERER_PACKAGE: specifier}}).to_string(),
        )
        .unwrap();
        renderer_package_version(package)
    };
    assert_eq!(depend(&release_tarball("9.1.0")).as_deref(), Some("9.1.0"));
    assert_eq!(
        depend("file:../packs/githubnext-projections-0.3.0-beta.1.tgz").as_deref(),
        Some("0.3.0-beta.1")
    );
    assert_eq!(depend("^0.4.2").as_deref(), Some("0.4.2"));
    // A development build's tarball has no version in its name.
    assert_eq!(depend(&format!("file:../../{CHECKOUT_TARBALL}")), None);
    assert_eq!(depend("github:githubnext/projections"), None);
    // What is installed wins over what the dependency names.
    let installed = package.join("node_modules").join(RENDERER_PACKAGE);
    fs::create_dir_all(&installed).unwrap();
    fs::write(installed.join("package.json"), json!({"version": "9.1.0-dev.abc1234"}).to_string()).unwrap();
    assert_eq!(depend("^0.4.2").as_deref(), Some("9.1.0-dev.abc1234"));
    let message = version_mismatch(package, "flags/renderer").unwrap();
    assert!(
        message.contains(&format!(
            "flags/renderer uses {RENDERER_PACKAGE} 9.1.0-dev.abc1234, but this projections is {VERSION}"
        )),
        "{message}"
    );
    assert!(message.contains(&release_tarball(VERSION)), "{message}");
    // A development pack of this CLI's version matches it.
    fs::write(
        installed.join("package.json"),
        json!({"version": format!("{VERSION}-dev.abc1234")}).to_string(),
    )
    .unwrap();
    assert_eq!(version_mismatch(package, "flags/renderer"), None);
}

#[test]
fn definitions_are_pretty_and_keep_an_existing_files_layout() {
    let repository = tempfile::tempdir().unwrap();
    let options = |renderer: Option<Renderer>, extractor: Option<Extractor>| Options {
        root: repository.path().to_path_buf(),
        id: Some("deps".into()),
        title: None,
        extractor,
        renderer,
        comparator: false,
        definition_directory: ".github/projections".into(),
        checkout: None,
        skills: Default::default(),
    };
    let path = repository.path().join(".github/projections/deps.json");
    init(options(
        Some(Renderer::Builtin("graph".into())),
        Some(Extractor::Builtin("workspace-dependencies".into())),
    ))
    .unwrap();
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "{\n  \"id\": \"deps\",\n  \"title\": \"Deps\",\n  \"extractor\": \"workspace-dependencies\",\n  \"renderer\": \"graph\"\n}\n"
    );
    // Changing a part of a definition indented by four spaces keeps its indentation and order.
    fs::write(
            &path,
            "{\n    \"renderer\": \"graph\",\n    \"extractor\": {\"command\": [\"node\", \"x.mjs\"]},\n    \"title\": \"Deps\",\n    \"id\": \"deps\"\n}\n",
        )
        .unwrap();
    init(options(None, Some(Extractor::Builtin("workspace-dependencies".into())))).unwrap();
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "{\n    \"renderer\": \"graph\",\n    \"extractor\": \"workspace-dependencies\",\n    \"title\": \"Deps\",\n    \"id\": \"deps\"\n}\n"
    );
}

#[test]
fn titles_and_renderer_names_derive_from_ids() {
    assert_eq!(title_for("service-map"), "Service map");
    assert_eq!(title_for("contracts-api"), "Contracts API");
    assert_eq!(title_for("public_apis.v2"), "Public APIs v2");
    assert_eq!(title_for("ci-jobs"), "CI jobs");
    assert_eq!(renderer_name("Service_Map.v2"), "service-map-v2");
}

#[test]
fn templates_fill_every_placeholder() {
    let values = [("id", "x"), ("name", "x"), ("title", "X"), ("version", "0.0.0")];
    let placeholder = regex::Regex::new(r"\{\{[a-z_]+\}\}").unwrap();
    for template in [EXTRACT_NODE, EXTRACT_PYTHON, EXTRACT_GO, COMPARATOR]
        .into_iter()
        .chain(RENDERER.iter().map(|(_, template)| *template))
    {
        let filled = fill(template, &values);
        assert!(!placeholder.is_match(&filled), "{filled}");
    }
}

#[test]
fn the_guide_omits_front_matter() {
    assert!(authoring_guide().starts_with("# Building a custom projection"));
}

#[test]
fn a_built_in_extractor_takes_inputs_and_its_prompt_names_no_scaffold() {
    let root = tempfile::tempdir().unwrap();
    let inputs = serde_json::Map::from_iter([("workflowPath".to_owned(), json!(".github/workflows/release.yml"))]);
    let report = init(Options {
        root: root.path().into(),
        id: Some("release-jobs".into()),
        title: None,
        extractor: Some(Extractor::BuiltinWith("github-actions-jobs".into(), inputs)),
        renderer: None,
        comparator: false,
        definition_directory: ".projections".into(),
        checkout: None,
        skills: Default::default(),
    })
    .unwrap();
    let definition = report.definition.unwrap();
    assert_eq!(definition["inputs"]["workflowPath"], ".github/workflows/release.yml");
    assert!(!root.path().join(".projections/release-jobs").exists());
    let prompt = project_prompt(Some("release-jobs"), None, ".projections/release-jobs.json");
    assert!(!prompt.contains("scaffold"), "{prompt}");
    assert!(prompt.contains(".projections/release-jobs.json"), "{prompt}");
}
