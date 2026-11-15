//! `language.json` is the rules language's manifest, whose digest identifies
//! the interpreter (`scripts/build.mjs`). Regenerate it with
//! `UPDATE_LANGUAGE=1 cargo test -p projections-comparator-rules --test language`.

use std::path::Path;

#[test]
fn the_committed_language_manifest_is_current() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("language.json");
    let expected = serde_json::to_string_pretty(&projections_comparator_rules::language::manifest()).unwrap() + "\n";
    if std::env::var_os("UPDATE_LANGUAGE").is_some() {
        std::fs::write(&path, &expected).unwrap();
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default().replace("\r\n", "\n");
    assert!(
        committed == expected,
        "packages/comparators/rules/language.json is out of date: the language changed, so the interpreter's identity, and \
         every rules comparator's digest, change with it. Regenerate it with UPDATE_LANGUAGE=1 cargo test -p \
         projections-comparator-rules --test language"
    );
}
