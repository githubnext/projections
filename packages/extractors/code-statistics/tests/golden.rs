//! Golden extractions across languages. Regenerate with
//! `PROJECTIONS_UPDATE_GOLDEN=1 cargo test -p projections-extractor-code-statistics`.

use projections_extractor_code_statistics::collect;
use projections_extractor_sdk::testing::{self, golden};
use serde_json::{Value, json};
use std::fs;
use std::path::Path;

fn case(name: &str) -> Value {
    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name);
    let root = directory.join("repo").canonicalize().unwrap();
    let inputs: Value = fs::read_to_string(directory.join("inputs.json"))
        .map(|text| serde_json::from_str(&text).unwrap())
        .unwrap_or_else(|_| json!({}));
    let definition = json!({"id":"statistics","extractor":"code-statistics","inputs":inputs});
    let extraction = collect(&testing::context(&root, definition)).unwrap();
    golden(&directory.join("expected.json"), &extraction);
    extraction
}

#[test]
fn polyglot_repository_matches_golden_extraction() {
    let extraction = case("polyglot");
    let languages: Vec<_> = extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entity| entity["label"].as_str().unwrap())
        .collect();
    for expected in ["Rust", "Python", "TypeScript", "TSX", "Go", "Markdown", "HTML", "Shell"] {
        assert!(languages.contains(&expected), "missing {expected} in {languages:?}");
    }
    for entity in extraction["entities"].as_array().unwrap() {
        let data = &entity["data"];
        let sum = |keys: [&str; 3]| keys.iter().map(|k| data[k].as_u64().unwrap()).sum::<u64>();
        assert_eq!(sum(["code", "comment", "blank"]), data["lines"].as_u64().unwrap());
        assert_eq!(sum(["testCode", "testComment", "testBlank"]), data["testLines"].as_u64().unwrap());
        assert!(data["testFiles"].as_u64().unwrap() <= data["files"].as_u64().unwrap());
        assert_eq!(data["value"], data["code"]);
    }
}

#[test]
fn options_override_languages_tests_and_excludes() {
    let extraction = case("options");
    let php = &extraction["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entity| entity["label"] == "PHP")
        .unwrap()["data"];
    assert_eq!((php["files"].as_u64(), php["testFiles"].as_u64()), (Some(2), Some(1)));
}

#[test]
fn unknown_language_override_is_a_configuration_error() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/options/repo");
    let definition = json!({"inputs":{"languages":{".x":"Made Up"}}});
    let error = collect(&testing::context(&root, definition.clone()).with_files(vec![])).unwrap_err();
    assert!(error.to_string().contains("tokei language"), "{error}");
    let definition = json!({"inputs":{"tests":"**/test/**"}});
    assert!(collect(&testing::context(&root, definition.clone()).with_files(vec![])).is_err());
}
