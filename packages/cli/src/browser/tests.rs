use super::websocket::{read_frame, write_frame};
use super::*;
use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

#[test]
fn base64_round_trips() {
    for text in ["", "f", "fo", "foo", "foob", "fooba", "foobar"] {
        let encoded = base64_encode(text.as_bytes());
        assert_eq!(base64_decode(&encoded).unwrap(), text.as_bytes());
    }
    assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    assert_eq!(base64_encode(b"fo"), "Zm8=");
    assert!(base64_decode("Zm9v!").is_err());
}

#[test]
fn websocket_frames_round_trip_masked_and_long() {
    for length in [0, 125, 126, 65_535, 65_536, 200_000] {
        let payload: Vec<u8> = (0..length).map(|index| (index % 251) as u8).collect();
        let mut frame = Vec::new();
        write_frame(&mut frame, 0x1, &payload).unwrap();
        let (fin, opcode, read) = read_frame(&mut frame.as_slice(), usize::MAX).unwrap();
        assert!(fin);
        assert_eq!(opcode, 0x1);
        assert_eq!(read, payload);
    }
    let mut frame = Vec::new();
    write_frame(&mut frame, 0x1, &[0; 300]).unwrap();
    assert!(read_frame(&mut frame.as_slice(), 299).is_err());
}

#[test]
fn a_missing_explicit_browser_names_the_option() {
    let error = find(Some(Path::new("/nonexistent/chrome"))).unwrap_err();
    assert!(error.to_string().contains("--browser"), "{error}");
}

#[test]
fn launches_wait_for_a_free_slot() {
    let directory = tempfile::tempdir().unwrap();
    let cancel = AtomicBool::new(false);
    let held: Vec<_> = (0..2)
        .map(|_| gate::acquire_in(directory.path(), &cancel, Duration::ZERO).unwrap())
        .collect();
    assert!(held.iter().all(|slot| slot.held()));
    // Every slot is taken: a launch waits, then starts without one.
    let started = Instant::now();
    let waited = gate::acquire_in(directory.path(), &cancel, Duration::from_millis(200)).unwrap();
    assert!(!waited.held());
    assert!(started.elapsed() >= Duration::from_millis(200));
    // A released slot is taken by the next launch once it is free. A child another thread forks holds a copy of the
    // slot's descriptor, and so its lock, until it execs (the descriptor closes on exec): while one does, the dropped
    // slots stay locked, and the next launch waits for them.
    #[cfg(unix)]
    {
        let child = ForkedChild::spawn();
        drop(held);
        assert!(
            !gate::acquire_in(directory.path(), &cancel, Duration::ZERO).unwrap().held(),
            "the forked child holds both slots"
        );
        child.exec();
    }
    #[cfg(not(unix))]
    drop(held);
    assert!(gate::acquire_in(directory.path(), &cancel, Duration::from_secs(10)).unwrap().held());
    let taken: Vec<_> = (0..2)
        .map(|_| gate::acquire_in(directory.path(), &cancel, Duration::from_secs(10)).unwrap())
        .collect();
    assert!(taken.iter().all(|slot| slot.held()));
    cancel.store(true, Ordering::SeqCst);
    assert!(gate::acquire_in(directory.path(), &cancel, Duration::from_secs(60)).is_err());
}

/// A child forked from another thread and held between fork and exec, as a test thread's spawn can be: until it
/// execs, it holds a copy of every descriptor this process had open when it forked.
#[cfg(unix)]
struct ForkedChild {
    release: std::io::PipeWriter,
    thread: std::thread::JoinHandle<()>,
}

#[cfg(unix)]
impl ForkedChild {
    /// Returns once the child has forked; it waits in `pre_exec` until `exec`.
    fn spawn() -> ForkedChild {
        use std::io::Read;
        use std::os::fd::AsRawFd;
        use std::os::unix::process::CommandExt;
        let (mut ready, ready_writer) = std::io::pipe().unwrap();
        let (release_reader, release) = std::io::pipe().unwrap();
        let (signal, wait) = (ready_writer.as_raw_fd(), release_reader.as_raw_fd());
        let thread = std::thread::spawn(move || {
            let mut command = std::process::Command::new("true");
            // SAFETY: the child only writes to and reads from pipes it inherited, which is async-signal-safe.
            unsafe {
                command.pre_exec(move || {
                    let mut byte = [1u8];
                    libc::write(signal, byte.as_ptr().cast(), 1);
                    libc::read(wait, byte.as_mut_ptr().cast(), 1);
                    Ok(())
                });
            }
            command.status().unwrap();
            drop((ready_writer, release_reader));
        });
        ready.read_exact(&mut [0u8]).unwrap();
        ForkedChild { release, thread }
    }

    /// Lets the child exec, closing its copies of the descriptors, and waits for it.
    fn exec(self) {
        use std::io::Write;
        let ForkedChild { mut release, thread } = self;
        release.write_all(&[1]).unwrap();
        thread.join().unwrap();
    }
}

/// A stand-in browser that records each start in `starts`, then runs `body`.
#[cfg(unix)]
fn fake_browser(directory: &Path, body: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let (script, starts) = (directory.join("browser"), directory.join("starts"));
    crate::test_support::write_executable(&script, &format!("#!/bin/sh\necho started >> '{}'\n{body}\n", starts.display()));
    (script, starts)
}

