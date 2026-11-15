//! `cargo run --release -p projections-comparator-rules --example scale -- <native|sandbox> <x.comparator.yaml|default> <entities> <relationships> [default-comparator.wasm rules.wasm]`
//!
//! Compares two generated `graph/v0` extractions at the given size in which
//! every relationship changed, the worst case for a comparator's work, and
//! prints the time, the cost units spent (natively) and the process's peak
//! memory. `default` runs the default comparator alone.

use projections_comparator_rules::Comparator;
use projections_comparator_runtime::{ComparatorModule, Limits};
use serde_json::{Value, json};
use std::time::Instant;

fn graph(entities: usize, relationships: usize, prefix: &str) -> Value {
    let mut state = 0x9e37_79b9_u64;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    let nodes: Vec<Value> = (0..entities)
        .map(|index| json!({"id": format!("package:{index}"), "kind": "package", "label": format!("package {index}"), "data": {"size": index % 97}}))
        .collect();
    let edges: Vec<Value> = (0..relationships)
        .map(|index| {
            let from = next() as usize % entities;
            let to = next() as usize % entities;
            json!({"id": format!("{prefix}{index}"), "kind": "dependency", "from": format!("package:{from}"), "to": format!("package:{to}")})
        })
        .collect();
    json!({"protocolVersion": 0, "schema": "graph/v0", "entities": nodes, "relationships": edges})
}

/// The process's peak resident memory; NaN where `getrusage` doesn't exist (Windows).
#[cfg(not(unix))]
fn peak_memory_mib() -> f64 {
    f64::NAN
}

#[cfg(unix)]
fn peak_memory_mib() -> f64 {
    let mut usage = std::mem::MaybeUninit::<libc_rusage>::zeroed();
    unsafe { getrusage(0, usage.as_mut_ptr()) };
    let usage = unsafe { usage.assume_init() };
    // macOS reports bytes, Linux kilobytes.
    let bytes = if cfg!(target_os = "macos") {
        usage.maxrss as f64
    } else {
        usage.maxrss as f64 * 1024.0
    };
    bytes / 1024.0 / 1024.0
}

#[cfg(unix)]
#[repr(C)]
struct libc_rusage {
    utime: [i64; 2],
    stime: [i64; 2],
    maxrss: i64,
    rest: [i64; 13],
}

#[cfg(unix)]
unsafe extern "C" {
    fn getrusage(who: i32, usage: *mut libc_rusage) -> i32;
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mode, rules, entities, relationships) = (&args[0], &args[1], args[2].parse().unwrap(), args[3].parse().unwrap());
    let before = graph(entities, relationships, "r");
    let after = graph(entities, relationships, "s");
    let before = projections_engine::normalize(&before, "/before").unwrap();
    let after = projections_engine::normalize(&after, "/after").unwrap();
    let text = (rules != "default").then(|| std::fs::read_to_string(rules).unwrap());
    let start = Instant::now();
    let (changes, cost) = match mode.as_str() {
        "native" => match &text {
            None => (
                projections_comparator_default::compare(&before, &after, &json!({})).unwrap()["changes"]
                    .as_array()
                    .unwrap()
                    .len(),
                0,
            ),
            Some(text) => {
                let comparator = Comparator::from_yaml(text).unwrap();
                let (comparison, cost) = comparator.compare_with(&before, &after, &json!({}), u64::MAX).unwrap();
                (comparison["changes"].as_array().unwrap().len(), cost)
            }
        },
        _ => {
            let empty = json!({"protocolVersion": 0, "changes": [], "steps": []});
            let (path, options) = match &text {
                None => (&args[4], json!({})),
                Some(text) => (&args[5], json!({"rules": text})),
            };
            let module = ComparatorModule::load(&std::fs::read(path).unwrap()).unwrap();
            let input = json!({"protocolVersion": 0, "before": before, "after": after, "baseline": empty, "options": options});
            // Rules run under the rules limits (more fuel than a module's
            // default); the default comparator module under the default ones.
            let defaults = if text.is_some() { Limits::rules() } else { Limits::default() };
            let limits = Limits {
                fuel: std::env::var("FUEL").ok().and_then(|f| f.parse().ok()).unwrap_or(defaults.fuel),
                ..defaults
            };
            let comparison = module.compare(&input, &limits).unwrap_or_else(|error| panic!("{error}"));
            (comparison["changes"].as_array().unwrap().len(), 0)
        }
    };
    println!(
        "{{\"mode\": \"{mode}\", \"rules\": \"{rules}\", \"entities\": {entities}, \"relationships\": {relationships}, \"changes\": {changes}, \"ms\": {:.0}, \"cost\": {cost}, \"peakMiB\": {:.0}}}",
        start.elapsed().as_secs_f64() * 1e3,
        peak_memory_mib()
    );
}
