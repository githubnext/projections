//! A minimal WebSocket client for the DevTools port transport.

use std::{
    io::{self, BufRead, BufReader, Read, Write},
    net::TcpStream,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{Context, Result, ensure};
use rand::RngCore;

use super::{
    MAX_MESSAGE_BYTES, base64_encode,
    connection::{Dispatch, parse_message},
};

/// Connects to the browser's WebSocket endpoint on loopback.
pub(super) fn connect_socket((port, path): &(u16, String)) -> Result<(TcpStream, BufReader<TcpStream>)> {
    let stream = TcpStream::connect(("127.0.0.1", *port)).context("Cannot connect to the browser's DevTools port")?;
    stream.set_nodelay(true)?;
    let mut key = [0u8; 16];
    rand::rng().fill_bytes(&mut key);
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {}\r\nSec-WebSocket-Version: 13\r\n\r\n",
        base64_encode(&key)
    );
    (&stream).write_all(request.as_bytes())?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut status = String::new();
    reader.read_line(&mut status)?;
    ensure!(
        status.starts_with("HTTP/1.1 101"),
        "The browser refused the DevTools WebSocket: {}",
        status.trim()
    );
    let mut headers = 0;
    loop {
        let mut line = String::new();
        ensure!(
            reader.read_line(&mut line)? > 0 && headers < 100,
            "Invalid DevTools WebSocket handshake"
        );
        headers += 1;
        if line == "\r\n" {
            break;
        }
    }
    stream.set_read_timeout(None)?;
    Ok((stream, reader))
}

pub(super) fn write_frame(stream: &mut impl Write, opcode: u8, payload: &[u8]) -> io::Result<()> {
    let mut frame = Vec::with_capacity(payload.len() + 14);
    frame.push(0x80 | opcode);
    match payload.len() {
        length if length < 126 => frame.push(0x80 | length as u8),
        length if length <= u16::MAX as usize => {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(length as u16).to_be_bytes());
        }
        length => {
            frame.push(0x80 | 127);
            frame.extend_from_slice(&(length as u64).to_be_bytes());
        }
    }
    let mut mask = [0u8; 4];
    rand::rng().fill_bytes(&mut mask);
    frame.extend_from_slice(&mask);
    frame.extend(payload.iter().enumerate().map(|(index, byte)| byte ^ mask[index % 4]));
    stream.write_all(&frame)
}

/// Reads one WebSocket frame: `(fin, opcode, payload)`.
pub(super) fn read_frame(reader: &mut impl Read, limit: usize) -> io::Result<(bool, u8, Vec<u8>)> {
    let invalid = |message: &str| io::Error::new(io::ErrorKind::InvalidData, message.to_owned());
    let mut header = [0u8; 2];
    reader.read_exact(&mut header)?;
    let length = match header[1] & 0x7f {
        126 => {
            let mut bytes = [0u8; 2];
            reader.read_exact(&mut bytes)?;
            u16::from_be_bytes(bytes) as u64
        }
        127 => {
            let mut bytes = [0u8; 8];
            reader.read_exact(&mut bytes)?;
            u64::from_be_bytes(bytes)
        }
        length => length as u64,
    };
    if length > limit as u64 {
        return Err(invalid("The browser sent an oversized DevTools message"));
    }
    let mask = if header[1] & 0x80 != 0 {
        let mut mask = [0u8; 4];
        reader.read_exact(&mut mask)?;
        Some(mask)
    } else {
        None
    };
    let mut payload = vec![0u8; length as usize];
    reader.read_exact(&mut payload)?;
    if let Some(mask) = mask {
        for (index, byte) in payload.iter_mut().enumerate() {
            *byte ^= mask[index % 4];
        }
    }
    Ok((header[0] & 0x80 != 0, header[0] & 0x0f, payload))
}

pub(super) fn read_socket(mut reader: BufReader<TcpStream>, writer: Arc<Mutex<TcpStream>>, dispatch: Dispatch) {
    let mut message = Vec::new();
    loop {
        let (fin, opcode, payload) = match read_frame(&mut reader, MAX_MESSAGE_BYTES - message.len()) {
            Ok(frame) => frame,
            Err(error) => {
                if error.kind() == io::ErrorKind::InvalidData {
                    let _ = dispatch.sender.send(Err(error.to_string()));
                }
                return;
            }
        };
        match opcode {
            0x0..=0x2 => {
                message.extend_from_slice(&payload);
                if fin {
                    let complete = std::mem::take(&mut message);
                    if !dispatch.deliver(parse_message(&complete)) {
                        return;
                    }
                }
            }
            0x8 => return,
            0x9 => {
                let mut stream = writer.lock().unwrap_or_else(|error| error.into_inner());
                if write_frame(&mut *stream, 0xA, &payload).is_err() {
                    return;
                }
            }
            _ => {}
        }
    }
}
