//! Standard input's lines as protocol frames.

use std::io::{self, BufRead};

/// One line read from standard input, without its newline.
#[derive(Debug, PartialEq)]
pub(crate) enum Frame {
    Line(Vec<u8>),
    /// A line longer than the limit, discarded.
    TooLong,
}

/// Reads the next line of at most `limit` bytes; `None` at the end of input.
/// A final line without a newline is still a line; empty lines are skipped.
pub(crate) fn read_frame(reader: &mut impl BufRead, limit: usize) -> io::Result<Option<Frame>> {
    let mut line = Vec::new();
    let mut overflow = false;
    loop {
        let available = match reader.fill_buf() {
            Ok(available) => available,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        if available.is_empty() {
            return Ok(if overflow {
                Some(Frame::TooLong)
            } else if line.is_empty() {
                None
            } else {
                Some(Frame::Line(line))
            });
        }
        let (taken, end) = match available.iter().position(|byte| *byte == b'\n') {
            Some(index) => (index, true),
            None => (available.len(), false),
        };
        if !overflow {
            if line.len() + taken > limit {
                overflow = true;
                line = Vec::new();
            } else {
                line.extend_from_slice(&available[..taken]);
            }
        }
        reader.consume(taken + usize::from(end));
        if end {
            if overflow {
                return Ok(Some(Frame::TooLong));
            }
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.iter().all(u8::is_ascii_whitespace) {
                line.clear();
                continue;
            }
            return Ok(Some(Frame::Line(line)));
        }
    }
}
