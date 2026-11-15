//! The rules every ecosystem shares.

use crate::testing::function_value;
use serde_json::json;

#[test]
fn changed_facts_lists_differing_and_one_sided_fields_and_native_ones() {
    assert_eq!(
        function_value("changedFacts({'a': 1, 'b': 2, 'c': 3}, {'a': 1, 'b': 3, 'd': 4})"),
        json!(["b", "c", "d"])
    );
    assert_eq!(function_value("changedFacts({'a': 1}, {'a': 1})"), json!([]));
    assert_eq!(
        function_value("changedFacts({'a': 1, 'native': {'x': 1}}, {'a': 1, 'native': {'x': 2, 'y': 3}})"),
        json!(["native.x", "native.y"])
    );
}

#[test]
fn fill_leaves_unknown_and_unclosed_fields_as_written() {
    assert_eq!(
        function_value("fill('{a} and {b}, {a', {'a': 'x {b}'})"),
        json!("x {b} and {b}, {a")
    );
}
