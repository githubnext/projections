use projections_engine::{MAX_REQUEST_BYTES, diagnostic_response, handle};
use std::io::{self, Read, Write};

fn main() {
    let mut input = Vec::new();
    let response = match io::stdin().take((MAX_REQUEST_BYTES + 1) as u64).read_to_end(&mut input) {
        Ok(_) => handle(&input),
        Err(error) => diagnostic_response("stdin-failed", &error.to_string()),
    };
    let success = response["ok"] == true;
    let mut stdout = io::stdout().lock();
    if serde_json::to_writer(&mut stdout, &response).is_err() || writeln!(stdout).is_err() {
        std::process::exit(2);
    }
    std::process::exit(if success { 0 } else { 1 });
}
