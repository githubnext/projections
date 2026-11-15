use anyhow::{Context, Result, bail};

/// The shutdown requests the CLI honors: SIGINT and SIGTERM on Unix; Ctrl+C,
/// Ctrl+Break and console close on Windows.
pub struct Shutdown {
    #[cfg(unix)]
    interrupt: tokio::signal::unix::Signal,
    #[cfg(unix)]
    terminate: tokio::signal::unix::Signal,
    #[cfg(windows)]
    interrupt: tokio::signal::windows::CtrlC,
    #[cfg(windows)]
    terminate: tokio::signal::windows::CtrlBreak,
    #[cfg(windows)]
    close: tokio::signal::windows::CtrlClose,
}

impl Shutdown {
    pub fn new() -> Result<Self> {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{SignalKind, signal};
            Ok(Self {
                interrupt: signal(SignalKind::interrupt()).context("Register SIGINT shutdown")?,
                terminate: signal(SignalKind::terminate()).context("Register SIGTERM shutdown")?,
            })
        }
        #[cfg(windows)]
        {
            use tokio::signal::windows::{ctrl_break, ctrl_c, ctrl_close};
            Ok(Self {
                interrupt: ctrl_c().context("Register Ctrl+C shutdown")?,
                terminate: ctrl_break().context("Register Ctrl+Break shutdown")?,
                close: ctrl_close().context("Register console close shutdown")?,
            })
        }
        #[cfg(not(any(unix, windows)))]
        bail!("Native shutdown support requires POSIX signals or Windows console events");
    }

    pub async fn wait(mut self) -> Result<()> {
        #[cfg(unix)]
        let signal = tokio::select! {value=self.interrupt.recv()=>value,value=self.terminate.recv()=>value};
        #[cfg(windows)]
        let signal = tokio::select! {value=self.interrupt.recv()=>value,value=self.terminate.recv()=>value,value=self.close.recv()=>value};
        #[cfg(not(any(unix, windows)))]
        let signal: Option<()> = None;
        if signal.is_none() {
            bail!("Native shutdown signal stream closed");
        }
        Ok(())
    }
}
