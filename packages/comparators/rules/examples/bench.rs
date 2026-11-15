//! `cargo run --release -p projections-comparator-rules --example bench -- x.comparator.yaml before.json after.json [runs]`
//! times reading the rules and comparing, against the native default comparator.

use projections_comparator_rules::{Comparator, DEFAULT_BUDGET};
use serde_json::{Value, json};
use std::time::Instant;

fn read(path: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let runs: u32 = args.get(3).and_then(|n| n.parse().ok()).unwrap_or(5);
    let text = std::fs::read_to_string(&args[0]).unwrap();
    let (before, after) = (read(&args[1]), read(&args[2]));
    let start = Instant::now();
    let comparator = Comparator::from_yaml(&text).unwrap();
    let parse = start.elapsed();
    let start = Instant::now();
    let mut cost = 0;
    for _ in 0..runs {
        cost = comparator.compare_with(&before, &after, &json!({}), DEFAULT_BUDGET).unwrap().1;
    }
    let rules = start.elapsed() / runs;
    let start = Instant::now();
    for _ in 0..runs {
        projections_comparator_default::compare(&before, &after, &json!({})).unwrap();
    }
    let native = start.elapsed() / runs;
    println!(
        "{{\"parseMs\": {:.2}, \"compareMs\": {:.2}, \"nativeDefaultMs\": {:.2}, \"cost\": {cost}}}",
        parse.as_secs_f64() * 1e3,
        rules.as_secs_f64() * 1e3,
        native.as_secs_f64() * 1e3
    );
}
