use super::INTERPRETER_SECTION;
use sha2::{Digest, Sha256};

/// Content identity of a module (or any bytes): `sha256:<lowercase hex>`.
pub fn digest(bytes: &[u8]) -> String {
    let hash = Sha256::digest(bytes);
    let mut text = String::with_capacity(7 + hash.len() * 2);
    text.push_str("sha256:");
    for byte in hash {
        text.push(char::from_digit(u32::from(byte >> 4), 16).unwrap());
        text.push(char::from_digit(u32::from(byte & 0xf), 16).unwrap());
    }
    text
}

/// A rules interpreter's identity: the `sha256:<hex>` digest of its source
/// that its build embeds in a [`INTERPRETER_SECTION`] custom section, so
/// builds of the same source on different hosts, whose bytes differ, are the
/// same interpreter; otherwise the digest of its bytes.
pub fn interpreter_digest(bytes: &[u8]) -> String {
    fn leb(bytes: &[u8], at: &mut usize) -> Option<usize> {
        let mut value = 0usize;
        for shift in (0..35).step_by(7) {
            let byte = *bytes.get(*at)?;
            *at += 1;
            value |= usize::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Some(value);
            }
        }
        None
    }
    let mut at = 8;
    while at < bytes.len() {
        let id = bytes[at];
        at += 1;
        let Some(size) = leb(bytes, &mut at) else {
            break;
        };
        let end = at.saturating_add(size).min(bytes.len());
        if id == 0 {
            let mut name_at = at;
            if let Some(length) = leb(bytes, &mut name_at) {
                let name_end = name_at.saturating_add(length);
                if bytes.get(name_at..name_end) == Some(INTERPRETER_SECTION.as_bytes()) {
                    let payload = &bytes[name_end.min(end)..end];
                    if let Ok(text) = std::str::from_utf8(payload) {
                        let hex = text.strip_prefix("sha256:").unwrap_or_default();
                        if hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
                            return text.to_owned();
                        }
                    }
                }
            }
        }
        at = end;
    }
    digest(bytes)
}

/// A rules comparator's identity: `sha256:` over
/// `projections-rules-comparator\n`, the rules interpreter's identity
/// ([`interpreter_digest`]),
/// `\n` and the rules file's canonical form (RFC 8785 JSON of its parsed
/// value), so comments and layout don't change it.
pub fn rules_digest(interpreter: &str, canonical: &str) -> String {
    let mut bytes = b"projections-rules-comparator\n".to_vec();
    bytes.extend_from_slice(interpreter.as_bytes());
    bytes.push(b'\n');
    bytes.extend_from_slice(canonical.as_bytes());
    digest(&bytes)
}