#[cfg(unix)]
fn launch_fake(executable: &Path) -> anyhow::Result<Browser> {
    Browser::launch(LaunchOptions {
        executable,
        transport: Transport::Pipe,
        width: 100,
        height: 100,
        scale: 1.0,
        startup: Duration::from_secs(30),
        cancel: Arc::new(AtomicBool::new(false)),
    })
}

#[cfg(unix)]
#[test]
fn a_browser_ended_by_a_signal_while_starting_is_started_once_more() {
    let directory = tempfile::tempdir().unwrap();
    let (aborting, starts) = fake_browser(directory.path(), "kill -TERM $$");
    let error = launch_fake(&aborting).err().expect("an aborting browser fails");
    assert!(format!("{error:#}").contains("started again after it aborted"), "{error:#}");
    assert_eq!(std::fs::read_to_string(&starts).unwrap().lines().count(), 2);

    let directory = tempfile::tempdir().unwrap();
    let (exiting, starts) = fake_browser(directory.path(), "exit 3");
    let error = launch_fake(&exiting).err().expect("an exiting browser fails");
    assert!(!format!("{error:#}").contains("started again"), "{error:#}");
    assert_eq!(std::fs::read_to_string(&starts).unwrap().lines().count(), 1);
}

#[cfg(unix)]
#[test]
fn a_browser_that_never_answers_fails_after_the_callers_startup_budget_with_its_output() {
    let directory = tempfile::tempdir().unwrap();
    let (silent, _) = fake_browser(directory.path(), "echo 'still starting' >&2\nexec sleep 60");
    let started = Instant::now();
    let error = Browser::launch(LaunchOptions {
        executable: &silent,
        transport: Transport::Pipe,
        width: 100,
        height: 100,
        scale: 1.0,
        startup: Duration::from_secs(1),
        cancel: Arc::new(AtomicBool::new(false)),
    })
    .err()
    .expect("a silent browser fails");
    let message = format!("{error:#}");
    assert!(started.elapsed() < Duration::from_secs(10), "waited {:?}", started.elapsed());
    assert!(message.contains("within 1 s") && message.contains("still starting"), "{message}");
}

/// A stand-in browser that records each start, then answers every DevTools command on the pipe.
#[cfg(unix)]
fn answering_browser(directory: &Path) -> (std::path::PathBuf, std::path::PathBuf) {
    fake_browser(
        directory,
        r#"exec node -e '
const fs = require("fs");
let pending = "";
fs.createReadStream(null, {fd: 3}).on("data", chunk => {
  pending += chunk;
  let end;
  while ((end = pending.indexOf("\0")) >= 0) {
    const {id, method} = JSON.parse(pending.slice(0, end));
    pending = pending.slice(end + 1);
    fs.writeSync(4, JSON.stringify({id, result: {browserContextId: "context", targetId: "target", sessionId: "session"}}) + "\0");
    if (method === "Browser.close") process.exit(0);
  }
});'"#,
    )
}

#[cfg(unix)]
#[test]
fn a_pool_reuses_a_browser_launched_the_same_way() {
    let directory = tempfile::tempdir().unwrap();
    let (executable, starts) = answering_browser(directory.path());
    let started = || std::fs::read_to_string(&starts).unwrap().lines().count();
    let options = |width| LaunchOptions {
        executable: &executable,
        transport: Transport::Pipe,
        width,
        height: 100,
        scale: 1.0,
        startup: Duration::from_secs(30),
        cancel: Arc::new(AtomicBool::new(false)),
    };
    let render = |pool: &Pool, width| {
        let mut browser = pool.take(options(width)).unwrap();
        let page = browser.open_page(Instant::now() + Duration::from_secs(10)).unwrap();
        pool.give(browser, page).unwrap();
    };
    let pool = Pool::new();
    render(&pool, 100);
    render(&pool, 100);
    assert_eq!(started(), 1, "the second render reuses the first's browser");
    render(&pool, 200);
    assert_eq!(started(), 2, "a browser launched another way is not reused");
    pool.close();
    render(&Pool::single_use(), 100);
    render(&pool, 100);
    assert_eq!(started(), 4, "a single-use or closed pool keeps nothing");
}

#[cfg(unix)]
#[test]
fn one_worker_closes_a_kept_browser_once_it_is_idle() {
    let directory = tempfile::tempdir().unwrap();
    let (executable, starts) = answering_browser(directory.path());
    let started = || std::fs::read_to_string(&starts).unwrap().lines().count();
    let pool = Pool::expiring(Duration::from_millis(500));
    let render = || {
        let mut browser = pool
            .take(LaunchOptions {
                executable: &executable,
                transport: Transport::Pipe,
                width: 100,
                height: 100,
                scale: 1.0,
                startup: Duration::from_secs(30),
                cancel: Arc::new(AtomicBool::new(false)),
            })
            .unwrap();
        let page = browser.open_page(Instant::now() + Duration::from_secs(10)).unwrap();
        pool.give(browser, page).unwrap();
    };
    // Renders that keep coming keep the browser, each moving its expiry later, with one worker throughout.
    for _ in 0..4 {
        render();
        std::thread::sleep(Duration::from_millis(300));
    }
    assert_eq!(started(), 1);
    assert_eq!(pool.workers_started(), 1);
    // Once idle, the worker closes it and stops; the next render starts a browser and a worker again.
    std::thread::sleep(Duration::from_millis(1000));
    assert!(!pool.kept());
    render();
    assert_eq!((started(), pool.workers_started()), (2, 2));
    pool.close();
}
