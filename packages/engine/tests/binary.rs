//! The `projections-engine` executable: one request on stdin, one response line
//! on stdout, and an exit status that reflects the response.

use projections_engine::MAX_REQUEST_BYTES;
use serde_json::{Value, json};
use std::io::Write;
use std::process::{Child, Command, Output, Stdio};
use std::sync::{Mutex, MutexGuard};

fn engine() -> Command {
    Command::new(env!("CARGO_BIN_EXE_projections-engine"))
}

/// Held while creating a pipe or starting a process. Where there is no `pipe2`
/// (macOS), a new pipe is close-on-exec only after a second call, so a process
/// another test starts in between inherits it; an inherited reader would keep a
/// pipe meant to have none writable.
fn spawning() -> MutexGuard<'static, ()> {
    static SPAWNING: Mutex<()> = Mutex::new(());
    SPAWNING.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn spawn(command: &mut Command) -> Child {
    let _spawning = spawning();
    command.spawn().unwrap()
}

fn run(input: &[u8]) -> Output {
    let mut child = spawn(engine().stdin(Stdio::piped()).stdout(Stdio::piped()));
    let mut stdin = child.stdin.take().unwrap();
    // The engine stops reading after its limit, so a write may see a closed pipe.
    let _ = stdin.write_all(input);
    drop(stdin);
    child.wait_with_output().unwrap()
}

fn response(output: &Output) -> Value {
    let stdout = std::str::from_utf8(&output.stdout).unwrap();
    let line = stdout.strip_suffix('\n').expect("one newline-terminated line");
    assert!(!line.contains('\n'), "{stdout}");
    serde_json::from_str(line).unwrap()
}

#[test]
fn a_successful_request_exits_zero() {
    let output = run(br#"{"version":0,"operation":"parse-json","json":"[1]"}"#);
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(response(&output), json!({"ok": true, "result": [1]}));
}

#[test]
fn a_failed_request_exits_one() {
    let output = run(br#"{"version":0,"operation":"unknown"}"#);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(response(&output)["diagnostics"][0]["code"], "unsupported-operation");
}

#[test]
fn oversized_stdin_is_a_request_size_failure() {
    let mut input = b"null".to_vec();
    input.resize(MAX_REQUEST_BYTES + 1, b' ');
    let output = run(&input);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(response(&output)["diagnostics"][0]["code"], "request-size-limit");
}

#[test]
fn unreadable_stdin_is_reported() {
    // Reading a directory fails with an I/O error on every supported platform.
    // Windows opens a directory handle only with FILE_FLAG_BACKUP_SEMANTICS.
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    std::os::windows::fs::OpenOptionsExt::custom_flags(&mut options, 0x0200_0000);
    let output = spawn(
        engine()
            .stdin(options.open(env!("CARGO_MANIFEST_DIR")).unwrap())
            .stdout(Stdio::piped()),
    )
    .wait_with_output()
    .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(response(&output)["diagnostics"][0]["code"], "stdin-failed");
}

#[test]
fn an_unwritable_stdout_exits_two() {
    // A pipe without a reader fails writes with a broken-pipe error.
    let mut child = {
        let _spawning = spawning();
        let (reader, writer) = std::io::pipe().unwrap();
        drop(reader);
        engine().stdin(Stdio::null()).stdout(writer).spawn().unwrap()
    };
    let status = child.wait().unwrap();
    assert_eq!(status.code(), Some(2));
}
