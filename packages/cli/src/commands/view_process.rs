//! The viewer's process, for `projections view` and its subcommands: finding the running one, starting one in the
//! background, stopping it, and opening its page.

use std::{path::Path, time::Duration};

use anyhow::{Context, Result, bail, ensure};

use crate::view::{client, registry};

/// The viewer running for the repository at `root`, if one answers; a stale record is removed.
pub(super) async fn running_viewer(root: &Path) -> Option<registry::Record> {
    registry::live(root, Duration::from_secs(5)).await
}

/// Refuses `--port` when the viewer running for the project listens on another: a project has one viewer, and its
/// URL is the one its pages know.
pub(super) fn same_port(record: &registry::Record, port: Option<u16>) -> Result<()> {
    if let (Some(asked), Some((running, _))) = (port.filter(|port| *port != 0), record.address())
        && asked != running
    {
        bail!(
            "A viewer is already running for this repository on port {running} ({}). Stop it with projections view stop, then start it on port {asked}",
            record.url
        );
    }
    Ok(())
}

/// Stops the viewer `record` names and waits until its URL no longer answers, so its port is free.
pub(super) async fn stop_viewer(root: &Path, record: &registry::Record) -> Result<()> {
    let response = client::request(&record.url, "POST", "control/stop", None, Duration::from_secs(10)).await?;
    ensure!(response.status == 200, "The viewer refused to stop ({})", response.status);
    for _ in 0..100 {
        if client::request(&record.url, "GET", "control/state", None, Duration::from_secs(1))
            .await
            .is_err()
        {
            registry::remove(root, &record.url);
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    bail!("The viewer at {} didn't stop", record.url)
}

/// Starts `projections view` in the background for this project of `root`,
/// stopping itself when idle, and returns its URL once it is recorded and
/// answers. With `trust`, it replaces a viewer running without trust. It listens on `port`, else the project's kept one.
pub(super) async fn start_viewer(root: &Path, trust: bool, port: Option<u16>) -> Result<String> {
    let mut command = std::process::Command::new(std::env::current_exe()?);
    // The same project as this command's, which a viewer started at the repository's root wouldn't find again.
    let project = crate::project::prefix();
    command.arg("-C").arg(root);
    if !project.is_empty() {
        command.arg("--root").arg(project);
    }
    command
        .args(["view", "--idle-exit", "15"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    if trust {
        command.arg("--trust");
    }
    if let Some(port) = port {
        // Said here, since the viewer's own output goes nowhere.
        if port != 0 {
            std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
                .with_context(|| format!("Port {port} is taken: stop what uses it, or pass another --port (or none, for any free one)"))?;
        }
        command.arg("--port").arg(port.to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own process group, so the terminal's Ctrl+C for this command doesn't stop it.
        command.process_group(0);
    }
    #[cfg(windows)]
    keep_standard_handles();
    let mut child = command.spawn().context("Cannot start the viewer")?;
    for _ in 0..300 {
        if let Some(record) = running_viewer(root).await
            && record.pid == child.id()
        {
            eprintln!("Started the Projections viewer: {}", record.url);
            return Ok(record.url);
        }
        if let Some(status) = child.try_wait()? {
            bail!("The viewer stopped as it started ({status})");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    bail!("The viewer didn't start in 30 seconds")
}

/// Makes this process's standard handles uninheritable. Windows gives a child every inheritable handle, so the viewer
/// would hold this command's output pipes open for its lifetime, and whoever reads them (`execFile` in the Copilot
/// canvas, a test) would wait until the viewer exits rather than for this command.
#[cfg(windows)]
fn keep_standard_handles() {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{HANDLE_FLAG_INHERIT, SetHandleInformation};
    for handle in [
        std::io::stdin().as_raw_handle(),
        std::io::stdout().as_raw_handle(),
        std::io::stderr().as_raw_handle(),
    ] {
        if !handle.is_null() {
            // A handle that isn't one (no console) refuses, which changes nothing.
            unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) };
        }
    }
}

/// Opens `url` in the default browser.
pub(super) fn open_browser(url: &str) -> Result<()> {
    let mut command = if cfg!(target_os = "macos") {
        std::process::Command::new("open")
    } else if cfg!(windows) {
        let mut command = std::process::Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
        command
    } else {
        std::process::Command::new("xdg-open")
    };
    command
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .context("Cannot open the default browser")?;
    Ok(())
}
