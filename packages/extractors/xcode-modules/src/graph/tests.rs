use super::*;
use projections_extractor_swift_support::Import;

fn target(id: &str, project: usize, module: &str, dependencies: &[&str], imports: &[&str]) -> Target {
    Target {
        id: id.into(),
        project,
        name: id.into(),
        kind: "framework".into(),
        module: Some(module.into()),
        sdk: None,
        configuration: None,
        dependencies: dependencies.iter().map(|id| (*id).to_owned()).collect(),
        links: Vec::new(),
        products: Vec::new(),
        imports: imports
            .iter()
            .map(|module| Import {
                module: (*module).into(),
                attributes: Vec::new(),
                access: None,
                conditional: false,
                line: 1,
            })
            .collect(),
        unread: Vec::new(),
    }
}

fn edges(graph: &Graph) -> Vec<String> {
    graph
        .relationships
        .iter()
        .map(|edge| {
            format!(
                "{} {} {}",
                edge["kind"].as_str().unwrap(),
                edge["from"].as_str().unwrap(),
                edge["to"].as_str().unwrap()
            )
        })
        .collect()
}

#[test]
fn imports_resolve_to_declared_targets_first_and_ambiguous_ones_to_none() {
    let targets = [
        target("ios-core", 0, "Core", &[], &[]),
        target("mac-core", 0, "Core", &[], &[]),
        target("ios-app", 0, "App", &["ios-core"], &["Core"]),
        target("tool", 0, "Tool", &[], &["Core"]),
        target("other", 1, "Other", &[], &["App"]),
    ];
    let graph = build(&targets, &[], &["A.xcodeproj".into(), "B.xcodeproj".into()], true);
    assert_eq!(edges(&graph), ["depends-on ios-app ios-core", "imports other ios-app"]);
    let tool = graph.entities.iter().find(|entity| entity["id"] == "tool").unwrap();
    // Two targets export `Core` and the tool declares neither.
    assert_eq!(tool["data"]["imports"], json!(["Core"]));
}
