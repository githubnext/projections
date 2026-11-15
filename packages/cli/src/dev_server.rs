//! Renderer development servers: a renderer package running `vite` with the
//! renderer SDK's configuration records its URL in
//! `node_modules/.projections/renderer-dev-server.json`. The Inspector then
//! loads the renderer from it, with hot updates, instead of its built bundle,
//! for as long as it answers as the same renderer.

use serde_json::Value;
use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::Path,
    time::Duration,
};

/// The record a running development server writes, relative to its package.
pub const RECORD: &str = "node_modules/.projections/renderer-dev-server.json";
const TIMEOUT: Duration = Duration::from_millis(300);

/// A loopback `http://host:port/` URL, as `(host, port)`.
fn loopback(url: &str) -> Option<(&str, u16)> {
    let rest = url.strip_prefix("http://")?.strip_suffix('/')?;
    let (host, port) = rest.rsplit_once(':')?;
    let port = port.parse().ok()?;
    ["localhost", "127.0.0.1"].contains(&host).then_some((host, port))
}

/// Asks the server which renderer it serves: its `renderer.json` manifest.
fn served_manifest(host: &str, port: u16) -> Option<Value> {
    let address = (host, port).to_socket_addrs().ok()?.find(|address| address.ip().is_loopback())?;
    let mut stream = TcpStream::connect_timeout(&address, TIMEOUT).ok()?;
    stream.set_read_timeout(Some(TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(TIMEOUT)).ok()?;
    write!(
        stream,
        "GET /__projections/renderer.json HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
    )
    .ok()?;
    let mut response = Vec::new();
    stream.take(64 * 1024).read_to_end(&mut response).ok()?;
    let response = String::from_utf8(response).ok()?;
    let (head, body) = response.split_once("\r\n\r\n")?;
    head.starts_with("HTTP/1.1 200").then_some(())?;
    crate::fixtures::renderer_manifest(&serde_json::from_str(body.trim()).ok()?).ok()
}

/// The URL and manifest of the development server running for the renderer
/// package `package`, if one is recorded there and answers as the renderer it
/// recorded.
pub fn find(package: &Path) -> Option<(String, Value)> {
    let record = package.join(RECORD);
    let metadata = std::fs::symlink_metadata(&record).ok()?;
    if !metadata.is_file() || metadata.len() > 4096 {
        return None;
    }
    let value: Value = serde_json::from_slice(&std::fs::read(&record).ok()?).ok()?;
    if value["format"] != "projections.renderer-dev-server" || value["version"] != 0 {
        return None;
    }
    let url = value["url"].as_str()?;
    let (host, port) = loopback(url)?;
    let manifest = served_manifest(host, port)?;
    (manifest["name"] == value["name"]).then(|| (url.to_owned(), manifest))
}

/// The renderer package a definition's custom bundle is built from: the
/// bundle's parent directory, when the bundle is its `dist` and it has a
/// `package.json`.
pub fn package(root: &Path, definition: &Value) -> Option<std::path::PathBuf> {
    let bundle = crate::project::renderer_bundle(definition).ok()??;
    let bundle = Path::new(&bundle);
    if bundle.file_name()? != "dist" {
        return None;
    }
    let package = root.join(bundle.parent()?);
    package.join("package.json").is_file().then_some(package)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_loopback_http_urls_are_used() {
        assert_eq!(loopback("http://localhost:5173/"), Some(("localhost", 5173)));
        assert_eq!(loopback("http://[::1]:80/"), None, "CSP can't name IPv6 hosts");
        assert_eq!(loopback("http://example.com:5173/"), None);
        assert_eq!(loopback("https://localhost:5173/"), None);
        assert_eq!(loopback("http://localhost:5173/path/"), None);
    }
}
