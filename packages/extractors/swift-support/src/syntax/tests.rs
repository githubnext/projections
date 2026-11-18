use super::*;
use crate::lexer::tokens;

fn parse(source: &str) -> Program {
    program(&tokens(source).unwrap())
}

fn value(program: &Program, name: &str) -> Expr {
    program.bindings[name].value.clone()
}

#[test]
fn reads_bindings_with_calls_arrays_ranges_and_concatenation() {
    let program = parse(
        "import PackageDescription\nlet shared: [Target.Dependency] = [\"A\"] + extra\nlet range = \"1.0.0\"..<\"2.0.0\"\nlet package = Package(name: \"P\", targets: [.target(name: \"P\", dependencies: shared)])\n",
    );
    assert!(matches!(value(&program, "shared"), Expr::Concat(parts) if parts.len() == 2));
    assert!(matches!(value(&program, "range"), Expr::Range { closed: false, .. }));
    let Expr::Call { args, .. } = value(&program, "package") else {
        panic!("not a call")
    };
    assert_eq!(argument(&args, "name"), Some(&Expr::Str("P".into())));
    let Some(Expr::Array(targets)) = argument(&args, "targets") else {
        panic!("no targets")
    };
    let (name, target) = targets[0].member_call().unwrap();
    assert_eq!(name, "target");
    assert_eq!(argument(target, "dependencies").unwrap().identifier(), Some("shared"));
}

#[test]
fn keeps_what_it_cannot_evaluate_as_opaque() {
    let program = parse(
        "let a = [\n  \"x\",\n  #if os(Linux)\n  \"y\",\n  #endif\n]\nlet b = flag ? [1] : []\nlet c = [\"k\": 1]\nlet d = \"\\(x)\"\nlet e = items.map { $0 }\n",
    );
    assert!(matches!(&value(&program, "a"), Expr::Array(items) if matches!(items[1], Expr::Opaque { line: 3, .. })));
    for name in ["b", "c", "d", "e"] {
        assert!(
            matches!(value(&program, name), Expr::Opaque { .. }),
            "{name}: {:?}",
            value(&program, name)
        );
    }
}

#[test]
fn records_conditional_bindings_and_changes() {
    let program = parse(
        "var deps = [\"A\"]\n#if os(macOS)\nlet extra = [\"M\"]\n#endif\ndeps += [\"B\"]\npackage.targets.append(.target(name: \"T\"))\nfor target in package.targets {\n  target.swiftSettings = []\n  target.dependencies.append(\"C\")\n}\npackage.targets[0].dependencies.append(\"D\")\n",
    );
    assert!(program.bindings["extra"].conditional);
    let changes: Vec<(String, bool)> = program
        .mutations
        .iter()
        .map(|mutation| (mutation.path.join("."), mutation.appended.is_some()))
        .collect();
    assert_eq!(
        changes,
        [
            ("deps".into(), true),
            ("package.targets".into(), true),
            ("target.swiftSettings".into(), false),
            ("target.dependencies".into(), false),
            ("package.targets.dependencies".into(), true),
        ]
    );
}
