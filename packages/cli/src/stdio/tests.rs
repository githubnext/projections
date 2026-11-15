use super::*;
use axum::{
    body::Body,
    http::{Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use std::time::Duration;

#[test]
fn frames_are_lines_within_the_limit() {
    let mut input = io::Cursor::new(b"{\"a\":1}\r\n\n  \n0123456789ABC\n{}".to_vec());
    let mut reader = io::BufReader::with_capacity(4, &mut input);
    assert_eq!(read_frame(&mut reader, 10).unwrap(), Some(Frame::Line(b"{\"a\":1}".to_vec())));
    assert_eq!(read_frame(&mut reader, 10).unwrap(), Some(Frame::TooLong));
    assert_eq!(read_frame(&mut reader, 10).unwrap(), Some(Frame::Line(b"{}".to_vec())));
    assert_eq!(read_frame(&mut reader, 10).unwrap(), None);
}

#[test]
fn paths_are_server_relative_and_bounded() {
    for path in [
        "/api/definitions?ref=working-tree",
        "/api/sweep/thumbnail?projection=a&before=b&after=c",
        "/renderers/graph/index.html",
        "/custom-renderers/abc/working-tree/x/index.html",
        "/api/pairs?projection=a..b",
        "/inspector/mount.js",
    ] {
        assert!(valid_path(path), "{path}");
    }
    for path in [
        "/index.html",
        "/inspector/../renderers/x",
        "api/definitions",
        "http://example.com/api/x",
        "//example.com/api/x",
        "/api/../index.html",
        "/api/./x",
        "/renderers/..",
        "/api/x#y",
        "/api/x\\y",
        "/api/x\ny",
        "/api/x\u{7f}",
    ] {
        assert!(!valid_path(path), "{path}");
    }
    assert!(!valid_path(&format!("/api/{}", "a".repeat(4096))));
}

#[test]
fn request_params_are_validated() {
    assert!(request_params(&json!({"method": "GET", "path": "/api/revisions"})).is_ok());
    let (method, _, body) = request_params(&json!({"method": "POST", "path": "/api/jobs", "body": {"a": 1}})).unwrap();
    assert_eq!(method, Method::POST);
    assert_eq!(body.unwrap(), br#"{"a":1}"#);
    for params in [
        json!({"method": "PUT", "path": "/api/x"}),
        json!({"method": "GET", "path": "/api/x", "body": {}}),
        json!({"method": "GET", "path": "/index.html"}),
        json!({"method": "GET", "path": "/api/x", "headers": {}}),
        json!(null),
    ] {
        assert!(request_params(&params).is_err(), "{params}");
    }
}

#[tokio::test]
async fn responses_are_json_text_or_base64() {
    let json_response = (
        StatusCode::NOT_FOUND,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        r#"{"diagnostics":[]}"#,
    )
        .into_response();
    assert_eq!(
        encode(json_response).await.unwrap(),
        json!({"status": 404, "contentType": "application/json; charset=utf-8", "body": {"diagnostics": []}})
    );
    let png = ([(header::CONTENT_TYPE, "image/png")], Body::from(vec![1u8, 2, 3])).into_response();
    assert_eq!(encode(png).await.unwrap()["body"], json!({"base64": "AQID"}));
    let html = (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CONTENT_SECURITY_POLICY, "default-src 'none'"),
            (header::ETAG, "\"x\""),
        ],
        "<p>",
    )
        .into_response();
    let html = encode(html).await.unwrap();
    assert_eq!(html["body"], json!("<p>"));
    assert_eq!(html["headers"], json!({"content-security-policy": "default-src 'none'"}));
}

/// Answers `/api/slow` only when cancelled (never), everything else at once.
struct Fake;

impl Backend for Fake {
    fn initialize(&self) -> Value {
        json!({"protocol": PROTOCOL})
    }

    async fn request(&self, _method: Method, path: String, _body: Option<Vec<u8>>) -> Result<Response> {
        if path == "/api/slow" {
            std::future::pending::<()>().await;
        }
        Ok(axum::Json(json!({"path": path})).into_response())
    }

    fn tools(&self) -> Value {
        json!({"tools": [{"name": "echo"}, {"name": "slow"}]})
    }

    async fn call_tool(&self, name: String, arguments: Value) -> Result<Value, String> {
        match name.as_str() {
            "echo" => Ok(json!({"content": [{"type": "text", "text": arguments.to_string()}]})),
            "slow" => std::future::pending().await,
            _ => Err(format!("Unknown tool: {name}")),
        }
    }
}

async fn line(lines: &mut mpsc::Receiver<String>) -> Value {
    let line = tokio::time::timeout(Duration::from_secs(5), lines.recv())
        .await
        .expect("a reply")
        .expect("an open channel");
    assert!(!line.contains('\n'));
    serde_json::from_str(&line).unwrap()
}

#[tokio::test]
async fn requests_run_concurrently_and_can_be_cancelled() {
    let (frames, input) = mpsc::channel(16);
    let (output, mut lines) = mpsc::channel(16);
    let session = tokio::spawn(session(Arc::new(Fake), input, output, std::future::pending()));
    let send = |value: Value| frames.send(Frame::Line(value.to_string().into_bytes()));
    send(json!({"jsonrpc": "2.0", "id": 1, "method": "initialize"})).await.unwrap();
    assert_eq!(line(&mut lines).await["result"]["protocol"], 1);
    send(json!({"jsonrpc": "2.0", "id": "slow", "method": "request", "params": {"method": "GET", "path": "/api/slow"}}))
        .await
        .unwrap();
    send(json!({"jsonrpc": "2.0", "id": 2, "method": "request", "params": {"method": "GET", "path": "/api/fast"}}))
        .await
        .unwrap();
    // The slow request doesn't hold up the next one.
    let fast = line(&mut lines).await;
    assert_eq!(fast["id"], 2);
    assert_eq!(fast["result"]["status"], 200);
    assert_eq!(fast["result"]["body"]["path"], "/api/fast");
    send(json!({"jsonrpc": "2.0", "method": "$/cancelRequest", "params": {"id": "slow"}}))
        .await
        .unwrap();
    let cancelled = line(&mut lines).await;
    assert_eq!(cancelled["id"], "slow");
    assert_eq!(cancelled["error"]["code"], REQUEST_CANCELLED);
    frames.send(Frame::Line(b"not json".to_vec())).await.unwrap();
    assert_eq!(line(&mut lines).await["error"]["code"], PARSE_ERROR);
    frames.send(Frame::TooLong).await.unwrap();
    assert_eq!(line(&mut lines).await["error"]["code"], INVALID_REQUEST);
    send(json!({"jsonrpc": "2.0", "id": 3, "method": "request", "params": {"method": "GET", "path": "/index.html"}}))
        .await
        .unwrap();
    assert_eq!(line(&mut lines).await["error"]["code"], INVALID_PARAMS);
    send(json!({"jsonrpc": "2.0", "id": 4, "method": "nope"})).await.unwrap();
    assert_eq!(line(&mut lines).await["error"]["code"], METHOD_NOT_FOUND);
    // The agent tools: listed, called, refused when unknown, and cancelled like requests.
    send(json!({"jsonrpc": "2.0", "id": 10, "method": "tools/list"})).await.unwrap();
    assert_eq!(line(&mut lines).await["result"]["tools"][0]["name"], "echo");
    send(json!({"jsonrpc": "2.0", "id": "tool", "method": "tools/call", "params": {"name": "slow"}}))
        .await
        .unwrap();
    send(json!({"jsonrpc": "2.0", "id": 11, "method": "tools/call", "params": {"name": "echo", "arguments": {"a": 1}}}))
        .await
        .unwrap();
    let echoed = line(&mut lines).await;
    assert_eq!(echoed["id"], 11);
    assert_eq!(echoed["result"]["content"][0]["text"], r#"{"a":1}"#);
    send(json!({"jsonrpc": "2.0", "id": 12, "method": "tools/call", "params": {"name": "nothing"}}))
        .await
        .unwrap();
    assert_eq!(line(&mut lines).await["error"]["code"], INVALID_PARAMS);
    send(json!({"jsonrpc": "2.0", "id": 13, "method": "tools/call", "params": {"name": "echo", "arguments": [1]}}))
        .await
        .unwrap();
    assert_eq!(line(&mut lines).await["error"]["code"], INVALID_PARAMS);
    send(json!({"jsonrpc": "2.0", "method": "$/cancelRequest", "params": {"id": "tool"}}))
        .await
        .unwrap();
    let cancelled = line(&mut lines).await;
    assert_eq!(cancelled["id"], "tool");
    assert_eq!(cancelled["error"]["code"], REQUEST_CANCELLED);
    send(json!({"jsonrpc": "2.0", "id": 5, "method": "shutdown"})).await.unwrap();
    assert_eq!(line(&mut lines).await["result"], Value::Null);
    send(json!({"jsonrpc": "2.0", "id": 6, "method": "request", "params": {"method": "GET", "path": "/api/fast"}}))
        .await
        .unwrap();
    assert_eq!(line(&mut lines).await["error"]["code"], INVALID_REQUEST);
    send(json!({"jsonrpc": "2.0", "method": "exit"})).await.unwrap();
    assert_eq!(session.await.unwrap(), End::Exit);
}

#[tokio::test]
async fn a_closed_input_ends_the_session_and_aborts_requests() {
    let (frames, input) = mpsc::channel(16);
    let (output, mut lines) = mpsc::channel(16);
    let session = tokio::spawn(session(Arc::new(Fake), input, output, std::future::pending()));
    frames
        .send(Frame::Line(
            json!({"jsonrpc": "2.0", "id": 1, "method": "request", "params": {"method": "GET", "path": "/api/slow"}})
                .to_string()
                .into_bytes(),
        ))
        .await
        .unwrap();
    drop(frames);
    assert_eq!(session.await.unwrap(), End::Closed);
    // The aborted request's task dropped its sender: no reply, and the channel closes.
    assert_eq!(tokio::time::timeout(Duration::from_secs(5), lines.recv()).await.unwrap(), None);
}
