//! The viewer's address, kept per project: the port it last listened on and its session token, so a viewer that
//! restarts (after `projections view stop`, its idle exit or a reboot) serves the same URL and a person's bookmark,
//! open tab or app pane finds it again. It lives beside the record in the per-user cache (`views/<key>.address.json`,
//! owner-only in an owner-only directory), never in the repository. `projections view stop --rotate` forgets it, so
//! the next viewer has a new token and every earlier link stops working.

use std::path::{Path, PathBuf};

use anyhow::Result;
use rand::RngCore;
use serde_json::{Value, json};

/// Where a project's viewer listens, and the token every path starts with.
#[derive(Clone, Debug, PartialEq)]
pub struct Address {
    /// 0 for any free port.
    pub port: u16,
    pub token: String,
}

impl Address {
    fn json(&self) -> Value {
        json!({"format": "projections.viewer-address", "version": 1, "port": self.port, "token": self.token})
    }

    fn parse(value: &Value) -> Option<Self> {
        if value["format"] != "projections.viewer-address" || value["version"] != 1 {
            return None;
        }
        let token = value["token"].as_str().filter(|token| valid_token(token))?.to_owned();
        Some(Self {
            port: u16::try_from(value["port"].as_u64()?).ok()?,
            token,
        })
    }
}

/// A new random session token: 256 bits, as 64 lowercase hex digits.
pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Whether `token` is one [`new_token`] makes: anything else in the file is ignored, and a new one is made.
fn valid_token(token: &str) -> bool {
    token.len() == 64 && token.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// The address file of the project `project` of the repository at `root`, under `base`.
pub fn path_in(base: &Path, root: &Path, project: &str) -> PathBuf {
    base.join("views")
        .join(format!("{}.address.json", super::registry::key(root, project)))
}

fn path(root: &Path) -> Result<PathBuf> {
    Ok(path_in(&crate::cache::base()?, root, crate::project::prefix()))
}

/// The address kept for `root`, when there is one that only this user can read.
pub fn read(root: &Path) -> Option<Address> {
    let file = path(root).ok()?;
    if !private_file(&file) {
        return None;
    }
    Address::parse(&serde_json::from_slice(&std::fs::read(file).ok()?).ok()?)
}

/// Keeps `address` for `root`, replacing any earlier one.
pub fn write(root: &Path, address: &Address) -> Result<()> {
    super::registry::write_private(&path(root)?, &address.json())
}

/// Forgets the address kept for `root`; whether there was one.
pub fn forget(root: &Path) -> bool {
    path(root).is_ok_and(|file| std::fs::remove_file(file).is_ok())
}

/// Whether `file` is a regular file (not a link) that only the current user can read or write: a token another user
/// could read or plant is never used.
fn private_file(file: &Path) -> bool {
    let Ok(metadata) = std::fs::symlink_metadata(file) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        metadata.uid() == unsafe { libc::geteuid() } && metadata.mode() & 0o077 == 0
    }
    // Windows per-user directories such as %LOCALAPPDATA% are private by their ACLs.
    #[cfg(not(unix))]
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_round_trip_and_reject_other_documents() {
        let address = Address {
            port: 4100,
            token: new_token(),
        };
        assert_eq!(Address::parse(&address.json()), Some(address.clone()));
        for token in ["", "ab12", &"A".repeat(64), &"0".repeat(63), "../x"] {
            let mut value = address.json();
            value["token"] = json!(token);
            assert_eq!(Address::parse(&value), None, "{token}");
        }
        let mut value = address.json();
        value["port"] = json!(70000);
        assert_eq!(Address::parse(&value), None);
        assert_eq!(Address::parse(&json!({"format": "projections.viewer"})), None);
    }

    #[test]
    fn each_project_keeps_its_own_address_beside_its_record() {
        let base = Path::new("/cache");
        let root = Path::new("/src/a");
        let address = path_in(base, root, "");
        assert_ne!(address, path_in(base, root, "sub"));
        assert_eq!(address.parent(), super::super::registry::path_in(base, root, "").parent());
        assert_ne!(address, super::super::registry::path_in(base, root, ""));
    }

    #[cfg(unix)]
    #[test]
    fn only_an_owner_only_file_is_read() {
        use std::os::unix::fs::PermissionsExt;
        let directory = std::env::temp_dir().join(format!("viewer-address-{}", new_token()));
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("a.address.json");
        crate::create_file(&file, b"{}").unwrap();
        assert!(private_file(&file));
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!private_file(&file), "another user could read the token");
        let link = directory.join("link.json");
        std::os::unix::fs::symlink(&file, &link).unwrap();
        assert!(!private_file(&link));
        let _ = std::fs::remove_dir_all(directory);
    }
}
