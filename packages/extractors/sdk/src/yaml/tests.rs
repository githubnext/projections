use super::{parse_yaml, parse_yaml_documents};
use serde_json::json;

fn parse(source: &str) -> serde_json::Value {
    parse_yaml(source, "test.yaml").unwrap_or_else(|error| panic!("{error:#}"))
}

fn failure(source: &str) -> String {
    format!("{:#}", parse_yaml(source, "test.yaml").unwrap_err())
}

#[test]
fn resolves_plain_scalars_by_the_core_schema() {
    let source = "[~, null, '', true, False, yes, 12, -3, 0x1F, 0o17, 0b101, 007, 1.5, 1e3, '1', 2001-12-14, 1_000, inf]";
    let expected = json!([
        null,
        null,
        "",
        true,
        false,
        "yes",
        12,
        -3,
        31,
        15,
        5,
        "007",
        1.5,
        1000.0,
        "1",
        "2001-12-14",
        "1_000",
        "inf"
    ]);
    assert_eq!(parse(source), expected);
    assert_eq!(parse("[18446744073709551615, -9223372036854775808]"), json!([u64::MAX, i64::MIN]));
    assert!(failure("18446744073709551616").contains("out of range"));
}

#[test]
fn core_tags_force_a_type_and_other_global_tags_read_strings() {
    assert_eq!(
        parse("[!!int '12', !!float 1, !!str 123, !!str true, !!binary aGk=]"),
        json!([12, 1.0, "123", "true", "aGk="])
    );
    assert!(failure("!!bool yes").contains("expected a boolean"));
    assert!(failure("a: !local 1").contains("Local YAML tag !local"));
}

#[test]
fn rejects_nonfinite_numbers() {
    for source in [".inf", "-.Inf", ".NaN", "a: [!!float .nan]", ".inf: a"] {
        assert!(failure(source).contains("YAML values must be finite"), "{source}");
    }
    assert_eq!(parse("[1e400, nan]"), json!(["1e400", "nan"]));
}

#[test]
fn expands_anchors_and_aliases() {
    let source = "base: &base {x: 1, list: &list [a, b]}\ncopy: *base\nlist: *list\n&k key: *k\nredefined: &list [c]\nlatest: *list\n";
    let expected = json!({
        "base": {"x": 1, "list": ["a", "b"]},
        "copy": {"x": 1, "list": ["a", "b"]},
        "list": ["a", "b"],
        "key": "key",
        "redefined": ["c"],
        "latest": ["c"],
    });
    assert_eq!(parse(source), expected);
    assert!(failure("a: *missing").contains("unknown anchor"));
    assert!(failure("a: &x [*x]").contains("recursion limit exceeded"));
}

#[test]
fn bounds_alias_expansion() {
    let mut bomb = String::from("a: &a [lol, lol, lol, lol, lol, lol, lol, lol, lol]\n");
    for (previous, name) in ["a", "b", "c", "d"].iter().zip(["b", "c", "d", "e"]) {
        let aliases = vec![format!("*{previous}"); 9].join(", ");
        bomb.push_str(&format!("{name}: &{name} [{aliases}]\n"));
        // Four levels (918 jumps) stay within 100 per event; five don't.
        if name == "d" {
            assert_eq!(parse(&bomb)["d"][8][8][8][8], json!("lol"));
        }
    }
    assert!(failure(&bomb).contains("repetition limit exceeded"));
}

#[test]
fn keeps_merge_keys_as_ordinary_keys() {
    let source = "base: &base {x: 1}\nmerged:\n  <<: *base\n  y: 2\n";
    assert_eq!(parse(source), json!({"base": {"x": 1}, "merged": {"<<": {"x": 1}, "y": 2}}));
    assert!(failure("a:\n  <<: {x: 1}\n  <<: {x: 2}\n").contains("Duplicate YAML key \"<<\""));
}

#[test]
fn reads_scalar_keys_as_json_strings_and_rejects_others() {
    assert_eq!(
        parse("1: a\n-2: b\n1.5: c\n1e3: d\ntrue: e\n"),
        json!({"1": "a", "-2": "b", "1.5": "c", "1000.0": "d", "true": "e"})
    );
    // Distinct YAML keys may share a JSON key; the last wins.
    assert_eq!(parse("1: a\n'1': b\ntrue: c\n'true': d\n"), json!({"1": "b", "true": "d"}));
    for source in ["~: a", "[1, 2]: a", "{a: 1}: b", "? \n: v"] {
        assert!(failure(source).contains("must be JSON-compatible"), "{source}");
    }
}

#[test]
fn rejects_keys_equal_as_yaml_values() {
    for source in [
        "a: 1\na: 2",
        "1: a\n0x1: b",
        "0: a\n-0: b",
        "0.0: a\n-0.0: b",
        "null: a\n~: b",
        "true: a\nTrue: b",
        "[1]: a\n[1]: b",
    ] {
        assert!(failure(source).contains("Duplicate YAML key"), "{source}");
    }
    assert!(failure("x:\n  a: 1\n  a: 2\n").contains("Duplicate YAML key \"a\" at line 3 column 3"));
    assert_eq!(parse("1: a\n1.0: b\n01: c\n"), json!({"1": "a", "1.0": "b", "01": "c"}));
}

#[test]
fn reads_documents_of_a_stream() {
    let documents = |source| parse_yaml_documents(source, "test.yaml").unwrap();
    assert_eq!(
        documents("a: 1\n---\nb: 2\n...\n--- 3\n"),
        vec![json!({"a": 1}), json!({"b": 2}), json!(3)]
    );
    assert_eq!(documents(""), vec![json!(null)]);
    assert_eq!(documents("a: 1\n---\n"), vec![json!({"a": 1}), json!(null)]);
    // Anchors belong to their document.
    let error = parse_yaml_documents("a: &x 1\n---\nb: *x\n", "test.yaml").unwrap_err();
    assert!(format!("{error:#}").contains("(document 2)"));
    assert!(failure("a: 1\n---\nb: 2\n").contains("more than one document"));
    assert_eq!(parse(""), json!(null));
}

#[test]
fn limits_nesting_and_skips_a_byte_order_mark() {
    let nested = |depth| format!("{}{}", "[".repeat(depth), "]".repeat(depth));
    assert!(parse_yaml(&nested(128), "test.yaml").is_ok());
    assert!(failure(&nested(129)).contains("recursion limit exceeded"));
    assert_eq!(parse("\u{feff}a: 1\n"), json!({"a": 1}));
}
