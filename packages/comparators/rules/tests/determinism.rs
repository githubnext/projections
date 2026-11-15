//! CEL maps iterate in hash order, which varies between runs and processes.
//! Every rules file sorts what it lists, so repeated runs agree byte for byte.

mod common;

use common::{read, root};
use serde_json::json;

#[test]
fn repeated_runs_agree_byte_for_byte() {
    common::with_stack(repeated_runs);
}

fn repeated_runs() {
    let fixtures = [
        ("default-order", "packages/renderers/graph/fixtures/azure"),
        ("moved-components", "packages/renderers/graph/fixtures/service-platform"),
        ("runtime-policy", "packages/extractors/tetragon-policies/tests/fixtures/deployment/"),
        ("api-compatibility", "packages/renderers/api/fixtures/dotnet"),
        ("api-compatibility", "packages/renderers/api/fixtures/typescript"),
        ("priority-order", "packages/renderers/graph/fixtures/nuget"),
    ];
    for (name, stem) in fixtures {
        let path = |side: &str| {
            if stem.ends_with('/') {
                root().join(format!("{stem}{side}.expected.json"))
            } else {
                root().join(format!("{stem}-{side}.json"))
            }
        };
        let (before, after) = (read(&path("before")), read(&path("after")));
        let first = serde_json::to_string(&common::comparator(name).compare(&before, &after, &json!({})).unwrap()).unwrap();
        for _ in 0..4 {
            let again = serde_json::to_string(&common::comparator(name).compare(&before, &after, &json!({})).unwrap()).unwrap();
            assert_eq!(again, first, "{name} {stem}");
        }
    }
}
