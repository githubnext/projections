//! `cargo run -p projections-comparator-rules --example check -- [--deny-warnings] [--chains] x.comparator.yaml...`
//! checks rules files and prints every problem and lint warning, with its line
//! and column. `--deny-warnings` fails on warnings too; `--chains` prints, per
//! file, how many chains of two or more conditionals it has (for audits).
//! A path `docs.md#name` checks the YAML block in `docs.md` whose first line
//! names `name`.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let deny = args.iter().any(|arg| arg == "--deny-warnings");
    let audit = args.iter().any(|arg| arg == "--chains");
    let mut failed = false;
    for path in args.iter().filter(|arg| !arg.starts_with("--")) {
        let text = match path.split_once(".md#") {
            Some((file, name)) => {
                let doc = std::fs::read_to_string(format!("{file}.md")).unwrap();
                let start = doc
                    .find(&format!("```yaml\n# {name}\n"))
                    .unwrap_or_else(|| panic!("{path}: no such example"))
                    + "```yaml\n".len();
                let end = start + doc[start..].find("\n```").unwrap() + 1;
                doc[start..end].to_owned()
            }
            None => std::fs::read_to_string(path).unwrap(),
        };
        match projections_comparator_rules::Comparator::from_yaml(&text) {
            Ok(comparator) => {
                if audit {
                    println!("{path}: {} chains of two or more conditionals", comparator.conditional_chains());
                }
                for warning in comparator.warnings() {
                    println!("{path}: warning: {warning}");
                    failed |= deny;
                }
                if comparator.warnings().is_empty() {
                    println!("ok {path}");
                }
            }
            Err(failure) => {
                failed = true;
                for diagnostic in failure {
                    println!("{path}: {diagnostic}");
                }
            }
        }
    }
    if failed {
        std::process::exit(1);
    }
}
