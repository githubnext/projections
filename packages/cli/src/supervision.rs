//! Bounded supervision of an extractor or tool process and every descendant it starts.
//!
//! On Unix the child leads a new process group, which is frozen and killed as a whole.
//! On Windows the child is created suspended, assigned to a new Job Object that kills
//! its processes when the job is terminated or its last handle closes (so even an
//! abnormally exiting CLI leaves nothing behind), and only then resumed, so no
//! descendant can start outside the job. Descendants can't break away from it.

#[cfg(not(windows))]
use anyhow::Result;
#[cfg(unix)]
use anyhow::bail;
#[cfg(not(windows))]
use std::process::{Child, Command};
use std::time::Duration;
#[cfg(unix)]
use std::time::Instant;

/// How long [`Group::drain`] keeps stopping descendants before reporting a failure.
#[cfg_attr(not(any(unix, windows)), allow(dead_code))]
const DRAIN_BOUND: Duration = Duration::from_secs(2);

#[cfg(unix)]
pub(crate) struct Group {
    pid: Option<u32>,
}

#[cfg(unix)]
impl Group {
    pub(crate) fn new() -> Result<Self> {
        Ok(Self { pid: None })
    }

    pub(crate) fn prepare(&self, command: &mut Command) {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    pub(crate) fn adopt(&mut self, child: &mut Child) -> Result<()> {
        self.pid = Some(child.id());
        Ok(())
    }

    /// Kills every member of the group.
    pub(crate) fn stop(&mut self, child: &mut Child) -> Result<()> {
        let Some(pid) = self.pid else { return Ok(()) };
        let result = terminate_group(pid);
        let zombie_only = result.as_ref().err().is_some_and(|error| {
            error
                .downcast_ref::<std::io::Error>()
                .is_some_and(|error| error.raw_os_error() == Some(libc::EPERM))
        });
        if zombie_only {
            // macOS reports EPERM for a zombie-only group, including descendants that exited
            // after their parent and await reaping by init. Reap the owned leader; drain
            // then verifies, within its bound, that nothing in the group is still alive.
            child.try_wait()?;
            return Ok(());
        }
        result
    }

    /// A descendant forked while the group was being signalled can miss that signal, so
    /// keep signalling the exact group until it is empty. Zombie-only groups report EPERM
    /// on macOS until they are reaped; anything still alive after the bound is a failure.
    pub(crate) fn drain(&self) -> Result<()> {
        let Some(pid) = self.pid else { return Ok(()) };
        let start = Instant::now();
        loop {
            unsafe { libc::kill(-(pid as i32), libc::SIGSTOP) };
            if unsafe { libc::kill(-(pid as i32), libc::SIGKILL) } != 0 {
                let error = std::io::Error::last_os_error();
                match error.raw_os_error() {
                    Some(libc::ESRCH) => return Ok(()),
                    Some(libc::EPERM) => {}
                    _ => return Err(error.into()),
                }
            }
            if start.elapsed() > DRAIN_BOUND {
                bail!("Descendant processes of the collector could not be stopped");
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}

#[cfg(unix)]
fn terminate_group(pid: u32) -> Result<()> {
    // The group was created for this exact child, never selected by name or port.
    // Freeze the whole group first: on macOS a member that is mid-fork when the group is
    // killed can survive SIGKILL and outlive its group. Stopped members can't fork.
    unsafe { libc::kill(-(pid as i32), libc::SIGSTOP) };
    if unsafe { libc::kill(-(pid as i32), libc::SIGKILL) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(error.into());
        }
    }
    Ok(())
}

#[cfg(windows)]
pub(crate) use windows::Group;

#[cfg(windows)]
mod windows {
    use anyhow::{Context, Result, bail};
    use std::os::windows::io::AsRawHandle;
    use std::process::{Child, Command};
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectBasicAccountingInformation,
        JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
    };
    use windows_sys::Win32::System::Threading::{CREATE_SUSPENDED, OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

    use super::DRAIN_BOUND;

    /// An owned handle closed on drop.
    struct Handle(HANDLE);
    // A kernel handle may be used and closed from any thread.
    unsafe impl Send for Handle {}
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    fn check(succeeded: i32, operation: &str) -> Result<()> {
        if succeeded == 0 {
            return Err(std::io::Error::last_os_error()).context(operation.to_owned());
        }
        Ok(())
    }

    pub(crate) struct Group {
        job: Handle,
    }

    impl Group {
        pub(crate) fn new() -> Result<Self> {
            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job.is_null() {
                return Err(std::io::Error::last_os_error()).context("Create a Job Object");
            }
            let job = Handle(job);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
            check(
                unsafe {
                    SetInformationJobObject(
                        job.0,
                        JobObjectExtendedLimitInformation,
                        (&raw const limits).cast(),
                        size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                    )
                },
                "Configure the Job Object to kill its processes on close",
            )?;
            Ok(Self { job })
        }

        pub(crate) fn prepare(&self, command: &mut Command) {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_SUSPENDED);
        }

        /// Assigns the suspended child to the job, then resumes it.
        pub(crate) fn adopt(&mut self, child: &mut Child) -> Result<()> {
            let result = (|| {
                check(
                    unsafe { AssignProcessToJobObject(self.job.0, child.as_raw_handle() as HANDLE) },
                    "Assign the process to its Job Object",
                )?;
                resume(child.id())
            })();
            if result.is_err() {
                let _ = child.kill();
                let _ = child.wait();
            }
            result
        }

        /// Terminates every process in the job.
        pub(crate) fn stop(&mut self, _child: &mut Child) -> Result<()> {
            check(unsafe { TerminateJobObject(self.job.0, 1) }, "Terminate the Job Object")
        }

        /// Terminates the job until no process remains in it, within the bound.
        pub(crate) fn drain(&self) -> Result<()> {
            let start = Instant::now();
            loop {
                check(unsafe { TerminateJobObject(self.job.0, 1) }, "Terminate the Job Object")?;
                let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
                check(
                    unsafe {
                        QueryInformationJobObject(
                            self.job.0,
                            JobObjectBasicAccountingInformation,
                            (&raw mut accounting).cast(),
                            size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                            std::ptr::null_mut(),
                        )
                    },
                    "Query the Job Object",
                )?;
                if accounting.ActiveProcesses == 0 {
                    return Ok(());
                }
                if start.elapsed() > DRAIN_BOUND {
                    bail!("Descendant processes of the collector could not be stopped");
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }
    }

    /// Resumes the initial thread of a process created suspended.
    fn resume(pid: u32) -> Result<()> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error()).context("List the process threads");
        }
        let snapshot = Handle(snapshot);
        let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
        entry.dwSize = size_of::<THREADENTRY32>() as u32;
        let mut resumed = 0;
        let mut more = unsafe { Thread32First(snapshot.0, &mut entry) } != 0;
        while more {
            if entry.th32OwnerProcessID == pid {
                let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                if thread.is_null() {
                    return Err(std::io::Error::last_os_error()).context("Open the process thread");
                }
                let thread = Handle(thread);
                if unsafe { ResumeThread(thread.0) } == u32::MAX {
                    return Err(std::io::Error::last_os_error()).context("Resume the process thread");
                }
                resumed += 1;
            }
            more = unsafe { Thread32Next(snapshot.0, &mut entry) } != 0;
        }
        if resumed == 0 {
            bail!("The started process has no thread to resume");
        }
        Ok(())
    }
}

#[cfg(not(any(unix, windows)))]
pub(crate) struct Group;

#[cfg(not(any(unix, windows)))]
impl Group {
    pub(crate) fn new() -> Result<Self> {
        anyhow::bail!("Bounded native execution requires POSIX process groups or Windows Job Objects")
    }
    pub(crate) fn prepare(&self, _: &mut Command) {}
    pub(crate) fn adopt(&mut self, _: &mut Child) -> Result<()> {
        Ok(())
    }
    pub(crate) fn stop(&mut self, _: &mut Child) -> Result<()> {
        Ok(())
    }
    pub(crate) fn drain(&self) -> Result<()> {
        Ok(())
    }
}
