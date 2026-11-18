//! Helpers shared by this crate's unit tests.

/// Writes an executable script at `path`, from a `sh` child rather than this process. Unit tests run in parallel
/// threads: a file this process held open for writing would be inherited by a child another thread forks at that
/// moment, which holds it until its own exec, and executing the script meanwhile fails with ETXTBSY ("Text file
/// busy"). The child's descriptor never reaches this process.
#[cfg(unix)]
pub(crate) fn write_executable(path: &std::path::Path, text: &str) {
    use std::io::Write;
    let mut writer = std::process::Command::new("sh")
        .args(["-c", "cat > \"$1\" && chmod 755 \"$1\"", "sh"])
        .arg(path)
        .stdin(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    writer.stdin.take().unwrap().write_all(text.as_bytes()).unwrap();
    assert!(writer.wait().unwrap().success(), "{} was written", path.display());
}
