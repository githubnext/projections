//! `projections mcp`'s protocol, and the viewer as an MCP App.

use super::app::{EXTENSION, MIME_TYPE, PART_BYTES, RELAY_TOOL, RESOURCE_NOT_FOUND, RESOURCE_URI, Relay};
use super::*;
use crate::view::client;
use std::time::Duration;

/// A host whose build has the viewer's page when `page` is set.
struct Fake {
    page: Option<&'static str>,
}

const PLAIN: Fake = Fake { page: None };

impl ToolHost for Fake {
    fn instructions(&self, app: bool) -> String {
        if app { "Fake app" } else { "Fake" }.to_owned()
    }

    fn tools(&self) -> Value {
        tools::list()
    }

    async fn call(&self, name: String, arguments: Value, app: bool) -> Result<Value, String> {
        match name.as_str() {
            "explore" => Ok(json!({"content": [{"type": "text", "text": "none"}], "isError": false})),
            "sweep" => std::future::pending().await,
            RELAY_TOOL if app => Ok(json!({"content": [{"type": "text", "text": "relayed"}], "isError": false})),
            _ => Err(format!("Unknown tool: {name} {arguments}")),
        }
    }

    fn page(&self) -> Option<&'static str> {
        self.page
    }
}

async fn line(lines: &mut mpsc::Receiver<String>) -> Value {
    let line = tokio::time::timeout(Duration::from_secs(5), lines.recv())
        .await
        .expect("a reply")
        .expect("an open channel");
    serde_json::from_str(&line).unwrap()
}

