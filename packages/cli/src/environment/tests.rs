use super::*;

#[test]
fn environments_are_validated_strictly() {
    let environment = parse(
            ".github/projections/environment.json",
            r#"{"format":"projections.environment","version":0,
                "prepare":[{"id":"install","run":["npm","ci"],"key":["package-lock.json","**/package.json"],"directory":"web/","environment":["NPM_CONFIG_REGISTRY"]}],
                "toolchain":[["node","--version"]],"workspace":{"strategy":"clone"},"devcontainer":".devcontainer/devcontainer.json"}"#,
        )
        .unwrap();
    let step = &environment.prepare[0];
    assert_eq!(step.directory, "web");
    assert_eq!(step.timeout_ms, DEFAULT_TIMEOUT_MS);
    assert_eq!(environment.strategy.as_deref(), Some("clone"));
    let files = ["a/package.json", "package-lock.json", "package.json", "src/x.ts"].map(String::from);
    assert_eq!(step.matches(&files).unwrap(), [&files[0], &files[1], &files[2]]);
    for invalid in [
        r#"{"format":"projections.environment","version":1}"#,
        r#"{"format":"projections.environment","version":0,"extra":1}"#,
        r#"{"format":"projections.environment","version":0,"prepare":[{"id":"a","run":[],"key":["x"]}]}"#,
        r#"{"format":"projections.environment","version":0,"prepare":[{"id":"a","run":["x"],"key":[]}]}"#,
        r#"{"format":"projections.environment","version":0,"prepare":[{"id":"a","run":["x"],"key":["../x"]}]}"#,
        r#"{"format":"projections.environment","version":0,"prepare":[{"id":"a","run":["x"],"key":["x"],"directory":"../up"}]}"#,
        r#"{"format":"projections.environment","version":0,"prepare":[{"id":"a","run":["x"],"key":["x"]},{"id":"a","run":["y"],"key":["y"]}]}"#,
        r#"{"format":"projections.environment","version":0,"prepare":[{"id":"a","run":["x"],"key":["x"],"timeoutMs":0}]}"#,
        r#"{"format":"projections.environment","version":0,"workspace":{"strategy":"magic"}}"#,
    ] {
        assert!(parse("e.json", invalid).is_err(), "{invalid}");
    }
}

#[test]
fn a_step_key_changes_with_its_files_and_its_command() {
    let step = Step {
        id: "install".into(),
        run: vec!["npm".into(), "ci".into()],
        key: vec!["package-lock.json".into()],
        directory: ".".into(),
        environment: vec![],
        timeout_ms: 1,
    };
    let one = step.key_hash(&[("package-lock.json".into(), "a".into())]);
    assert_eq!(one, step.key_hash(&[("package-lock.json".into(), "a".into())]));
    assert_ne!(one, step.key_hash(&[("package-lock.json".into(), "b".into())]));
    let other = Step {
        run: vec!["npm".into(), "install".into()],
        ..step.clone()
    };
    assert_ne!(one, other.key_hash(&[("package-lock.json".into(), "a".into())]));
}
