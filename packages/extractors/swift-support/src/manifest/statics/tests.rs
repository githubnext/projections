use super::read;

fn targets(source: &str) -> Vec<(String, Vec<String>)> {
    let manifest = read(source).unwrap_or_else(|error| panic!("{error}"));
    manifest
        .targets
        .into_iter()
        .map(|target| {
            (
                target.name,
                target.dependencies.into_iter().map(|dependency| dependency.name).collect(),
            )
        })
        .collect()
}

fn refused(source: &str) -> String {
    read(source).map(|_| ()).expect_err("read a manifest it should refuse").to_string()
}

#[test]
fn appends_apply_only_to_uses_after_them() {
    let source = "var deps: [Target.Dependency] = [\"A\"]\ndeps.append(\"B\")\nlet before = deps\nlet package = Package(name: \"P\", targets: [.target(name: \"T\", dependencies: before), .target(name: \"U\", dependencies: deps)])\ndeps.append(\"C\")\n";
    assert_eq!(
        targets(source),
        [
            ("T".to_owned(), vec!["A".to_owned(), "B".to_owned()]),
            ("U".to_owned(), vec!["A".to_owned(), "B".to_owned()])
        ]
    );
    // The package is an object: appending to its fields applies wherever it is.
    let source = "let package = Package(name: \"P\", targets: [])\npackage.targets.append(.target(name: \"Late\"))\n";
    assert_eq!(targets(source), [("Late".to_owned(), vec![])]);
}

#[test]
fn appending_an_array_to_itself_doubles_it_and_expansion_is_bounded() {
    let source = "var targets: [Target] = []\ntargets += targets\nlet package = Package(name: \"P\", targets: targets)\n";
    assert_eq!(targets(source), []);
    let source =
        "var targets: [Target] = [.target(name: \"A\")]\ntargets += targets\nlet package = Package(name: \"P\", targets: targets)\n";
    assert_eq!(targets(source).len(), 2);
    let doubling = "targets += targets\n".repeat(20);
    let source =
        format!("var targets: [Target] = [.target(name: \"A\")]\n{doubling}let package = Package(name: \"P\", targets: targets)\n");
    assert!(refused(&source).contains("expand too far"));
}

#[test]
fn changes_made_while_initializing_a_constant_or_by_removing_are_refused() {
    let base = "let package = Package(name: \"P\", targets: [.target(name: \"A\"), .target(name: \"B\")])\n";
    for change in [
        "let removed = package.targets.removeLast()\n",
        "package.targets.removeSubrange(0..<1)\n",
        "_ = package.targets.popLast()\n",
        "package.targets.swapAt(0, 1)\n",
    ] {
        let error = refused(&format!("{base}{change}"));
        assert!(error.contains("line 2: code changes `package.targets`"), "{change}: {error}");
    }
}
