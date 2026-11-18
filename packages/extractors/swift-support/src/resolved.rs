//! `Package.resolved`: the version, revision or branch SwiftPM resolved each
//! package to, in the formats SwiftPM 5.5 and earlier (version 1), 5.6 to 5.9
//! (version 2) and 5.10 onward (version 3) write.

use crate::manifest::identity;
use anyhow::{Result, bail};
use projections_extractor_sdk::{array, object, text};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pin {
    pub identity: String,
    /// `remoteSourceControl`, `localSourceControl` or `registry`.
    pub kind: String,
    /// The repository URL or path, or the registry ID.
    pub location: String,
    pub version: Option<String>,
    pub revision: Option<String>,
    pub branch: Option<String>,
}

/// The pins `document` records, sorted by identity.
pub fn read(document: &Value) -> Result<Vec<Pin>> {
    object(document, "Package.resolved")?;
    let mut pins = match document["version"].as_u64() {
        Some(1) => array(&document["object"]["pins"], "Package.resolved object.pins")?
            .iter()
            .map(|pin| {
                let location = text(&pin["repositoryURL"], "pin.repositoryURL")?;
                Ok(Pin {
                    identity: identity(location),
                    kind: "remoteSourceControl".into(),
                    location: location.into(),
                    ..state(&pin["state"])
                })
            })
            .collect::<Result<Vec<_>>>()?,
        Some(2 | 3) => array(&document["pins"], "Package.resolved pins")?
            .iter()
            .map(|pin| {
                Ok(Pin {
                    identity: text(&pin["identity"], "pin.identity")?.into(),
                    kind: text(&pin["kind"], "pin.kind")?.into(),
                    location: text(&pin["location"], "pin.location")?.into(),
                    ..state(&pin["state"])
                })
            })
            .collect::<Result<Vec<_>>>()?,
        _ => bail!("Unsupported Package.resolved version {}; expected 1, 2 or 3", document["version"]),
    };
    pins.sort_by(|a, b| a.identity.cmp(&b.identity));
    Ok(pins)
}

fn state(state: &Value) -> Pin {
    let field = |name: &str| state[name].as_str().filter(|value| !value.is_empty()).map(str::to_owned);
    Pin {
        identity: String::new(),
        kind: String::new(),
        location: String::new(),
        version: field("version"),
        revision: field("revision"),
        branch: field("branch"),
    }
}
