//! The service fixture and the helpers the tests share.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
    time::Duration,
};

use axum::{body::Body, extract::Request, response::Response};
use projections_cli::service;
use serde_json::{Value, json};
use tokio::time::{sleep, timeout};
use uuid::Uuid;

/// The Inspector service in memory, as the stdio backend and headless pages call it.
pub(super) struct Fixture {
    pub(super) root: PathBuf,
    pub(super) service: Arc<service::Service>,
}

#[cfg(unix)]
pub(super) fn alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

#[cfg(windows)]
pub(super) fn alive(pid: i32) -> bool {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, STILL_ACTIVE},
        System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    };
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid as u32) };
    if process.is_null() {
        return false;
    }
    let mut code = 0;
    let running = unsafe { GetExitCodeProcess(process, &mut code) } != 0 && code == STILL_ACTIVE as u32;
    unsafe { CloseHandle(process) };
    running
}

pub(super) fn git(root: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .args(["--no-pager", "-c", "core.hooksPath=/dev/null"])
        .args(arguments)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .current_dir(root)
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

pub(super) fn assets(root: &Path) {
    fs::create_dir_all(root.join("assets")).unwrap();
    fs::create_dir_all(root.join("engine")).unwrap();
    fs::write(
        root.join("index.html"),
        r#"<!doctype html><title>Inspector</title><script type="module" src="./assets/client.js"></script><link rel="stylesheet" href="./assets/client.css">"#,
    )
    .unwrap();
    fs::write(root.join("assets/client.js"), "export {};").unwrap();
    fs::write(root.join("assets/client.css"), "body{margin:0}").unwrap();
    fs::write(root.join("mount.js"), "export {};").unwrap();
    fs::write(root.join("mount.css"), "body{margin:0}").unwrap();
    for name in ["worker-entry.js", "wasm-transport.js", "transport.js"] {
        fs::write(root.join("engine").join(name), "export {};").unwrap();
    }
    fs::write(root.join("engine/engine.wasm"), b"\0asm\x01\0\0\0").unwrap();
}

impl Fixture {
    pub(super) async fn new(trust: bool, offline: bool, slow: bool) -> Self {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join(format!("inspector-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let viewer = root.join("viewer");
        assets(&viewer);
        let repo = root.join("repo");
        fs::create_dir_all(repo.join(".projections")).unwrap();
        let state = r#"{"protocolVersion":0,"schema":"graph/v0","entities":[{"id":"a","kind":"item","label":"Native fixture"}],"relationships":[]}"#;
        #[cfg(not(windows))]
        let (name, command, script) = (
            "collector.sh",
            json!(["/bin/sh", "collector.sh"]),
            if slow {
                // Written whole, then renamed, so a reader never sees the file before its pid.
                format!(
                    "cat >/dev/null\nprintf '%s' \"$$\" > '{pid}.tmp'\nmv '{pid}.tmp' '{pid}'\nsleep 120\n",
                    pid = root.join("collector.pid").display()
                )
            } else {
                format!("cat >/dev/null\nprintf '%s\\n' '{state}'\nprintf 'fixture diagnostic' >&2\n")
            },
        );
        #[cfg(windows)]
        let (name, command, script) = (
            "collector.ps1",
            json!([
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                "collector.ps1"
            ]),
            if slow {
                format!(
                    "[IO.File]::WriteAllText('{pid}.tmp', \"$PID\")\n[IO.File]::Move('{pid}.tmp', '{pid}')\nStart-Sleep -Seconds 120\n",
                    pid = root.join("collector.pid").display()
                )
            } else {
                format!("[Console]::Out.Write('{state}')\n[Console]::Error.Write('fixture diagnostic')\n")
            },
        );
        fs::write(repo.join(name), script).unwrap();
        fs::write(
            repo.join(".projections/example.json"),
            serde_json::to_vec(&json!({
                "id": "example", "renderer": "graph",
                "extractor": {"command": command},
                "execution": {"timeoutMs": 300000},
            }))
            .unwrap(),
        )
        .unwrap();
        git(&repo, &["init", "--quiet"]);
        git(&repo, &["add", "."]);
        git(
            &repo,
            &[
                "-c",
                "user.name=Inspector Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "Native fixture",
            ],
        );
        let document = offline.then(|| json!({"format": "offline-fixture", "version": 1}));
        let service = service::Service::new(service::InspectorOptions {
            repo: if offline { root.join("absent-repository") } else { repo },
            trust,
            document,
            custom_renderers: false,
            assets: viewer,
            fixtures: None,
            executable: Some(env!("CARGO_BIN_EXE_projections").into()),
            explore: None,
            candidates: Vec::new(),
            execution: Default::default(),
        })
        .await
        .unwrap();
        Self {
            root,
            service: Arc::new(service),
        }
    }

    pub(super) fn auth(&self) -> Vec<(&str, String)> {
        vec![("Content-Type", "application/json".to_owned())]
    }

    pub(super) async fn request(&self, method: &str, path: &str, headers: Vec<(&str, String)>, body: &[u8]) -> HttpResponse {
        let mut request = Request::builder().method(method).uri(path);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        let request = request.body(Body::from(body.to_vec())).unwrap();
        let response = timeout(Duration::from_secs(30), self.service.handle(request))
            .await
            .unwrap_or_else(|_| panic!("{method} {path} timed out"));
        HttpResponse::read(response).await
    }

    pub(super) async fn get(&self, path: &str) -> HttpResponse {
        self.request("GET", path, self.auth(), b"").await
    }

    pub(super) async fn job(&self, input: Value) -> Value {
        let response = self
            .request("POST", "/api/jobs", self.auth(), &serde_json::to_vec(&input).unwrap())
            .await;
        assert_eq!(response.status, 202, "{}", response.text());
        response.json()
    }

    pub(super) async fn finished(&self, id: &str) -> Value {
        timeout(Duration::from_secs(10), async {
            loop {
                let response = self.request("GET", &format!("/api/jobs/{id}"), self.auth(), b"").await;
                assert_eq!(response.status, 200);
                let job = response.json();
                if job["status"] != "running" {
                    return job;
                }
                sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap()
    }

    pub(super) async fn close(self) {
        timeout(Duration::from_secs(10), self.service.close()).await.unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

pub(super) struct HttpResponse {
    pub(super) status: u16,
    pub(super) headers: BTreeMap<String, String>,
    pub(super) body: Vec<u8>,
}

impl HttpResponse {
    pub(super) async fn read(response: Response) -> Self {
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .map(|(name, value)| (name.as_str().to_ascii_lowercase(), value.to_str().unwrap_or_default().to_owned()))
            .collect();
        let body = axum::body::to_bytes(response.into_body(), 256 * 1024 * 1024)
            .await
            .unwrap()
            .to_vec();
        Self { status, headers, body }
    }

    pub(super) fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    pub(super) fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap()
    }
}

fn git_output(root: &Path, arguments: &[&str]) -> String {
    let output = Command::new("git")
        .args(["--no-pager", "-c", "core.hooksPath=/dev/null"])
        .args(arguments)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .current_dir(root)
        .output()
        .unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

pub(super) fn commit_all(root: &Path) -> String {
    git(root, &["add", "--all"]);
    git(
        root,
        &[
            "-c",
            "user.name=Inspector Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Renderer",
        ],
    );
    git_output(root, &["rev-parse", "HEAD"])
}

pub(super) fn commit(repo: &Path, message: &str) {
    git(
        repo,
        &[
            "-c",
            "user.name=Inspector Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--quiet",
            "--allow-empty",
            "-m",
            message,
        ],
    );
}

pub(super) async fn post(fixture: &Fixture, body: Value) -> HttpResponse {
    fixture
        .request("POST", "/api/definition", fixture.auth(), &serde_json::to_vec(&body).unwrap())
        .await
}
