//! SCIP TypeScript file references.

use std::fs;

use serde_json::json;

use crate::common::{Scratch, collect, compare, copy, ecosystem, fixtures, items, selected, status_count, tool};

#[test]
fn native_scip_typescript_indexes_each_revision_into_file_references() {
    if !selected(&["PROJECTIONS_NATIVE_ECOSYSTEMS"]) {
        return;
    }
    let scratch = Scratch::new();
    let root = &scratch.0;
    copy(&fixtures("scip-file-references").join("scip-typescript"), root, &["index.scip"]);
    let indexer = json!([
        tool("PROJECTIONS_SCIP_TYPESCRIPT", "scip-typescript"),
        "index",
        "--output",
        "{output}"
    ]);
    let definition = ecosystem("scip-file-references", json!({"indexer":indexer}));
    assert!(collect(root, &definition, false).is_err());
    let before = collect(root, &definition, true).unwrap();
    assert_eq!(items(&before, "relationships").len(), 2);
    assert_eq!(before["relationships"][0]["data"]["references"], 6);
    fs::write(
        root.join("src/app.ts"),
        "import {double} from './lib'\n\nexport const four = double(2)\n",
    )
    .unwrap();
    let after = collect(root, &definition, true).unwrap();
    assert_eq!(after["relationships"][0]["data"]["references"], 3);
    assert_eq!(status_count(&compare(&before, &after), "modified"), 1);
    assert!(!after.to_string().contains(root.to_str().unwrap()));
}
