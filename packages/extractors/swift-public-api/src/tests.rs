use super::*;
use projections_extractor_sdk::{Output, testing};
use std::sync::{Arc, Mutex};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/compatibility")
        .canonicalize()
        .unwrap()
}

fn imported(side: &str) -> Value {
    let definition = json!({"id": "api", "extractor": ID, "inputs": {"symbolGraphPath": format!("{side}.symbols"), "modules": ["Ledger"]}});
    collect(&testing::context(&fixtures(), definition)).unwrap()
}

fn entity<'a>(extraction: &'a Value, id: &str) -> &'a Value {
    extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id)
        .unwrap_or_else(|| panic!("no {id}"))
}

#[test]
fn imports_symbol_graphs_as_public_declarations_with_contracts() {
    let (before, after) = (imported("before"), imported("after"));
    projections_extractor_sdk::testing::golden(&fixtures().join("after.expected.json"), &after);
    assert_eq!(after["metadata"]["ecosystem"], "swift");
    let ledger = |extraction: &Value| entity(extraction, "swift:Ledger.Ledger")["data"]["contract"].clone();
    assert_eq!(ledger(&before).get("sealed"), None, "open class");
    assert_eq!(ledger(&after)["sealed"], true);
    assert_eq!(
        ledger(&after)["typeParameters"],
        json!([{"name": "Store", "constraints": ["RangeReplaceableCollection"]}])
    );
    assert_eq!(ledger(&after)["native"]["where"], json!(["Store.Element == Entry"]));
    let record = |extraction: &Value| entity(extraction, "swift:Ledger.Ledger.record(_:)")["data"]["contract"].clone();
    assert_eq!(record(&before)["native"]["open"], true);
    assert_eq!(record(&after)["native"]["async"], true);
    assert_eq!(record(&after)["signatures"][0]["returns"]["text"], "Int");
    // A protocol requirement without a default implementation must be implemented.
    assert_eq!(entity(&after, "swift:Ledger.Account.owner")["data"]["contract"]["abstract"], true);
    assert_eq!(
        entity(&after, "swift:Ledger.Account.post(_:)")["data"]["contract"].get("abstract"),
        None
    );
    let init = &entity(&after, "swift:Ledger.Entry.init(amount:kind:memo:)")["data"]["contract"]["signatures"][0];
    assert_eq!(init["returns"]["text"], "Entry");
    assert_eq!(
        init["parameters"][2],
        json!({"name": "memo", "type": {"text": "String?"}, "optional": true, "default": "nil", "variadic": false, "passing": "value"})
    );
    let add = &entity(&after, "swift:Ledger.Ledger.add(_:)")["data"]["contract"];
    assert_eq!(add["attributes"], json!(["@available(*, deprecated, message: \"Use record(_:)\")"]));
    // LedgerCore's Amount, re-exported, with the conformance Ledger adds.
    let amount = &entity(&after, "swift:Ledger.Amount")["data"]["contract"];
    assert!(
        amount["supertypes"]
            .as_array()
            .unwrap()
            .contains(&json!({"relation": "implements", "type": "Swift.Comparable"}))
    );
    entity(&after, "swift:Ledger.EntryKind.adjustment");
    entity(&after, "swift:Ledger.Amount.<(_:_:)");
}

#[test]
fn dump_symbol_graph_runs_with_trust_for_the_library_products_modules() {
    let root = fixtures().join("after");
    let definition = json!({"id": "api", "extractor": ID, "inputs": {"swiftPath": "/opt/swift/bin/swift"}});
    assert!(format!("{:#}", collect(&testing::context(&root, definition.clone())).unwrap_err()).contains("trust"));
    let runs: Arc<Mutex<Vec<Vec<String>>>> = Arc::default();
    let recorded = Arc::clone(&runs);
    let cx = testing::trusted(&root, definition).with_tools(move |call| {
        recorded.lock().unwrap().push(call.argv.to_vec());
        let stdout = if call.argv.iter().any(|arg| arg == "dump-package") {
            json!({"name": "Ledger", "products": [{"name": "Ledger", "type": {"library": ["automatic"]}, "targets": ["Ledger"]}], "dependencies": [], "targets": []}).to_string()
        } else {
            format!("Build complete!\nFiles written to {}\n", fixtures().join("after.symbols").display())
        };
        Ok(Output { stdout, stderr: String::new() })
    });
    let extraction = collect(&cx).unwrap();
    entity(&extraction, "swift:Ledger.Ledger");
    assert!(
        !extraction["entities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["id"] == "swift:LedgerCore"),
        "only the library product's module"
    );
    let runs = runs.lock().unwrap();
    assert_eq!(runs[1][..3], ["/opt/swift/bin/swift", "package", "--package-path"]);
    assert!(runs[1].contains(&"--scratch-path".to_owned()));
    assert!(
        runs[1].ends_with(
            &[
                "dump-symbol-graph",
                "--skip-synthesized-members",
                "--minimum-access-level",
                "public",
                "--skip-inherited-docs"
            ]
            .map(str::to_owned)
        )
    );
}

#[test]
fn importing_symbol_graphs_needs_no_trust() {
    assert!(!requires_trust(&json!({"symbolGraphPath": "graphs"})));
    assert!(requires_trust(&json!({})));
}

#[test]
fn imported_graphs_are_the_revisions_files_and_each_module_keeps_its_own_symbols() {
    // A copy of the graphs with a stale one on disk that isn't one of the revision's files.
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../target/swift-public-api-tests")
        .join(std::process::id().to_string());
    let folder = root.join("graphs");
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&folder).unwrap();
    for entry in std::fs::read_dir(fixtures().join("after.symbols")).unwrap() {
        let entry = entry.unwrap();
        std::fs::copy(entry.path(), folder.join(entry.file_name())).unwrap();
    }
    std::fs::write(folder.join("Stale.symbols.json"), "not json").unwrap();
    let files = vec!["graphs/Ledger.symbols.json".to_owned(), "graphs/LedgerCore.symbols.json".to_owned()];
    let definition = json!({"id": "api", "extractor": ID, "inputs": {"symbolGraphPath": "graphs"}});
    let extraction = collect(&testing::context(&root.canonicalize().unwrap(), definition).with_files(files));
    std::fs::remove_dir_all(&root).unwrap();
    let extraction = extraction.unwrap();
    // Ledger re-exports Amount and adds Comparable; LedgerCore's Amount doesn't have it.
    let supertypes = |id: &str| entity(&extraction, id)["data"]["contract"]["supertypes"].clone();
    assert!(
        supertypes("swift:Ledger.Amount")
            .as_array()
            .unwrap()
            .contains(&json!({"relation": "implements", "type": "Swift.Comparable"}))
    );
    assert!(
        !supertypes("swift:LedgerCore.Amount")
            .as_array()
            .unwrap()
            .contains(&json!({"relation": "implements", "type": "Swift.Comparable"}))
    );
    entity(&extraction, "swift:Ledger.Amount.<(_:_:)");
    let readonly = |id: &str| entity(&extraction, id)["data"]["contract"].get("readonly").cloned();
    assert_eq!(readonly("swift:LedgerCore.Amount.minorUnits"), None, "a stored var");
    assert_eq!(readonly("swift:LedgerCore.Amount.currency"), Some(json!(true)), "a let");
    assert_eq!(readonly("swift:Ledger.Account.id"), Some(json!(true)), "{{ get }}");
}
