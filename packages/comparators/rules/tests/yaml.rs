//! Comparator files are a restricted YAML subset, and the comparator's digest is
//! over the parsed rules, not their layout.

mod common;

use projections_comparator_rules::{Comparator, digest, parse};
use serde_json::json;

fn rejects(text: &str, message: &str) {
    let failure = parse(text).expect_err(text);
    assert!(failure[0].message.contains(message), "{text}: {failure:?}");
}

#[test]
fn the_subset() {
    common::with_stack(the_subset_);
}

fn the_subset_() {
    assert_eq!(
        parse("a: 1\nb: -2.5\nc: true\nd: ~\ne: 'true'\nf: x + 'y'\ng: |-\n  one\n  two\nh: [1, x]\n").unwrap(),
        json!({"a": 1, "b": -2.5, "c": true, "d": null, "e": "true", "f": "x + 'y'", "g": "one\ntwo", "h": [1, "x"]})
    );
    // YAML 1.1 booleans and other implicit types are strings.
    assert_eq!(
        parse("a: yes\nb: 0x1F\nc: 1_000\nd: .inf\n").unwrap(),
        json!({"a": "yes", "b": "0x1F", "c": "1_000", "d": ".inf"})
    );
    rejects("a: &x [1]\nb: *x\n", "Anchors");
    rejects("a: *x\n", "");
    rejects("a: !!str 1\n", "Tags");
    rejects("base: {a: 1}\nderived:\n  <<: {a: 1}\n", "Merge keys");
    rejects("a: 1\na: 2\n", "Duplicate key");
    rejects("? [a]\n: 1\n", "Keys must be plain strings");
    rejects("a: 1\n---\nb: 2\n", "one document");
    rejects(&format!("a: {}{}\n", "[".repeat(40), "]".repeat(40)), "Nested too deeply");
}

#[test]
fn the_digest_covers_the_parsed_rules_not_the_layout() {
    common::with_stack(the_digest_covers_the_parsed_rules_not_the_layout_);
}

fn the_digest_covers_the_parsed_rules_not_the_layout_() {
    let text = common::rules_text("moved-components");
    let canonical = Comparator::from_yaml(&text).unwrap().canonical().to_owned();
    let edited = format!(
        "# A new comment.\n{}",
        text.replace("collections: [entities]", "collections:\n      - entities")
    );
    assert_eq!(parse(&edited).unwrap(), parse(&text).unwrap());
    assert_eq!(Comparator::from_yaml(&edited).unwrap().canonical(), canonical);
    let module = "sha256:0000";
    assert_eq!(
        digest(module, &canonical),
        digest(module, Comparator::from_yaml(&edited).unwrap().canonical())
    );
    // Any change in meaning, or of the interpreter, changes it.
    let changed = Comparator::from_yaml(&text.replace("place: before:add", "place: end")).unwrap();
    assert_ne!(digest(module, changed.canonical()), digest(module, &canonical));
    assert_ne!(digest("sha256:1111", &canonical), digest(module, &canonical));
    assert!(digest(module, &canonical).starts_with("sha256:"));
}

#[test]
fn errors_name_the_line_and_column() {
    common::with_stack(errors_name_the_line_and_column_);
}

fn errors_name_the_line_and_column_() {
    let text = common::rules_text("moved-components").replace("afterItem.label, beforeItem.id", "afterItem.lable, beforeItem.id");
    let failure = Comparator::from_yaml(&text).err().unwrap();
    let line = text.lines().position(|line| line.contains("afterItem.lable")).unwrap() + 1;
    let column = text.lines().nth(line - 1).unwrap().find("lable").unwrap();
    assert_eq!(failure.len(), 1);
    assert_eq!(failure[0].path, "/classify/summary");
    assert!(
        failure[0].message.starts_with(&format!(
            "Line {line}, column {column}: No field `lable` on Item; did you mean `label`?"
        )),
        "{}",
        failure[0].message
    );
}
