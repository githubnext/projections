//! Generated values: the basis an extractor records beside a value it
//! generated (a summary a language model wrote, say), and the generation
//! store's snapshot the runner hands it, so an equal basis reuses the earlier
//! value byte for byte. See `docs/design/generated-values.md`.

use anyhow::{Result, ensure};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};

/// The most named parts one basis may have.
pub const MAX_BASIS_PARTS: usize = projections_engine::volatility::MAX_BASIS_PARTS;
/// The longest value of one basis part, in UTF-8 bytes.
pub const MAX_BASIS_PART_BYTES: usize = projections_engine::volatility::MAX_BASIS_PART_BYTES;

/// `sha256:` and the lowercase hex SHA-256 of `text`'s UTF-8 bytes.
pub fn sha256(text: &str) -> String {
    projections_engine::volatility::sha256(text.as_bytes())
}

/// What a generated value was generated from: named parts, each a hash or a
/// short verbatim string such as a model ID.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Basis(BTreeMap<String, String>);

fn part_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && name.len() <= 64
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

impl Basis {
    pub fn new() -> Self {
        Self::default()
    }

    fn insert(mut self, name: &str, value: String) -> Result<Self> {
        ensure!(
            part_name(name),
            "Basis part {name:?}: a letter, then up to 63 letters, digits, _ or -"
        );
        ensure!(
            self.0.len() < MAX_BASIS_PARTS || self.0.contains_key(name),
            "A basis has at most {MAX_BASIS_PARTS} parts"
        );
        self.0.insert(name.to_owned(), value);
        Ok(self)
    }

    /// Adds a part hashed from `text`, such as the source the model read or
    /// the prompt.
    pub fn hash(self, name: &str, text: &str) -> Result<Self> {
        self.insert(name, sha256(text))
    }

    /// Adds a part hashed from a JSON value's canonical form.
    pub fn hash_json(self, name: &str, value: &Value) -> Result<Self> {
        let canonical = projections_engine::canonical(value).map_err(|failure| anyhow::anyhow!("{}", failure[0].message))?;
        self.insert(name, sha256(&canonical))
    }

    /// Adds a part kept as written, such as a pinned model ID.
    pub fn keep(self, name: &str, value: &str) -> Result<Self> {
        ensure!(
            !value.is_empty() && value.len() <= MAX_BASIS_PART_BYTES,
            "Basis part {name} must be a nonempty string of at most {MAX_BASIS_PART_BYTES} bytes"
        );
        self.insert(name, value.to_owned())
    }

    /// The basis as the extraction records it.
    pub fn to_value(&self) -> Value {
        Value::Object(
            self.0
                .iter()
                .map(|(name, value)| (name.clone(), Value::String(value.clone())))
                .collect::<Map<_, _>>(),
        )
    }

    /// The basis digest: `sha256:` over its canonical JSON.
    pub fn digest(&self) -> String {
        basis_digest(&self.to_value())
    }
}

/// A basis value's digest: `sha256:` over its RFC 8785 canonical JSON.
pub fn basis_digest(basis: &Value) -> String {
    projections_engine::volatility::basis_digest(basis).expect("a basis is plain JSON")
}

/// Earlier generated values, by declared path and basis digest.
#[derive(Debug, Clone, Default)]
pub struct Generations {
    values: HashMap<(String, String), Value>,
}

impl Generations {
    /// Reads a snapshot: JSON Lines of `{path, basis, value}`. Lines that
    /// aren't entries are skipped, so a damaged line only regenerates a value.
    pub fn parse(text: &str) -> Self {
        let mut values = HashMap::new();
        for line in text.lines().filter(|line| !line.trim().is_empty()) {
            let Ok(entry) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if let (Some(path), Some(basis), Some(value)) = (entry["path"].as_str(), entry["basis"].as_str(), entry.get("value")) {
                values.insert((path.to_owned(), basis.to_owned()), value.clone());
            }
        }
        Self { values }
    }

    /// How many values the snapshot holds.
    pub fn len(&self) -> usize {
        self.values.len()
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// The stored value for a declaration's `path` (its pattern) and a basis.
    pub fn get(&self, path: &str, basis: &Basis) -> Option<&Value> {
        self.values.get(&(path.to_owned(), basis.digest()))
    }

    /// The stored value when there is one; otherwise `produce`'s.
    pub fn generate(&self, path: &str, basis: &Basis, produce: impl FnOnce() -> Result<Value>) -> Result<Value> {
        match self.get(path, basis) {
            Some(value) => Ok(value.clone()),
            None => produce(),
        }
    }
}
