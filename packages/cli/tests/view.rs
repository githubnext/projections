//! The agent viewer's server (`projections view`): its token, its loopback
//! `Host` check, the routes it forwards and refuses, the view state pages poll
//! and report to, and `open_projection`'s choices.

use std::{fs, path::Path, process::Command, sync::Arc, time::Duration};

use projections_cli::{
    service::{InspectorOptions, Service},
    view::{Viewer, ViewerOptions, client, registry},
};
use serde_json::{Value, json};
use uuid::Uuid;

fn git(root: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .args(["--no-pager", "-c", "core.hooksPath=/dev/null"])
        .args(["-c", "user.name=Viewer Fixture", "-c", "user.email=fixture@example.invalid"])
        .args(arguments)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .current_dir(root)
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

fn assets(root: &Path) {
    fs::create_dir_all(root.join("engine")).unwrap();
    fs::write(root.join("mount.js"), "export {};").unwrap();
    fs::write(root.join("mount.css"), "body{margin:0}").unwrap();
    for name in ["worker-entry.js", "wasm-transport.js", "transport.js"] {
        fs::write(root.join("engine").join(name), "export {};").unwrap();
    }
    fs::write(root.join("engine/engine.wasm"), b"\0asm\x01\0\0\0").unwrap();
}

struct Fixture {
    root: std::path::PathBuf,
    repo: std::path::PathBuf,
    viewer: Viewer,
    service: Arc<Service>,
}

impl Fixture {
    async fn new() -> Self {
        Self::with(false, |_| {}).await
    }

    /// A fixture whose repository `prepare` adds to, with a service that may run repository code.
    async fn with(trust: bool, prepare: impl FnOnce(&Path)) -> Self {
        let root = std::env::current_dir()
            .unwrap()
            .join("target")
            .join(format!("view-test-{}", Uuid::new_v4()));
        let repo = root.join("repo");
        assets(&root.join("assets"));
        fs::create_dir_all(repo.join(".github/projections")).unwrap();
        fs::create_dir_all(repo.join("packages/a")).unwrap();
        fs::write(
            repo.join("package.json"),
            r#"{"name": "root", "private": true, "workspaces": ["packages/*"]}"#,
        )
        .unwrap();
        fs::write(repo.join("packages/a/package.json"), r#"{"name": "a", "version": "1.0.0"}"#).unwrap();
        fs::write(
            repo.join(".github/projections/packages.json"),
            r#"{"id": "packages", "title": "Package map", "extractor": "workspace-dependencies", "renderer": "dependencies"}"#,
        )
        .unwrap();
        prepare(&repo);
        git(&repo, &["init", "--quiet", "--initial-branch=main"]);
        git(&repo, &["add", "."]);
        git(&repo, &["commit", "--quiet", "-m", "Add the package map"]);
        fs::write(repo.join("packages/a/package.json"), r#"{"name": "a", "version": "2.0.0"}"#).unwrap();
        git(&repo, &["commit", "--quiet", "-am", "Bump a"]);
        let service = Arc::new(
            Service::new(InspectorOptions {
                repo: repo.clone(),
                trust,
                document: None,
                custom_renderers: false,
                assets: root.join("assets"),
                fixtures: None,
                executable: Some(env!("CARGO_BIN_EXE_projections").into()),
                explore: None,
                candidates: Vec::new(),
                execution: Default::default(),
            })
            .await
            .unwrap(),
        );
        let viewer = Viewer::start(
            service.clone(),
            ViewerOptions {
                port: 0,
                idle: None,
                definition_revision: None,
                token: None,
            },
        )
        .unwrap();
        Self {
            root,
            repo,
            viewer,
            service,
        }
    }

    async fn request(&self, method: &str, path: &str, body: Option<&Value>) -> client::Response {
        client::request(self.viewer.url(), method, path, body, Duration::from_secs(30))
            .await
            .unwrap()
    }

    async fn close(self) {
        self.viewer.close().await;
        self.service.close().await;
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// A raw request to the viewer's port, without its token or with another `Host`.
async fn raw(url: &str, path: &str, host: Option<&str>) -> u16 {
    let answer = raw_answer(url, path, host).await;
    answer.split(' ').nth(1).unwrap().parse().unwrap()
}

/// [`raw`]'s whole answer: its status line, headers and body.
async fn raw_answer(url: &str, path: &str, host: Option<&str>) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let address = url.trim_start_matches("http://").split('/').next().unwrap().to_owned();
    let mut stream = tokio::net::TcpStream::connect(&address).await.unwrap();
    let host = host.unwrap_or(&address);
    stream
        .write_all(format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").as_bytes())
        .await
        .unwrap();
    let mut answer = String::new();
    stream.read_to_string(&mut answer).await.unwrap();
    answer
}

#[tokio::test]
async fn requests_need_the_token_and_a_loopback_host() {
    let fixture = Fixture::new().await;
    let url = fixture.viewer.url().to_owned();
    let token = url.trim_end_matches('/').rsplit('/').next().unwrap().to_owned();
    assert_eq!(raw(&url, "/", None).await, 404);
    assert_eq!(raw(&url, "/mount.js", None).await, 404);
    assert_eq!(raw(&url, &format!("/{}/", "0".repeat(64)), None).await, 404);
    assert_eq!(raw(&url, &format!("/{token}x/"), None).await, 404);
    assert_eq!(raw(&url, &format!("/{token}/"), Some("attacker.example")).await, 403);
    assert_eq!(raw(&url, &format!("/{token}/"), None).await, 200);
    let page = fixture.request("GET", "", None).await;
    assert_eq!(page.status, 200);
    assert!(page.content_type.starts_with("text/html"));
    assert!(String::from_utf8_lossy(&page.body).contains("./viewer.js"));
    assert_eq!(fixture.request("GET", "mount.js", None).await.status, 200);
    fixture.close().await;
}

#[tokio::test]
async fn the_bare_port_says_how_to_get_the_link_without_giving_it() {
    let fixture = Fixture::new().await;
    let url = fixture.viewer.url().to_owned();
    let token = url.trim_end_matches('/').rsplit('/').next().unwrap().to_owned();
    for path in ["/", "/favicon.ico", &format!("/{}/", "0".repeat(64))] {
        let answer = raw_answer(&url, path, None).await;
        assert!(answer.starts_with("HTTP/1.1 404"), "{answer}");
        assert!(answer.contains("This viewer needs its full link"), "{answer}");
        assert!(answer.contains("projections view current"), "{answer}");
        assert!(!answer.contains(&token), "the page never gives the token");
        assert!(!answer.to_ascii_lowercase().contains("location:"), "no redirect");
        assert!(answer.contains("default-src 'none'"), "no script runs: {answer}");
    }
    // Another host still learns nothing, not even that.
    let refused = raw_answer(&url, "/", Some("attacker.example")).await;
    assert!(refused.starts_with("HTTP/1.1 403") && !refused.contains("full link"), "{refused}");
    fixture.close().await;
}

#[tokio::test]
async fn current_view_says_what_it_saw_when_no_page_counts() {
    let fixture = Fixture::new().await;
    let url = fixture.viewer.url().to_owned();
    fixture
        .request("POST", "control/show", Some(&json!({"choice": "last-commit"})))
        .await;
    let current = || async {
        let read = fixture
            .request("POST", "control/tool/current_view", Some(&json!({})))
            .await
            .json()
            .unwrap();
        (
            read["content"][0]["text"].as_str().unwrap().to_owned(),
            read["structuredContent"].clone(),
        )
    };
    let (text, _) = current().await;
    assert!(
        text.contains("no page is open.\nNothing has loaded its page in the last 10 minutes"),
        "{text}"
    );
    // A page loaded but never ran its script, then ran it but never asked: each said as it is.
    assert_eq!(fixture.request("GET", "", None).await.status, 200);
    let (text, _) = current().await;
    assert!(text.contains("A page was loaded just now but never loaded its script"), "{text}");
    assert_eq!(fixture.request("GET", "viewer.js", None).await.status, 200);
    let (text, _) = current().await;
    assert!(text.contains("loaded its script, but never asked for the view"), "{text}");
    // Requests it refused: counted, never quoted.
    raw(&url, "/", Some("preview.proxy.example:1234")).await;
    raw(&url, "/", None).await;
    let (text, structured) = current().await;
    assert!(
        text.contains("One request was refused for naming a host other than 127.0.0.1"),
        "{text}"
    );
    assert!(text.contains("One request came without the viewer's token"), "{text}");
    assert!(!text.contains("preview.proxy.example"), "{text}");
    assert_eq!(structured["seen"]["foreignHost"]["count"], 1);
    // A capture's poll (no page ID) isn't the person's page; a page's poll is.
    fixture.request("GET", "view/state", None).await;
    assert_eq!(fixture.request("GET", "control/state", None).await.json().unwrap()["pages"], 0);
    fixture.request("GET", "view/state?page=p1", None).await;
    let (text, structured) = current().await;
    assert_eq!(structured["pages"], 1);
    assert!(text.contains("one page is open.") && !text.contains("never asked"), "{text}");
    fixture.close().await;
}

#[tokio::test]
async fn it_reads_but_never_writes() {
    let fixture = Fixture::new().await;
    let definitions = fixture.request("GET", "api/definitions?ref=working-tree", None).await;
    assert_eq!(definitions.status, 200);
    let listed = definitions.json().unwrap();
    assert_eq!(listed["definitions"][0]["id"], "packages", "{listed}");
    for path in [
        "api/definition",
        "api/adopt",
        "api/prepare",
        "api/sweep",
        "api/comparator-tests/run",
    ] {
        let refused = fixture.request("POST", path, Some(&json!({}))).await;
        assert_eq!(refused.status, 403, "{path}");
    }
    assert_eq!(fixture.request("GET", "api/sweep/thumbnail", None).await.status, 403);
    fixture.close().await;
}

#[tokio::test]
async fn show_resolves_choices_and_pages_follow_and_report() {
    let fixture = Fixture::new().await;
    let shown = fixture
        .request(
            "POST",
            "control/show",
            Some(&json!({"choice": "last-commit", "mode": "side-by-side"})),
        )
        .await;
    assert_eq!(shown.status, 200);
    let state = &shown.json().unwrap()["state"];
    assert_eq!(state["projection"], "packages");
    assert_eq!(state["title"], "Package map");
    assert_eq!((state["before"].as_str(), state["after"].as_str()), (Some("HEAD~1"), Some("HEAD")));
    assert_eq!(state["compared"], "Last commit");
    assert_eq!(state["mode"], "side-by-side");
    let generation = state["generation"].as_u64().unwrap();

    // Named revisions are said by their subjects.
    let named = fixture
        .request("POST", "control/show", Some(&json!({"before": "HEAD~1", "after": "working-tree"})))
        .await
        .json()
        .unwrap();
    assert_eq!(named["state"]["compared"], "“Add the package map” → your files");
    assert_eq!(named["state"]["mode"], "side-by-side", "the same projection keeps its mode");

    // A page long-polls for the next generation; a report from a page that has caught up applies the selection.
    let poll = fixture
        .request("GET", &format!("view/state?page=p1&since={generation}"), None)
        .await;
    let current = poll.json().unwrap();
    assert_eq!(current["generation"], generation + 1);
    let notice = "`packages.json` doesn't exist at `caf6ab7e`, so its contents show as added.";
    let report = json!({"page": "p1", "generation": current["generation"], "selection": "workspace:a", "mode": "swipe", "view": {"status": "ok"},
        "summary": {"projection": {"id": "packages"}, "status": "ok", "notices": [notice]}});
    assert_eq!(fixture.request("POST", "view/report", Some(&report)).await.status, 200);
    let control = fixture.request("GET", "control/state", None).await.json().unwrap();
    assert_eq!(control["state"]["selection"], "workspace:a");
    assert_eq!(control["state"]["mode"], "swipe");
    assert_eq!(control["pages"], 1);
    assert_eq!(control["page"]["view"]["status"], "ok");
    // The agent reads the notices the page shows, as VS Code's current view says its tab's.
    let read = fixture
        .request("POST", "control/tool/current_view", Some(&json!({})))
        .await
        .json()
        .unwrap();
    let text = read["content"][0]["text"].as_str().unwrap();
    assert!(text.contains(&format!("\nNotice: {notice}\n")), "{text}");
    // A page that hasn't caught up never undoes the agent's change.
    let stale = json!({"page": "p2", "generation": 1, "selection": null});
    fixture.request("POST", "view/report", Some(&stale)).await;
    let control = fixture.request("GET", "control/state", None).await.json().unwrap();
    assert_eq!(control["state"]["selection"], "workspace:a");

    let refreshed = fixture.request("POST", "control/refresh", None).await.json().unwrap();
    assert_eq!(refreshed["state"]["refresh"], 1);

    for (input, error) in [
        (json!({"projection": "nope"}), "no projection nope"),
        (json!({"choice": "branch"}), "Branch changes don't apply"),
        (json!({"scenario": "nope"}), "no scenario nope"),
        (json!({"before": "no-such-ref"}), "no-such-ref"),
    ] {
        let refused = fixture.request("POST", "control/show", Some(&input)).await;
        assert_eq!(refused.status, 400, "{input}");
        let message = refused.json().unwrap()["diagnostics"][0]["message"].as_str().unwrap().to_owned();
        assert!(message.contains(error), "{message}");
    }
    fixture.close().await;
}

#[tokio::test]
async fn named_viewers_show_projections_side_by_side_and_the_person_chooses() {
    let fixture = Fixture::with(false, |repo| {
        fs::write(
            repo.join(".github/projections/versions.json"),
            r#"{"id": "versions", "title": "Versions", "extractor": "workspace-dependencies", "renderer": "dependencies"}"#,
        )
        .unwrap();
    })
    .await;
    let server = &fixture;
    let show = |input: Value| async move { server.request("POST", "control/show", Some(&input)).await };
    let default = show(json!({"projection": "packages", "choice": "last-commit"}))
        .await
        .json()
        .unwrap();
    assert_eq!(default["url"].as_str().unwrap(), fixture.viewer.url());
    let named = show(json!({"projection": "versions", "choice": "now", "viewer": "side"}))
        .await
        .json()
        .unwrap();
    assert_eq!(named["url"].as_str().unwrap(), format!("{}?viewer=side", fixture.viewer.url()));
    assert_eq!(named["state"]["generation"], 1, "a named viewer has its own state");
    assert_eq!(named["state"]["chosenBy"], "agent");

    // Each viewer's pages poll and report its own state.
    let side = fixture.request("GET", "view/state?page=s1&viewer=side", None).await.json().unwrap();
    assert_eq!(
        (side["projection"].as_str(), side["viewer"].as_str()),
        (Some("versions"), Some("side"))
    );
    let main = fixture.request("GET", "view/state?page=d1", None).await.json().unwrap();
    assert_eq!(
        (main["projection"].as_str(), main["viewer"].as_str()),
        (Some("packages"), Some("default"))
    );
    let report = json!({"page": "s1", "viewer": "side", "generation": 1, "selection": "workspace:a"});
    fixture.request("POST", "view/report", Some(&report)).await;
    let main = fixture.request("GET", "control/state", None).await.json().unwrap();
    assert!(main["state"]["selection"].is_null(), "another viewer's report doesn't reach it");
    let names: Vec<&str> = main["viewers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|view| view["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["default", "side"]);

    // The person picks another projection from a page's title: that viewer shows it, comparing what it compared.
    let chosen = fixture
        .request("POST", "view/choose", Some(&json!({"viewer": "side", "projection": "packages"})))
        .await;
    assert_eq!(chosen.status, 200);
    let state = &chosen.json().unwrap()["state"];
    assert_eq!(
        (state["projection"].as_str(), state["compared"].as_str()),
        (Some("packages"), Some("Current state"))
    );
    assert_eq!(state["chosenBy"], "person");
    assert!(state["selection"].is_null(), "another projection's selection is cleared");
    let read = fixture
        .request("POST", "control/tool/current_view", Some(&json!({"viewer": "side"})))
        .await
        .json()
        .unwrap();
    let text = read["content"][0]["text"].as_str().unwrap();
    assert!(text.starts_with("The viewer side shows \"Package map\""), "{text}");
    assert!(text.contains("The person chose this projection themselves"), "{text}");
    assert!(
        text.contains("Other viewers (current_view with viewer reads one): default shows packages (Last commit)"),
        "{text}"
    );
    let main = fixture.request("GET", "control/state", None).await.json().unwrap();
    assert_eq!(main["state"]["chosenBy"], "agent", "the default viewer is unchanged");

    for (path, body, status) in [
        ("view/choose", json!({"projection": "nope"}), 400),
        ("view/choose", json!({}), 400),
        ("control/show", json!({"viewer": "Not A Name"}), 400),
    ] {
        assert_eq!(fixture.request("POST", path, Some(&body)).await.status, status, "{path} {body}");
    }
    assert_eq!(fixture.request("GET", "view/state?viewer=..%2F", None).await.status, 400);
    fixture.close().await;
}

#[tokio::test]
async fn the_shown_projections_renderer_builds_and_rebuilds_on_save() {
    let fixture = Fixture::with(true, |repo| {
        let package = repo.join("cards");
        fs::create_dir_all(package.join("src")).unwrap();
        fs::create_dir_all(package.join("node_modules")).unwrap();
        fs::write(package.join("src/main.ts"), "export const cards = 1\n").unwrap();
        // The build copies its source into the bundle, and says it built.
        let build = "node -e \"const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html',fs.readFileSync('src/main.ts'));console.log('built in 1ms')\"";
        fs::write(package.join("package.json"), json!({"scripts": {"build": build}}).to_string()).unwrap();
        fs::write(
            repo.join(".github/projections/cards.json"),
            r#"{"id": "cards", "title": "Cards", "extractor": "workspace-dependencies", "renderer": {"bundle": "cards/dist"}}"#,
        )
        .unwrap();
        fs::write(repo.join(".gitignore"), "node_modules\ndist\n").unwrap();
    })
    .await;
    let builds = || async { fixture.request("GET", "api/renderer-builds", None).await.json().unwrap()["builds"][0].clone() };
    let until = |run: u64| async move {
        for _ in 0..400 {
            let build = builds().await;
            if build["run"] == run && build["exit"] == 0 {
                return build;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("run {run} never built: {}", builds().await);
    };
    // Shown with no bundle yet: its sources are newer, so it builds.
    let shown = fixture
        .request("POST", "control/show", Some(&json!({"projection": "cards", "choice": "now"})))
        .await;
    assert_eq!(shown.status, 200);
    let first = until(1).await;
    assert_eq!(
        (first["projection"].as_str(), first["phase"].as_str()),
        (Some("cards"), Some("built"))
    );
    assert_eq!(
        fs::read_to_string(fixture.repo.join("cards/dist/index.html")).unwrap(),
        "export const cards = 1\n"
    );
    // A saved source: the viewer sees the working tree change and builds again.
    tokio::time::sleep(Duration::from_millis(1100)).await;
    fs::write(fixture.repo.join("cards/src/main.ts"), "export const cards = 2\n").unwrap();
    until(2).await;
    assert_eq!(
        fs::read_to_string(fixture.repo.join("cards/dist/index.html")).unwrap(),
        "export const cards = 2\n"
    );
    // The agent reads the build.
    let current = fixture
        .request("POST", "control/tool/current_view", Some(&json!({})))
        .await
        .json()
        .unwrap();
    assert_eq!(current["structuredContent"]["rendererBuild"]["phase"], "built");
    assert!(
        current["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Renderer build: built (npm run build in cards)")
    );
    fixture.close().await;
}

/// Waits up to 30 seconds for `ready`, polling.
fn wait_for<T>(what: &str, mut ready: impl FnMut() -> Option<T>) -> T {
    for _ in 0..300 {
        if let Some(value) = ready() {
            return value;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("timed out waiting for {what}")
}

#[test]
fn a_stale_record_is_replaced_and_a_viewer_stops_or_is_replaced_with_trust() {
    let root = std::env::current_dir()
        .unwrap()
        .join("target")
        .join(format!("view-cli-test-{}", Uuid::new_v4()));
    let repo = root.join("repo");
    assets(&root.join("assets"));
    fs::create_dir_all(repo.join(".github/projections")).unwrap();
    fs::write(repo.join("package.json"), r#"{"name": "root", "private": true}"#).unwrap();
    fs::write(
        repo.join(".github/projections/packages.json"),
        r#"{"id": "packages", "title": "Package map", "extractor": "workspace-dependencies", "renderer": "dependencies"}"#,
    )
    .unwrap();
    git(&repo, &["init", "--quiet", "--initial-branch=main"]);
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "--quiet", "-m", "Start"]);
    // The repository's root as the CLI keys its record: canonical, in the platform's own spelling (on Windows, Git
    // reports C:/… where the CLI keys C:\…).
    let top = projections_extractor_sdk::canonical(&repo).unwrap();
    let cache = root.join("cache");
    let record_file = registry::path_in(&cache, &top, "");
    let record = || {
        let value: Value = serde_json::from_slice(&fs::read(&record_file).ok()?).ok()?;
        Some((
            value["url"].as_str()?.to_owned(),
            value["pid"].as_u64()? as u32,
            value["trust"] == true,
        ))
    };
    let projections = |arguments: &[&str]| {
        let mut command = Command::new(env!("CARGO_BIN_EXE_projections"));
        command
            .arg("-C")
            .arg(&repo)
            .args(arguments)
            .env("PROJECTIONS_CACHE_DIR", &cache)
            .env("PROJECTIONS_INSPECTOR_ASSETS", root.join("assets"))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        command
    };
    let exits = |child: &mut std::process::Child| wait_for("the viewer to exit", || child.try_wait().unwrap());
    // Which server answers a page at `url`: a page that reconnects to another one loads afresh.
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let instance = |url: &str| {
        let state = runtime
            .block_on(client::request(url, "GET", "view/state", None, Duration::from_secs(10)))
            .unwrap();
        state.json().unwrap()["instance"].as_str().unwrap().to_owned()
    };

    // A viewer that was killed left its record: a process that is gone, at a port nothing answers.
    let mut gone = Command::new(if cfg!(windows) { "cmd" } else { "true" })
        .args(if cfg!(windows) { &["/C", "exit"][..] } else { &[][..] })
        .spawn()
        .unwrap();
    gone.wait().unwrap();
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let stale = format!("http://127.0.0.1:{port}/{}/", "a".repeat(64));
    fs::create_dir_all(record_file.parent().unwrap()).unwrap();
    let json = registry::Record {
        url: stale.clone(),
        pid: gone.id(),
        trust: false,
    }
    .json();
    fs::write(&record_file, json.to_string()).unwrap();

    let mut first = projections(&["view"]).spawn().unwrap();
    let (url, _, trusted) = wait_for("the stale record to be replaced", || {
        record().filter(|(_, pid, _)| *pid == first.id())
    });
    assert_ne!(url, stale);
    assert!(!trusted);
    // Recorded only once it shows its first pair: a process that starts it (`view show --choice now`) and shows
    // something else through it is never undone by that first show.
    let state = runtime
        .block_on(client::request(&url, "GET", "view/state", None, Duration::from_secs(10)))
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(
        (state["generation"].as_u64(), state["projection"].as_str()),
        (Some(1), Some("packages"))
    );
    let again = projections(&["view"]).output().unwrap();
    assert!(
        String::from_utf8_lossy(&again.stdout).contains(&format!("already running for this repository: {url}")),
        "{}",
        String::from_utf8_lossy(&again.stderr)
    );

    // Asked for trust, the untrusted viewer is replaced at its URL, so its open pages reconnect, and load afresh.
    let untrusted = instance(&url);
    let mut trusting = projections(&["view", "--trust"]).spawn().unwrap();
    exits(&mut first);
    let (replaced, _, trusted) = wait_for("the trusted viewer", || record().filter(|(_, pid, _)| *pid == trusting.id()));
    assert_eq!((replaced.as_str(), trusted), (url.as_str(), true));
    assert_ne!(instance(&url), untrusted);

    let stopped = projections(&["view", "stop"]).output().unwrap();
    assert!(stopped.status.success(), "{}", String::from_utf8_lossy(&stopped.stderr));
    assert!(String::from_utf8_lossy(&stopped.stdout).contains(&format!("Stopped the viewer at {url}")));
    exits(&mut trusting);
    assert!(record().is_none(), "a stopped viewer's record is removed");
    let none = projections(&["view", "stop"]).output().unwrap();
    assert!(String::from_utf8_lossy(&none.stdout).contains("No viewer is running"));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_restarted_viewer_keeps_its_url_until_rotated_and_ports_are_never_silently_ignored() {
    let root = std::env::current_dir()
        .unwrap()
        .join("target")
        .join(format!("view-address-test-{}", Uuid::new_v4()));
    let repo = root.join("repo");
    assets(&root.join("assets"));
    fs::create_dir_all(repo.join(".github/projections")).unwrap();
    fs::write(repo.join("package.json"), r#"{"name": "root", "private": true}"#).unwrap();
    fs::write(
        repo.join(".github/projections/packages.json"),
        r#"{"id": "packages", "title": "Package map", "extractor": "workspace-dependencies", "renderer": "dependencies"}"#,
    )
    .unwrap();
    git(&repo, &["init", "--quiet", "--initial-branch=main"]);
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "--quiet", "-m", "Start"]);
    let top = projections_extractor_sdk::canonical(&repo).unwrap();
    let cache = root.join("cache");
    let projections = |arguments: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_projections"))
            .arg("-C")
            .arg(&repo)
            .args(arguments)
            .env("PROJECTIONS_CACHE_DIR", &cache)
            .env("PROJECTIONS_INSPECTOR_ASSETS", root.join("assets"))
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap()
    };
    let show = |extra: &[&str]| {
        let output = projections(&[&["view", "show", "--json"], extra].concat());
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let result: Value = serde_json::from_slice(&output.stdout).unwrap();
        result["url"].as_str().unwrap().to_owned()
    };
    let port_of = |url: &str| {
        registry::Record {
            url: url.to_owned(),
            pid: 0,
            trust: false,
        }
        .address()
        .unwrap()
    };
    let free_port = || std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();

    let first = show(&[]);
    // A theme seed goes only in the link it prints, wherever it prints it; one the page would ignore is refused.
    let seed = r##"{"light": {"border": "#e4e2dd", "background": "#f7f6f3"}}"##;
    let seeded = format!("{first}?theme=%7B%22light%22%3A%7B%22background%22%3A%22%23f7f6f3%22%2C%22border%22%3A%22%23e4e2dd%22%7D%7D");
    assert_eq!(show(&["--theme", seed]), seeded);
    let said = projections(&["view", "show", "--theme", seed]);
    assert!(String::from_utf8_lossy(&said.stdout).contains(&format!("Showing Package map in the viewer: {seeded}\n")));
    let said = projections(&["view", "--theme", seed]);
    assert!(String::from_utf8_lossy(&said.stdout).contains(&format!("already running for this repository: {seeded}\n")));
    let refused = projections(&["view", "show", "--theme", r#"{"light": {"background": "white"}}"#]);
    assert!(!refused.status.success());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("theme.light.background isn't a color"));
    let kept = projections_cli::view::address::path_in(&cache, &top, "");
    assert!(kept.exists(), "the project's address is kept in the cache");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(&kept).unwrap().permissions().mode() & 0o777, 0o600);
    }
    // Asked for another port while it runs on its own: refused, saying what to do.
    let other = free_port();
    let refused = projections(&["view", "show", "--port", &other.to_string()]);
    assert!(!refused.status.success());
    let said = String::from_utf8_lossy(&refused.stderr);
    assert!(
        said.contains(&format!("already running for this repository on port {}", port_of(&first).0)),
        "{said}"
    );
    assert!(said.contains("projections view stop"), "{said}");
    let refused = projections(&["view", "--port", &other.to_string()]);
    assert!(
        String::from_utf8_lossy(&refused.stderr).contains("already running"),
        "the server's own --port too"
    );
    // Its own port is no conflict, nor is replacing it with a trusted viewer there.
    assert_eq!(show(&["--port", &port_of(&first).0.to_string()]), first);
    assert_eq!(show(&["--trust", "--port", &port_of(&first).0.to_string()]), first);

    // Stopped and started again, it serves the same URL: the same port and token.
    assert!(projections(&["view", "stop"]).status.success());
    assert_eq!(show(&[]), first);

    // Rotated, the next viewer has a new token.
    let rotated = projections(&["view", "stop", "--rotate"]);
    assert!(
        String::from_utf8_lossy(&rotated.stdout).contains("Forgot its link"),
        "{}",
        String::from_utf8_lossy(&rotated.stdout)
    );
    assert!(!kept.exists());
    let second = show(&[]);
    assert_ne!(port_of(&second).1, port_of(&first).1);

    // A port another program holds is refused, not swapped for another.
    assert!(projections(&["view", "stop"]).status.success());
    let holder = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let taken = holder.local_addr().unwrap().port();
    let refused = projections(&["view", "show", "--port", &taken.to_string()]);
    assert!(!refused.status.success());
    assert!(
        String::from_utf8_lossy(&refused.stderr).contains(&format!("Port {taken} is taken")),
        "{}",
        String::from_utf8_lossy(&refused.stderr)
    );
    // Asked for a free one, it listens there, keeping its token, and keeps that port for the next start.
    let moved = show(&["--port", &other.to_string()]);
    assert_eq!(port_of(&moved), (other, port_of(&second).1));
    assert!(projections(&["view", "stop"]).status.success());
    assert_eq!(show(&[]), moved);
    assert!(projections(&["view", "stop"]).status.success());
    drop(holder);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_nested_project_has_a_viewer_of_its_own() {
    let root = std::env::current_dir()
        .unwrap()
        .join("target")
        .join(format!("view-project-test-{}", Uuid::new_v4()));
    let repo = root.join("repo");
    assets(&root.join("assets"));
    fs::create_dir_all(repo.join("sub/.github/projections")).unwrap();
    fs::write(
        repo.join("sub/.github/projections/files.json"),
        r#"{"id": "files", "title": "Files", "extractor": "repository-map", "renderer": "tree"}"#,
    )
    .unwrap();
    git(&repo, &["init", "--quiet", "--initial-branch=main"]);
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "--quiet", "-m", "Start"]);
    let top = projections_extractor_sdk::canonical(&repo).unwrap();
    let cache = root.join("cache");
    let projections = |directory: &Path, arguments: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_projections"))
            .arg("-C")
            .arg(directory)
            .args(arguments)
            .env("PROJECTIONS_CACHE_DIR", &cache)
            .env("PROJECTIONS_INSPECTOR_ASSETS", root.join("assets"))
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap()
    };
    // Shown from inside the project, the background viewer serves that project, recorded as its own.
    let shown = projections(&repo.join("sub"), &["view", "show", "--json"]);
    assert!(shown.status.success(), "{}", String::from_utf8_lossy(&shown.stderr));
    assert!(registry::path_in(&cache, &top, "sub").exists());
    assert!(
        !registry::path_in(&cache, &top, "").exists(),
        "the root project's viewer is another"
    );
    let current = projections(&repo.join("sub"), &["view", "current", "--json"]);
    assert!(current.status.success(), "{}", String::from_utf8_lossy(&current.stderr));
    let stopped = projections(&repo.join("sub"), &["view", "stop"]);
    assert!(String::from_utf8_lossy(&stopped.stdout).contains("Stopped the viewer"));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn canvas_install_writes_the_copilot_extension_once() {
    let root = std::env::current_dir()
        .unwrap()
        .join("target")
        .join(format!("canvas-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    git(&root, &["init", "--quiet"]);
    let install = |extra: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_projections"))
            .args(["-C"])
            .arg(&root)
            .args(["canvas", "install"])
            .args(extra)
            .output()
            .unwrap()
    };
    let file = root.join(".github/extensions/projections/extension.mjs");
    let written = install(&[]);
    assert!(written.status.success(), "{}", String::from_utf8_lossy(&written.stderr));
    let source = fs::read_to_string(&file).unwrap();
    assert!(source.contains("createCanvas") && source.contains("joinSession"));
    assert!(
        !source.contains("console.log"),
        "standard output is the extension's JSON-RPC channel"
    );
    // Again: up to date. A changed file is replaced only with --force.
    assert!(String::from_utf8_lossy(&install(&[]).stdout).contains("up to date"));
    fs::write(&file, "// mine\n").unwrap();
    let refused = install(&[]);
    assert!(!refused.status.success());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("--force"));
    assert!(install(&["--force"]).status.success());
    assert_eq!(fs::read_to_string(&file).unwrap(), source);
    let _ = fs::remove_dir_all(&root);
}
