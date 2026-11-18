//! `projections mcp`'s protocol.

use super::*;
use std::time::Duration;

struct Fake;

impl ToolHost for Fake {
    fn instructions(&self) -> String {
        "Fake".to_owned()
    }

    fn tools(&self) -> Value {
        tools::list()
    }

    async fn call(&self, name: String, arguments: Value) -> Result<Value, String> {
        match name.as_str() {
            "explore" => Ok(json!({"content": [{"type": "text", "text": "none"}], "isError": false})),
            "sweep" => std::future::pending().await,
            _ => Err(format!("Unknown tool: {name} {arguments}")),
        }
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
    let session = tokio::spawn(session(Arc::new(Fake), input, output, std::future::pending()));
    let send = |value: Value| frames.send(Frame::Line(value.to_string().into_bytes()));
    send(json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}}))
        .await
        .unwrap();
    let initialized = line(&mut lines).await;
    assert_eq!(initialized["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(initialized["result"]["serverInfo"]["name"], "projections");
    assert!(initialized["result"]["capabilities"]["tools"].is_object());
    assert!(initialized["result"]["capabilities"].get("resources").is_none());
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
