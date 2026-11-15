#[cfg(feature = "editing")]
use super::Site;
use super::model::{Expression, Place, Source, Variable, diagnostic};
use super::{KINDS, identifier};
use crate::{cost, coverage, macros};
use cel::Env;
use projections_engine::{Diagnostic, pointer};
use serde_json::Value;
#[cfg(feature = "editing")]
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::sync::Arc;

/// Reads one rules file; `Err` holds every problem found.
pub(super) struct Reader<'a> {
    pub(super) env: &'a Env,
    /// Whether an expression that doesn't compile stands in as `null`, so an
    /// editor still knows its section and what it can see.
    #[cfg(feature = "editing")]
    pub(super) tolerant: bool,
    #[cfg(feature = "editing")]
    pub(super) sites: Vec<Site>,
    pub(super) source: Source<'a>,
    pub(super) text: Arc<str>,
    pub(super) errors: Vec<Diagnostic>,
    pub(super) warnings: Vec<Diagnostic>,
    pub(super) chains: usize,
    /// The parameters of the function being read, which a `template`
    /// without a map reads by name.
    pub(super) params: Vec<String>,
    /// Collects coverage entries, when the rules are read for coverage.
    pub(super) coverage: Option<coverage::Builder>,
}

impl Reader<'_> {
    pub(super) fn error(&mut self, path: &str, message: &str) {
        self.errors.extend(self.source.invalid(path, message));
    }

    pub(super) fn only(&mut self, value: &Value, allowed: &[&str], path: &str) -> bool {
        let Some(fields) = value.as_object() else {
            self.error(path, "Expected a mapping");
            return false;
        };
        for key in fields.keys() {
            if !allowed.contains(&key.as_str()) {
                self.error(
                    &pointer(path, key),
                    &format!("Unknown field `{key}`; expected one of {}", allowed.join(", ")),
                );
            }
        }
        true
    }

    pub(super) fn compile(&mut self, value: &Value, path: &str) -> Option<Expression> {
        let Some(source) = value.as_str() else {
            self.error(path, "Expected a CEL expression");
            return self.placeholder(path);
        };
        #[cfg(feature = "editing")]
        self.sites.push(Site {
            path: path.to_owned(),
            source: source.to_owned(),
        });
        let location = self.source.location(path);
        match self.env.parser().parse_with_source_info(source) {
            Ok((parsed, mut info)) => {
                let (parsed, expansion) = macros::expand(parsed, &mut info, &self.params);
                let mut next = cost::max_id(&parsed);
                let probed = self.coverage.as_mut().map(|builder| {
                    let site = coverage::Site {
                        path,
                        text: coverage::Text {
                            source,
                            info: &info,
                            position: location.position,
                            file: &self.text,
                        },
                        branches: &expansion.branches,
                    };
                    builder.instrument(&parsed, &site, &mut next)
                });
                let program = Arc::new(cost::instrument(probed.as_ref().unwrap_or(&parsed), &mut next));
                let expression = Expression {
                    source: source.to_owned(),
                    location,
                    parsed,
                    program,
                    info: Arc::new(info),
                    text: self.text.clone(),
                    matches: expansion.matches,
                    branches: expansion.branches,
                };
                for (id, message) in expansion.errors {
                    self.errors.push(expression.at("invalid-rules", id, &message));
                }
                self.chains += expansion.chains.len();
                for (id, length) in expansion.chains {
                    if length < macros::CHAIN_WARNING {
                        continue;
                    }
                    self.warnings.push(expression.at(
                        "chained-conditional",
                        id,
                        &format!(
                            "A chain of {length} conditionals. Prefer `match(subject, {{'key': value, …}}, default)` for a table keyed by one value, `cond({{condition: value, …}}, default)` for ordered conditions, `collect({{condition: value, …}})` for a list of what holds, or a named function"
                        ),
                    ));
                }
                Some(expression)
            }
            Err(errors) => {
                for error in errors.errors {
                    // Positions are 1-based lines and 0-based columns of the expression.
                    let offset = source
                        .split_inclusive('\n')
                        .take((error.pos.0.max(1) - 1) as usize)
                        .map(|line| line.chars().count())
                        .sum::<usize>()
                        + error.pos.1.max(0) as usize;
                    self.errors.push(diagnostic(
                        "invalid-rules",
                        &location,
                        Some((source, offset, &*self.text)),
                        &format!("Invalid CEL: {}", error.msg),
                    ));
                }
                self.placeholder(path)
            }
        }
    }

    #[cfg(not(feature = "editing"))]
    pub(super) fn placeholder(&mut self, _path: &str) -> Option<Expression> {
        None
    }

    /// In tolerant reading, `null` in place of an expression that doesn't
    /// compile.
    #[cfg(feature = "editing")]
    pub(super) fn placeholder(&mut self, path: &str) -> Option<Expression> {
        if !self.tolerant {
            return None;
        }
        let (parsed, info) = self.env.parser().parse_with_source_info("null").ok()?;
        let program = Arc::new(parsed.clone());
        Some(Expression {
            source: "null".to_owned(),
            location: self.source.location(path),
            parsed,
            program,
            info: Arc::new(info),
            text: self.text.clone(),
            matches: Vec::new(),
            branches: BTreeMap::new(),
        })
    }

    pub(super) fn optional(&mut self, value: &Value, key: &str, path: &str) -> Option<Expression> {
        value.get(key).and_then(|expression| self.compile(expression, &pointer(path, key)))
    }

    /// `variables: [{name, expression}]`.
    pub(super) fn variables(&mut self, value: Option<&Value>, path: &str, taken: &mut BTreeSet<String>) -> Vec<Variable> {
        let Some(value) = value else {
            return Vec::new();
        };
        let Some(list) = value.as_array() else {
            self.error(path, "Expected a list of `{name, expression}`");
            return Vec::new();
        };
        let mut variables = Vec::new();
        for (index, variable) in list.iter().enumerate() {
            let path = pointer(path, &index.to_string());
            if !self.only(variable, &["name", "expression", "description", "values"], &path) {
                continue;
            }
            let Some(name) = variable["name"].as_str().filter(|name| identifier(name)) else {
                self.error(&pointer(&path, "name"), "Expected an identifier");
                continue;
            };
            if !taken.insert(name.to_owned()) {
                self.error(&pointer(&path, "name"), &format!("`variables.{name}` is already defined"));
                continue;
            }
            if let Some(expression) = self.compile(&variable["expression"], &pointer(&path, "expression")) {
                let values = self.values(variable.get("values"), &pointer(&path, "values"));
                variables.push(Variable {
                    name: name.to_owned(),
                    expression,
                    values,
                });
            }
        }
        variables
    }

    /// `values: [...]`: the strings or integers a variable or parameter may be.
    pub(super) fn values(&mut self, value: Option<&Value>, path: &str) -> Option<Vec<Value>> {
        let list = value?
            .as_array()
            .filter(|list| !list.is_empty() && list.iter().all(|item| item.is_string() || item.is_i64()));
        if list.is_none() {
            self.error(path, "Expected a nonempty list of strings or integers");
        }
        list.cloned()
    }

    pub(super) fn kind(&mut self, value: &Value, path: &str) -> Option<&'static str> {
        let found = KINDS.into_iter().find(|kind| value == *kind);
        if found.is_none() {
            self.error(path, "Expected remove, restructure or add");
        }
        found
    }

    pub(super) fn place(&mut self, value: Option<&Value>, path: &str) -> Place {
        let Some(text) = value.map(|value| value.as_str()) else {
            return Place::End;
        };
        let place = match text.map(|text| (text, text.split_once(':'))) {
            Some(("start", None)) => Some(Place::Start),
            Some(("end", None)) => Some(Place::End),
            Some((_, Some(("before", kind)))) => KINDS.into_iter().find(|k| *k == kind).map(Place::Before),
            Some((_, Some(("after", kind)))) => KINDS.into_iter().find(|k| *k == kind).map(Place::After),
            _ => None,
        };
        place.unwrap_or_else(|| {
            self.error(path, "Expected start, end, before:<kind> or after:<kind>");
            Place::End
        })
    }
}
