//! Keyword options of a routing call, in order, and how they read.

use projections_extractor_ruby_support::{Call, Expr, Kind};

#[derive(Clone, Debug, Default)]
pub struct Options(pub Vec<(String, Expr)>);

impl Options {
    /// A call's keyword options with literal keys; `None` when a key is computed or a splat passes more.
    pub fn of(call: &Call) -> Option<Self> {
        if call.has_splat() {
            return None;
        }
        call.pairs()
            .map(|(key, value)| Some((key.name()?.to_owned(), value.clone())))
            .collect::<Option<Vec<_>>>()
            .map(Options)
    }

    /// A call's keyword options with literal keys, ignoring any other pairs.
    pub fn named(call: &Call) -> Self {
        Options(
            call.pairs()
                .filter_map(|(key, value)| Some((key.name()?.to_owned(), value.clone())))
                .collect(),
        )
    }

    pub fn get(&self, key: &str) -> Option<&Expr> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn has(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    pub fn take(&mut self, key: &str) -> Option<Expr> {
        let index = self.0.iter().position(|(k, _)| k == key)?;
        Some(self.0.remove(index).1)
    }

    /// A string or symbol option.
    pub fn name(&self, key: &str) -> Option<String> {
        self.get(key).and_then(Expr::name).map(str::to_owned)
    }

    /// A string, symbol or array of them.
    pub fn names(&self, key: &str) -> Option<Vec<String>> {
        self.get(key).and_then(Expr::names)
    }

    /// Whether the option is set to something other than `nil` or `false`.
    pub fn truthy(&self, key: &str) -> bool {
        self.get(key).is_some_and(|v| !matches!(v.kind, Kind::Nil | Kind::Bool(false)))
    }

    /// Whether the option is given as `nil` or `false`.
    pub fn falsy(&self, key: &str) -> bool {
        self.get(key).is_some_and(|v| matches!(v.kind, Kind::Nil | Kind::Bool(false)))
    }

    pub fn without(&self, keys: &[&str]) -> Options {
        Options(self.0.iter().filter(|(k, _)| !keys.contains(&k.as_str())).cloned().collect())
    }

    pub fn only(&self, keys: &[&str]) -> Options {
        Options(self.0.iter().filter(|(k, _)| keys.contains(&k.as_str())).cloned().collect())
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// A requirement or default as written: `id: /\d+/`, `format: :json`.
pub fn pair_text(key: &str, value: &Expr) -> String {
    format!("{key}: {}", value.text)
}

/// The entries of a constraints or defaults option: each pair of a hash, or
/// the whole expression (a lambda or constraint object).
pub fn entries(value: &Expr) -> Vec<String> {
    match &value.kind {
        Kind::Hash(pairs) => pairs.iter().map(|(k, v)| pair_text(k.name().unwrap_or(&k.text), v)).collect(),
        _ => vec![value.text.clone()],
    }
}

/// Options that decide which routes exist and where: they must be literal.
/// Others (requirements, defaults, endpoints) are recorded as written.
const STRUCTURAL: [&str; 16] = [
    "path",
    "as",
    "controller",
    "action",
    "only",
    "except",
    "via",
    "on",
    "module",
    "param",
    "shallow",
    "shallow_path",
    "shallow_prefix",
    "format",
    "concerns",
    "at",
];

/// Whether the arguments that decide `call`'s routes are literal: its
/// positional arguments (unless `computed_positional`) and its structural
/// options. A hash-form path's endpoint (`get "/x" => redirect { ... }`) may be computed.
pub fn literal_arguments(call: &Call, computed_positional: bool) -> bool {
    (computed_positional || call.positional().all(Expr::literal))
        && call.pairs().all(|(key, value)| {
            key.literal() && (value.literal() || key.string().is_some() || key.name().is_some_and(|k| !STRUCTURAL.contains(&k)))
        })
}
