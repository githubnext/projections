//! Strict JSON: unique keys, valid Unicode, finite safe numbers and a nesting
//! bound, with diagnostics that point at the offending value.

use projections_engine::parse_json;
use serde_json::{Value, json};

fn rejects(raw: &str, code: &str, path: &str) {
    let failure = parse_json(raw).expect_err(raw);
    assert_eq!(failure.len(), 1, "{failure:?}");
    assert_eq!(failure[0].code, code, "{raw}: {failure:?}");
    assert_eq!(failure[0].path, path, "{raw}: {failure:?}");
}

fn nested(depth: usize) -> String {
    format!("{}0{}", "[".repeat(depth), "]".repeat(depth))
}

#[test]
fn every_json_type_parses() {
    assert_eq!(
        parse_json(r#"{"a":[null,true,false,"s\n\u00e9",1,-1,1.5,{}]}"#).unwrap(),
        json!({"a": [null, true, false, "s\n\u{e9}", 1, -1, 1.5, {}]})
    );
}

#[test]
fn integers_are_bounded_by_the_javascript_safe_range() {
    for (raw, value) in [
        ("9007199254740991", json!(9_007_199_254_740_991_u64)),
        ("-9007199254740991", json!(-9_007_199_254_740_991_i64)),
        ("9007199254740991.0", json!(9_007_199_254_740_991.0)),
        ("-9007199254740991.0", json!(-9_007_199_254_740_991.0)),
    ] {
        assert_eq!(parse_json(raw).unwrap(), value, "{raw}");
    }
    for raw in [
        "9007199254740992",
        "-9007199254740992",
        "18446744073709551615",
        "9007199254740992.0",
        "-9007199254740992.0",
        "1e300",
    ] {
        rejects(raw, "unsafe-integer", "");
    }
}

#[test]
fn fractions_and_negative_zero_are_preserved_or_normalized() {
    assert_eq!(parse_json("1.5").unwrap(), json!(1.5));
    assert_eq!(parse_json("-2.5").unwrap(), json!(-2.5));
    assert_eq!(parse_json("2.0").unwrap(), json!(2.0));
    let zero = parse_json("-0.0").unwrap().as_f64().unwrap();
    assert_eq!(zero, 0.0);
    assert!(zero.is_sign_positive(), "negative zero becomes zero");
    assert!(parse_json("-0").unwrap().as_f64().unwrap().is_sign_positive());
}

#[test]
fn nesting_is_bounded_at_64_levels() {
    let mut value = &parse_json(&nested(64)).unwrap();
    for _ in 0..64 {
        value = &value[0];
    }
    assert_eq!(value, &json!(0));
    rejects(&nested(65), "depth-limit", &"/0".repeat(65));
    let object = format!("{}0{}", r#"{"k":"#.repeat(65), "}".repeat(65));
    rejects(&object, "depth-limit", &"/k".repeat(65));
}

#[test]
fn diagnostics_point_at_the_offending_value() {
    rejects(r#"[1,{"a":{"b":"x","b":1}}]"#, "duplicate-key", "/1/a/b");
    rejects(r#"{"a":[0,1,9007199254740993]}"#, "unsafe-integer", "/a/2");
    rejects(r#"{"a":[0,"\udc00"]}"#, "invalid-json", "/a/1");
    rejects(r#"{"a":nul}"#, "invalid-json", "/a");
    // An invalid key belongs to its object.
    rejects(r#"{"a":{"\udc00":1}}"#, "invalid-json", "/a");
    rejects("", "invalid-json", "");
    rejects("1 2", "invalid-json", "");
}

#[test]
fn duplicate_keys_are_detected_after_escapes_are_decoded() {
    rejects(r#"{"a":1,"\u0061":2}"#, "duplicate-key", "/a");
    let value: Value = parse_json(r#"{"a":1,"A":2}"#).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 2);
}
