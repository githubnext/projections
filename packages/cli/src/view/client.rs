//! A minimal HTTP/1.1 client for a viewer's control endpoints on loopback, so
//! `projections view …` subcommands and `projections mcp` reach a viewer
//! another process runs. It speaks only to `http://127.0.0.1:PORT/`.

use std::time::Duration;

use anyhow::{Context, Result, bail, ensure};
use serde_json::Value;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::timeout,
};

const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

/// A response: its status, content type and body.
pub struct Response {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
}

impl Response {
    pub fn json(&self) -> Result<Value> {
        serde_json::from_slice(&self.body).context("The viewer answered with invalid JSON")
    }
}

/// The address and path prefix of a viewer URL, `http://127.0.0.1:PORT/TOKEN/`.
fn split(url: &str) -> Result<(String, String)> {
    let rest = url.strip_prefix("http://").context("The viewer URL isn't http")?;
    let (address, path) = rest.split_once('/').context("The viewer URL has no path")?;
    ensure!(address.starts_with("127.0.0.1:"), "The viewer URL isn't on loopback");
    Ok((address.to_owned(), format!("/{path}")))
}

/// Sends one request to `path` under the viewer at `url`, within `limit`.
pub async fn request(url: &str, method: &str, path: &str, body: Option<&Value>, limit: Duration) -> Result<Response> {
    let (address, prefix) = split(url)?;
    let body = body.map(serde_json::to_vec).transpose()?;
    timeout(limit, async {
        let mut stream = TcpStream::connect(&address)
            .await
            .with_context(|| format!("No viewer answers at {address}"))?;
        let mut head =
            format!("{method} {prefix}{path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\nAccept: application/json, image/png\r\n");
        if let Some(body) = &body {
            head.push_str(&format!("Content-Type: application/json\r\nContent-Length: {}\r\n", body.len()));
        } else {
            head.push_str("Content-Length: 0\r\n");
        }
        head.push_str("\r\n");
        // A server that refuses at once may close before reading the body: its answer still counts.
        let mut message = head.into_bytes();
        message.extend(body.iter().flatten());
        let _ = stream.write_all(&message).await;
        let mut bytes = Vec::new();
        (&mut stream)
            .take(MAX_RESPONSE_BYTES as u64 + 64 * 1024)
            .read_to_end(&mut bytes)
            .await?;
        parse(&bytes)
    })
    .await
    .context("The viewer didn't answer in time")?
}

fn parse(bytes: &[u8]) -> Result<Response> {
    let end = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .context("The viewer's answer has no header")?;
    let head = std::str::from_utf8(&bytes[..end]).context("The viewer's header isn't text")?;
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|line| line.split(' ').nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .context("The viewer's answer has no status")?;
    let mut content_type = String::new();
    let mut chunked = false;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let (name, value) = (name.trim().to_ascii_lowercase(), value.trim());
        if name == "content-type" {
            content_type = value.to_owned();
        } else if name == "transfer-encoding" && value.eq_ignore_ascii_case("chunked") {
            chunked = true;
        }
    }
    let raw = &bytes[end + 4..];
    let body = if chunked { dechunk(raw)? } else { raw.to_vec() };
    Ok(Response {
        status,
        content_type,
        body,
    })
}

fn dechunk(mut raw: &[u8]) -> Result<Vec<u8>> {
    let mut body = Vec::new();
    loop {
        let line = raw.windows(2).position(|window| window == b"\r\n").context("A chunk has no size")?;
        let size = std::str::from_utf8(&raw[..line])?.split(';').next().unwrap_or_default().trim();
        let size = usize::from_str_radix(size, 16).context("A chunk's size isn't hexadecimal")?;
        raw = &raw[line + 2..];
        if size == 0 {
            return Ok(body);
        }
        if raw.len() < size + 2 {
            bail!("A chunk is cut short");
        }
        body.extend_from_slice(&raw[..size]);
        raw = &raw[size + 2..];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_must_be_loopback() {
        assert_eq!(
            split("http://127.0.0.1:9/abc/").unwrap(),
            ("127.0.0.1:9".to_owned(), "/abc/".to_owned())
        );
        assert!(split("http://example.com:9/abc/").is_err());
        assert!(split("https://127.0.0.1:9/abc/").is_err());
    }

    #[test]
    fn responses_parse_with_or_without_chunks() {
        let plain = parse(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}").unwrap();
        assert_eq!((plain.status, plain.body.as_slice()), (200, b"{}".as_slice()));
        assert_eq!(plain.content_type, "application/json");
        let chunked = parse(b"HTTP/1.1 404 Not Found\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n").unwrap();
        assert_eq!((chunked.status, chunked.body.as_slice()), (404, b"abcde".as_slice()));
        assert!(parse(b"garbage").is_err());
    }
}
