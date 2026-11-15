//! The engine request ABI: operations, field strictness, size limits and the
//! response envelope.

use projections_engine::{
    ABI_VERSION, Diagnostic, MAX_EXTRACTION_BYTES, MAX_JSON_BYTES, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, canonical, diagnostic_response,
    fail, handle, pointer, utf16_cmp,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;

fn node(id: &str) -> Value {
    json!({"id": id, "kind": "entity", "label": id})
}

fn graph(entities: Value, relationships: Value) -> Value {
    json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": relationships})
}

fn request(value: &Value) -> Value {
    handle(serde_json::to_string(value).unwrap().as_bytes())
}

fn error(response: &Value, code: &str, path: &str) {
    assert_eq!(response["ok"], false, "{response}");
    assert_eq!(response["diagnostics"][0]["code"], code, "{response}");
    assert_eq!(response["diagnostics"][0]["path"], path, "{response}");
}

/// Pads `json` with insignificant whitespace to exactly `length` bytes.
fn padded(json: &str, length: usize) -> String {
    format!("{json}{}", " ".repeat(length - json.len()))
}

#[test]
fn limits_match_the_contracts() {
    assert_eq!(MAX_REQUEST_BYTES, 128 * 1024 * 1024);
    assert_eq!(MAX_RESPONSE_BYTES, 64 * 1024 * 1024);
    assert_eq!(MAX_JSON_BYTES, 32 * 1024 * 1024);
    assert_eq!(MAX_EXTRACTION_BYTES, 8 * 1024 * 1024);
}

#[test]
fn diagnostics_render_their_code_path_and_message() {
    let diagnostic = Diagnostic::new("code", "/a", "Message");
    assert_eq!(diagnostic.to_string(), "code at /a: Message");
    assert_eq!(Diagnostic::new("code", "", "Message").to_string(), "code at /: Message");
    assert_eq!(fail("code", "/a", "Message"), vec![diagnostic]);
}

#[test]
fn pointers_escape_tilde_before_slash() {
    assert_eq!(pointer("", "plain"), "/plain");
    assert_eq!(pointer("/root", "~/"), "/root/~0~1");
    assert_eq!(pointer("", "/~"), "/~1~0");
    assert_eq!(pointer("", ""), "/");
}

#[test]
fn ids_order_by_utf16_code_units() {
    // U+1F600 is a surrogate pair (0xD83D...), which sorts before U+E000 in
    // UTF-16 even though it sorts after it in UTF-8 and by code point.
    assert_eq!(utf16_cmp("\u{1f600}", "\u{e000}"), Ordering::Less);
    assert_eq!(utf16_cmp("\u{e000}", "\u{1f600}"), Ordering::Greater);
    assert_eq!(utf16_cmp("a", "a"), Ordering::Equal);
    assert_eq!(utf16_cmp("a", "ab"), Ordering::Less);
}

#[test]
fn canonical_json_sorts_keys_and_formats_numbers() {
    assert_eq!(
        canonical(&json!({"b": [1.0, 1.5, "x"], "a": null})).unwrap(),
        r#"{"a":null,"b":[1,1.5,"x"]}"#
    );
}

#[test]
fn the_response_envelope_is_exact() {
    assert_eq!(
        diagnostic_response("some-code", "Some message"),
        json!({"ok": false, "diagnostics": [
            {"severity": "error", "code": "some-code", "path": "", "message": "Some message"}
        ]})
    );
    assert_eq!(
        request(&json!({"version": 0, "operation": "parse-json", "json": "[1]"})),
        json!({"ok": true, "result": [1]})
    );
}

#[test]
fn requests_must_be_versioned_objects_with_a_known_operation() {
    assert_eq!(ABI_VERSION, 0);
    error(&handle(b"[]"), "invalid-type", "");
    error(&handle(b"{\"x\":"), "invalid-json", "/x");
    error(&handle(br#"{"operation":"normalize"}"#), "unsupported-version", "/version");
    error(
        &handle(br#"{"version":"2","operation":"normalize"}"#),
        "unsupported-version",
        "/version",
    );
    error(&handle(br#"{"version":0}"#), "invalid-type", "/operation");
    error(&handle(br#"{"version":0,"operation":" "}"#), "invalid-type", "/operation");
    // A float equal to the version is the same JSON number.
    error(
        &handle(br#"{"version":0.0,"operation":"normalize"}"#),
        "invalid-type",
        "/extraction",
    );
}

#[test]
fn every_operation_rejects_unknown_fields() {
    let extraction = graph(json!([]), json!([]));
    for (operation, mut value) in [
        ("decode", json!({"json": "{}"})),
        ("parse-json", json!({"json": "{}"})),
        ("normalize", json!({"extraction": extraction})),
        ("canonicalize", json!({"extraction": extraction})),
        (
            "validate-comparison",
            json!({"before": extraction, "after": extraction, "comparison": {}}),
        ),
    ] {
        value["version"] = json!(0);
        value["operation"] = json!(operation);
        value["extra"] = json!(true);
        error(&request(&value), "unknown-field", "/extra");
    }
}

#[test]
fn decode_parses_and_normalizes_raw_extractor_json() {
    let raw = serde_json::to_string(&graph(json!([node("b"), node("a")]), json!([]))).unwrap();
    let response = request(&json!({"version": 0, "operation": "decode", "json": raw}));
    assert_eq!(response["ok"], true, "{response}");
    assert_eq!(response["result"]["entities"][0]["id"], "a");
    assert_eq!(response["result"]["entities"][0]["data"], json!({}));
    // Decode diagnostics point into the decoded document, not the request.
    error(
        &request(&json!({"version": 0, "operation": "decode", "json": "{\"nodes\":[]}"})),
        "unknown-field",
        "/nodes",
    );
    error(
        &request(&json!({"version": 0, "operation": "decode", "json": 1})),
        "invalid-type",
        "/json",
    );
    // An empty string is still a string, and then invalid JSON.
    error(
        &request(&json!({"version": 0, "operation": "decode", "json": ""})),
        "invalid-json",
        "",
    );
}

#[test]
fn decode_bounds_extractor_json_at_8_mib() {
    let raw = serde_json::to_string(&graph(json!([node("a")]), json!([]))).unwrap();
    let at_limit = padded(&raw, MAX_EXTRACTION_BYTES);
    let response = request(&json!({"version": 0, "operation": "decode", "json": at_limit}));
    assert_eq!(response["ok"], true);
    let over = padded(&raw, MAX_EXTRACTION_BYTES + 1);
    let response = request(&json!({"version": 0, "operation": "decode", "json": over}));
    error(&response, "extraction-size-limit", "/json");
    assert_eq!(response["diagnostics"][0]["message"], "Extractor JSON exceeds 8 MiB");
    // The extraction bound does not apply to generic JSON.
    let response = request(&json!({"version": 0, "operation": "parse-json",
        "json": padded("null", MAX_EXTRACTION_BYTES + 1)}));
    assert_eq!(response, json!({"ok": true, "result": null}));
}

#[test]
fn parse_json_bounds_artifact_json_at_32_mib() {
    let at_limit = padded("[]", MAX_JSON_BYTES);
    assert_eq!(
        request(&json!({"version": 0, "operation": "parse-json", "json": at_limit})),
        json!({"ok": true, "result": []})
    );
    let over = padded("[]", MAX_JSON_BYTES + 1);
    let response = request(&json!({"version": 0, "operation": "parse-json", "json": over}));
    error(&response, "json-size-limit", "/json");
    assert_eq!(response["diagnostics"][0]["message"], "Artifact JSON exceeds 32 MiB");
}

#[test]
fn normalize_and_canonicalize_report_paths_under_the_extraction() {
    let extraction = graph(json!([node("b"), node("a")]), json!([]));
    let normalized = request(&json!({"version": 0, "operation": "normalize", "extraction": extraction}));
    assert_eq!(normalized["result"]["entities"][0]["id"], "a");
    let canonicalized = request(&json!({"version": 0, "operation": "canonicalize", "extraction": extraction}));
    let result = &canonicalized["result"];
    assert_eq!(result.as_object().unwrap().len(), 2, "{result}");
    let canonical = result["canonical"].as_str().unwrap();
    assert_eq!(
        canonical,
        r#"{"entities":[{"data":{},"id":"a","kind":"entity","label":"a"},{"data":{},"id":"b","kind":"entity","label":"b"}],"protocolVersion":0,"relationships":[],"schema":"graph/v0"}"#
    );
    assert_eq!(result["digest"], format!("{:x}", Sha256::digest(canonical.as_bytes())));
    for operation in ["normalize", "canonicalize"] {
        error(
            &request(&json!({"version": 0, "operation": operation, "extraction": []})),
            "invalid-type",
            "/extraction",
        );
    }
}

#[test]
fn validate_comparison_normalizes_both_sides_and_returns_the_comparison() {
    let before = graph(json!([node("a")]), json!([]));
    let after = graph(json!([node("a"), node("b")]), json!([]));
    let comparison = json!({"protocolVersion": 0, "changes": [
        {"id": "b", "collection": "entities", "before": [], "after": ["b"], "status": "added", "correspondence": "none"}
    ], "steps": [{"changes": ["b"]}]});
    let response = request(&json!({"version": 0, "operation": "validate-comparison",
        "before": before, "after": after, "comparison": comparison}));
    assert_eq!(response, json!({"ok": true, "result": comparison}));
    error(
        &request(&json!({"version": 0, "operation": "validate-comparison",
            "before": {}, "after": after, "comparison": comparison})),
        "unsupported-version",
        "/before/protocolVersion",
    );
    error(
        &request(&json!({"version": 0, "operation": "validate-comparison",
            "before": before, "after": {}, "comparison": comparison})),
        "unsupported-version",
        "/after/protocolVersion",
    );
}

#[test]
fn requests_are_bounded_at_128_mib() {
    let at_limit = padded("[]", MAX_REQUEST_BYTES);
    // At the limit the request is read, and then rejected as a non-object.
    error(&handle(at_limit.as_bytes()), "invalid-type", "");
    let over = padded("[]", MAX_REQUEST_BYTES + 1);
    let response = handle(over.as_bytes());
    assert_eq!(
        response,
        diagnostic_response("request-size-limit", "Engine request exceeds 128 MiB")
    );
}

/// A parse-json request whose successful response is exactly `length` bytes.
/// `1e15` serializes as `1000000000000000.0`, so a request under the JSON
/// limit can expand past the response limit.
fn expanding(length: usize) -> (Value, usize) {
    // `{"ok":true,"result":[` + items joined by commas + `]}`
    let budget = length - r#"{"ok":true,"result":[]}"#.len() + 1;
    let (wide, rest) = (budget / 19, budget % 19);
    assert_eq!(rest % 2, 0, "pad with `1,` items");
    let items = std::iter::repeat_n("1e15", wide).chain(std::iter::repeat_n("1", rest / 2));
    let raw = format!("[{}]", items.collect::<Vec<_>>().join(","));
    assert!(raw.len() <= MAX_JSON_BYTES);
    (json!({"version": 0, "operation": "parse-json", "json": raw}), wide + rest / 2)
}

#[test]
fn responses_are_bounded_at_64_mib() {
    let (at_limit, count) = expanding(MAX_RESPONSE_BYTES);
    let response = request(&at_limit);
    assert_eq!(response["ok"], true);
    assert_eq!(response["result"].as_array().unwrap().len(), count);
    assert_eq!(serde_json::to_vec(&response).unwrap().len(), MAX_RESPONSE_BYTES);
    drop(response);
    let (over, _) = expanding(MAX_RESPONSE_BYTES + 2);
    assert_eq!(
        request(&over),
        diagnostic_response("response-size-limit", "Engine response exceeds 64 MiB")
    );
}
