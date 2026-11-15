//! The DevTools pipes on Unix: descriptors 3 and 4 of the browser.

use std::{
    fs::File,
    io,
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    os::unix::process::CommandExt,
    process::Command,
};

/// The parent's ends of the DevTools pipes, and the child's until it starts.
pub(super) struct Pipes {
    commands: OwnedFd,
    responses: OwnedFd,
    child_ends: (OwnedFd, OwnedFd),
}

impl Pipes {
    /// Closes the child's ends and returns the command writer and response reader.
    pub(super) fn connect(self) -> (File, File) {
        drop(self.child_ends);
        (File::from(self.commands), File::from(self.responses))
    }
}

fn pipe() -> io::Result<(OwnedFd, OwnedFd)> {
    let mut fds = [0; 2];
    #[cfg(target_os = "linux")]
    let result = unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC) };
    #[cfg(not(target_os = "linux"))]
    let result = unsafe { libc::pipe(fds.as_mut_ptr()) };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    let (read, write) = unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) };
    #[cfg(not(target_os = "linux"))]
    for fd in [&read, &write] {
        if unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok((read, write))
}

/// Arranges for the child to read commands on descriptor 3 and write
/// responses on descriptor 4, as `--remote-debugging-pipe` expects.
pub(super) fn attach(command: &mut Command) -> io::Result<Pipes> {
    let (command_read, command_write) = pipe()?;
    let (response_read, response_write) = pipe()?;
    let (input, output) = (command_read.as_raw_fd(), response_write.as_raw_fd());
    unsafe {
        command.pre_exec(move || {
            // Move both ends above 3 and 4 first, so neither dup2 clobbers the other.
            let input = libc::fcntl(input, libc::F_DUPFD_CLOEXEC, 10);
            let output = libc::fcntl(output, libc::F_DUPFD_CLOEXEC, 10);
            if input < 0 || output < 0 || libc::dup2(input, 3) < 0 || libc::dup2(output, 4) < 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    Ok(Pipes {
        commands: command_write,
        responses: response_read,
        child_ends: (command_read, response_write),
    })
}
