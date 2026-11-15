//! `cargo run -p projections-comparator-rules --example compare -- x.comparator.yaml before.json after.json [options.json]`
//! prints the comparison and the cost it spent, or every problem found.

use projections_comparator_rules::{Comparator, DEFAULT_BUDGET};
use serde_json::{Value, json};

fn read(path: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap_or_else(|error| panic!("{path}: {error}"))).unwrap()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let options = args.get(3).map(|path| read(path)).unwrap_or_else(|| json!({}));
    let result = Comparator::from_yaml(&std::fs::read_to_string(&args[0]).unwrap())
        .and_then(|comparator| comparator.compare_with(&read(&args[1]), &read(&args[2]), &options, DEFAULT_BUDGET));
    match result {
        Ok((comparison, cost)) => {
            println!("{}", serde_json::to_string_pretty(&comparison).unwrap());
            eprintln!("cost: {cost} units");
        }
        Err(failure) => {
            for diagnostic in failure {
                eprintln!("{diagnostic}");
            }
            std::process::exit(1);
        }
    }
}
