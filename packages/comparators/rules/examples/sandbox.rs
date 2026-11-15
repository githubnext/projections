//! `cargo run --release -p projections-comparator-rules --example sandbox -- default-comparator.wasm rules.wasm x.comparator.yaml before.json after.json [runs]`
//! times, in the sandboxed comparator runtime (wasmi) as the CLI runs them:
//! the default comparator module, and the rules module running `rules.yaml`
//! (which computes its own baseline).

use projections_comparator_runtime::{ComparatorModule, Limits};
use serde_json::{Value, json};
use std::time::Instant;

fn read(path: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let runs: u32 = args.get(5).and_then(|n| n.parse().ok()).unwrap_or(3);
    let default_module = ComparatorModule::load(&std::fs::read(&args[0]).unwrap()).unwrap();
    let rules_module = ComparatorModule::load(&std::fs::read(&args[1]).unwrap()).unwrap();
    let rules = Value::String(std::fs::read_to_string(&args[2]).unwrap());
    let (before, after) = (read(&args[3]), read(&args[4]));
    let before = projections_engine::normalize(&before, "/before").unwrap();
    let after = projections_engine::normalize(&after, "/after").unwrap();
    let empty = json!({"protocolVersion": 0, "changes": [], "steps": []});
    let time = |module: &ComparatorModule, baseline: &Value, options: Value| {
        let input = json!({"protocolVersion": 0, "before": before, "after": after, "baseline": baseline, "options": options});
        let start = Instant::now();
        let mut output = Value::Null;
        for _ in 0..runs {
            output = module.compare(&input, &Limits::default()).unwrap();
        }
        (start.elapsed().as_secs_f64() * 1e3 / f64::from(runs), output)
    };
    let (default_ms, _) = time(&default_module, &empty, json!({}));
    let (rules_ms, _) = time(&rules_module, &empty, json!({"rules": rules}));
    // Checking a rules file (parsing and type-checking it, once per content).
    let start = Instant::now();
    for _ in 0..runs {
        ComparatorModule::rules(&rules_module, rules.as_str().unwrap().as_bytes()).unwrap();
    }
    let check_ms = start.elapsed().as_secs_f64() * 1e3 / f64::from(runs);
    println!("{{\"defaultComparatorWasmMs\": {default_ms:.1}, \"rulesWasmMs\": {rules_ms:.1}, \"rulesCheckWasmMs\": {check_ms:.1}}}");
}