#[tokio::test]
async fn it_speaks_mcp() {
    let (frames, input) = mpsc::channel(16);
    let (output, mut lines) = mpsc::channel(16);
    let session = tokio::spawn(session(Arc::new(PLAIN), input, output, std::future::pending()));
    let send = |value: Value| frames.send(Frame::Line(value.to_string().into_bytes()));
    send(json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}}))
        .await
        .unwrap();
    let initialized = line(&mut lines).await;
    assert_eq!(initialized["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(initialized["result"]["serverInfo"]["name"], "projections");
    assert!(initialized["result"]["capabilities"]["tools"].is_object());
    send(json!({"jsonrpc": "2.0", "method": "notifications/initialized"}))
        .await
        .unwrap();
    send(json!({"jsonrpc": "2.0", "id": 2, "method": "ping"})).await.unwrap();
    assert_eq!(line(&mut lines).await["result"], json!({}));
    send(json!({"jsonrpc": "2.0", "id": 3, "method": "tools/list"})).await.unwrap();
    let listed = line(&mut lines).await;
    let names: Vec<&str> = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"compare") && names.contains(&"open_projection"));
    // A cancelled call gets no reply; the next one does.
    send(json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "sweep"}}))
        .await
        .unwrap();
    send(json!({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 4}}))
        .await
        .unwrap();
    send(json!({"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "explore", "arguments": {}}}))
        .await
        .unwrap();
    let called = line(&mut lines).await;
    assert_eq!(called["id"], 5);
    assert_eq!(called["result"]["content"][0]["text"], "none");
    send(json!({"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "open_projection"}}))
        .await
        .unwrap();
    assert_eq!(line(&mut lines).await["error"]["code"], INVALID_PARAMS);
    send(json!({"jsonrpc": "2.0", "id": 7, "method": "resources/list"})).await.unwrap();
    assert_eq!(line(&mut lines).await["error"]["code"], METHOD_NOT_FOUND);
    frames.send(Frame::Line(b"[1]".to_vec())).await.unwrap();
    assert_eq!(line(&mut lines).await["error"]["code"], INVALID_REQUEST);
    drop(frames);
    session.await.unwrap();
    assert_eq!(lines.recv().await, None);
}

#[test]
fn only_a_host_that_shows_mcp_app_views_negotiates() {
    assert!(app::negotiated(
        &json!({"capabilities": {"extensions": {EXTENSION: {"mimeTypes": [MIME_TYPE]}}}})
    ));
    assert!(!app::negotiated(
        &json!({"capabilities": {"extensions": {EXTENSION: {"mimeTypes": ["text/plain"]}}}})
    ));
    assert!(!app::negotiated(&json!({"capabilities": {}})));
    assert!(!app::negotiated(&Value::Null));
}

#[test]
fn the_view_reads_and_reports_but_never_controls() {
    for (method, path) in [
        ("GET", "/view/state?page=a&since=3"),
        ("POST", "/view/report"),
        ("POST", "/view/choose"),
        ("GET", "/view/state?page=a&viewer=api"),
        ("GET", "/api/definitions?ref=working-tree"),
        ("POST", "/api/jobs"),
        ("GET", "/renderers/graph/index.html"),
        ("GET", "/custom-renderers/p/index.html"),
    ] {
        assert!(app::relayed(method, path), "{method} {path}");
    }
    for (method, path) in [
        ("POST", "/control/show"),
        ("POST", "/control/tool/open_projection"),
        ("GET", "/control/state"),
        ("GET", "/"),
        ("GET", "/mount.js"),
        ("GET", "/view/report"),
        ("GET", "/view/choose"),
        ("POST", "/view/state"),
        ("GET", "/api/../control/state"),
        ("GET", "/api/x#y"),
        ("PUT", "/api/jobs"),
        ("GET", "view/state"),
    ] {
        assert!(!app::relayed(method, path), "{method} {path}");
    }
}

#[test]
fn answers_lose_the_token_and_keep_their_form() {
    let url = "http://127.0.0.1:9/abc123/";
    let renderers = client::Response {
        status: 200,
        content_type: "application/json; charset=utf-8".to_owned(),
        body: br#"{"customRendererBase":"/abc123/custom-renderers/","renderers":[]}"#.to_vec(),
    };
    assert_eq!(app::answer(&renderers, url)["body"]["customRendererBase"], "/custom-renderers/");
    let page = client::Response {
        status: 200,
        content_type: "text/html".to_owned(),
        body: b"<!doctype html>".to_vec(),
    };
    assert_eq!(app::answer(&page, url)["body"], "<!doctype html>");
    let image = client::Response {
        status: 200,
        content_type: "image/png".to_owned(),
        body: vec![0, 1, 2],
    };
    assert_eq!(app::answer(&image, url)["body"]["base64"], "AAEC");
}

#[test]
fn long_answers_come_in_parts() {
    let relay = Relay::default();
    let text = format!("\"{}é\"", "a".repeat(PART_BYTES * 2));
    let first: Value = serde_json::from_str(&relay.divide(text.clone())).unwrap();
    let parts = first["parts"].as_u64().unwrap() as usize;
    assert_eq!(parts, 3);
    let continuation = first["continuation"].as_str().unwrap();
    let mut joined = first["text"].as_str().unwrap().to_owned();
    for index in 1..parts {
        joined.push_str(&relay.part(continuation, index).unwrap());
    }
    assert_eq!(joined, text);
    assert!(relay.part(continuation, 1).is_err(), "forgotten after its last part");
    assert_eq!(relay.divide("short".to_owned()), "short");
}

#[test]
fn the_view_is_one_resource_linked_from_open_projection() {
    let listed = app::tools(crate::tools::list());
    let tools = listed["tools"].as_array().unwrap();
    let open = tools.iter().find(|tool| tool["name"] == "open_projection").unwrap();
    assert_eq!(open["_meta"]["ui"]["resourceUri"], RESOURCE_URI);
    let relay = tools.iter().find(|tool| tool["name"] == RELAY_TOOL).unwrap();
    assert_eq!(relay["_meta"]["ui"]["visibility"], json!(["app"]));
    assert_eq!(
        tools.iter().filter(|tool| tool["_meta"]["ui"]["resourceUri"].is_string()).count(),
        2
    );
    assert_eq!(app::resources()["resources"][0]["uri"], RESOURCE_URI);
    let read = app::read(&json!({"uri": RESOURCE_URI}), "<!doctype html>").unwrap();
    let content = &read["contents"][0];
    assert_eq!(
        (content["mimeType"].as_str(), content["text"].as_str()),
        (Some(MIME_TYPE), Some("<!doctype html>"))
    );
    assert_eq!(content["_meta"]["ui"]["preferredDisplayMode"], "fullscreen");
    assert_eq!(app::read(&json!({"uri": "ui://other"}), "").unwrap_err().0, RESOURCE_NOT_FOUND);
}

/// A session's replies to `messages`, sent one after another, each answered before the next is sent.
async fn exchange(host: Fake, messages: &[Value]) -> Vec<Value> {
    let (frames, input) = mpsc::channel(16);
    let (output, mut lines) = mpsc::channel(16);
    let session = tokio::spawn(session(Arc::new(host), input, output, std::future::pending()));
    let mut replies = Vec::new();
    for message in messages {
        frames.send(Frame::Line(message.to_string().into_bytes())).await.unwrap();
        if message.get("id").is_some() {
            replies.push(line(&mut lines).await);
        }
    }
    drop(frames);
    session.await.unwrap();
    replies
}

fn initialize_with(capabilities: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": capabilities, "clientInfo": {"name": "test", "version": "1"}}})
}

#[tokio::test]
async fn an_mcp_apps_host_gets_the_view() {
    let page = Fake {
        page: Some("<!doctype html><title>viewer</title>"),
    };
    let apps = json!({"extensions": {EXTENSION: {"mimeTypes": [MIME_TYPE]}}});
    let replies = exchange(
        page,
        &[
            initialize_with(apps.clone()),
            json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
            json!({"jsonrpc": "2.0", "id": 3, "method": "resources/list"}),
            json!({"jsonrpc": "2.0", "id": 4, "method": "resources/read", "params": {"uri": RESOURCE_URI}}),
            json!({"jsonrpc": "2.0", "id": 5, "method": "resources/read", "params": {"uri": "ui://elsewhere"}}),
            json!({"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": RELAY_TOOL, "arguments": {"method": "GET", "path": "/view/state"}}}),
        ],
    )
    .await;
    assert_eq!(replies[0]["result"]["capabilities"]["resources"], json!({"listChanged": false}));
    assert_eq!(replies[0]["result"]["instructions"], "Fake app");
    let tools = replies[1]["result"]["tools"].as_array().unwrap();
    assert!(tools.iter().any(|tool| tool["name"] == RELAY_TOOL));
    assert_eq!(replies[2]["result"]["resources"][0]["mimeType"], MIME_TYPE);
    assert_eq!(replies[3]["result"]["contents"][0]["text"], "<!doctype html><title>viewer</title>");
    assert_eq!(replies[4]["error"]["code"], RESOURCE_NOT_FOUND);
    assert_eq!(replies[5]["result"]["content"][0]["text"], "relayed");

    // Without the extension, or without the page in this build, the session is as it was: no view, no relay.
    for (host, capabilities) in [(Fake { page: Some("<html>") }, json!({})), (PLAIN, apps)] {
        let replies = exchange(
            host,
            &[
                initialize_with(capabilities),
                json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
                json!({"jsonrpc": "2.0", "id": 3, "method": "resources/read", "params": {"uri": RESOURCE_URI}}),
                json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": RELAY_TOOL, "arguments": {}}}),
            ],
        )
        .await;
        assert!(replies[0]["result"]["capabilities"].get("resources").is_none());
        assert_eq!(replies[1]["result"], tools::list());
        assert_eq!(replies[2]["error"]["code"], METHOD_NOT_FOUND);
        assert_eq!(replies[3]["error"]["code"], INVALID_PARAMS);
    }
}
