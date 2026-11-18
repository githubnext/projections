//! Reads `Package.swift` without running it: the manifest's literal
//! `Package(…)` initializer, the top-level constants it refers to, and
//! unconditional top-level `+=` and `append` to them. Anything else that
//! decides a value it reads (`#if`, conditions, loops, functions, string
//! interpolation, environment variables) fails, naming the line, rather than
//! being guessed; `swift package dump-package` evaluates such manifests.

mod elements;

use super::{Manifest, Unsupported};
use crate::lexer;
use crate::syntax::{Expr, Program, argument, program};
use std::cell::Cell;
use std::collections::BTreeMap;

/// The package's fields that the graph reads.
const PACKAGE_FIELDS: [&str; 3] = ["products", "dependencies", "targets"];
/// Members whose change, anywhere, changes the graph: a target's dependencies,
/// name or path, or a package's products, dependencies or targets.
const GRAPH_MEMBERS: [&str; 5] = ["dependencies", "targets", "products", "name", "path"];

/// The manifest `source` declares.
pub fn read(source: &str) -> Result<Manifest, Unsupported> {
    let tokens = lexer::tokens(source).map_err(|error| unsupported(None, format!("{error:#}")))?;
    let program = program(&tokens);
    let (name, args) = package(&program)?;
    let env = Env::new(&program, name)?;
    let mut manifest = elements::package(&env, args)?;
    manifest.tools_version = tools_version(source);
    Ok(manifest)
}

pub(super) fn unsupported(line: Option<usize>, message: String) -> Unsupported {
    Unsupported { line, message }
}

/// `// swift-tools-version:5.9` on the first line.
fn tools_version(source: &str) -> Option<String> {
    let first = source.lines().next()?.trim();
    let rest = first.strip_prefix("//")?.trim_start();
    let version = rest.strip_prefix("swift-tools-version")?.trim_start().strip_prefix(':')?;
    let version = version.split(';').next()?.trim();
    (!version.is_empty()).then(|| version.to_owned())
}

/// The binding initialized with `Package(…)`, and its arguments.
fn package(program: &Program) -> Result<(&str, &[crate::syntax::Arg]), Unsupported> {
    for (name, binding) in &program.bindings {
        if let Expr::Call { callee, args, .. } = &binding.value
            && matches!(callee.as_ref(), Expr::Path { implicit: false, names, .. } if names == &["Package"])
        {
            if binding.conditional {
                return Err(unsupported(Some(binding.line), "the package is declared inside `#if`".into()));
            }
            return Ok((name, args));
        }
    }
    Err(unsupported(None, "no top-level `let package = Package(…)` was found".into()))
}

/// The most constant references followed while reading one manifest.
const MAX_EXPANSIONS: usize = 10_000;

/// The manifest's constants, as the package's arguments refer to them.
pub(super) struct Env<'a> {
    program: &'a Program,
    /// What unconditional top-level `+=` and `append` add, with where the
    /// statement ends: a constant is an array value, so an append applies only
    /// to uses after it; the package is an object, so an append to one of its
    /// fields (`package.<field>`) applies wherever it is.
    appended: BTreeMap<String, Vec<(usize, Expr)>>,
    /// Constants other code changes: where each change ends, and its line.
    changed: BTreeMap<String, Vec<(usize, usize)>>,
    /// Constant references followed so far.
    expansions: Cell<usize>,
}

impl<'a> Env<'a> {
    fn new(program: &'a Program, package: &str) -> Result<Self, Unsupported> {
        let mut env = Env {
            program,
            appended: BTreeMap::new(),
            changed: BTreeMap::new(),
            expansions: Cell::new(0),
        };
        for mutation in &program.mutations {
            let path: Vec<&str> = mutation.path.iter().map(String::as_str).collect();
            let line = Some(mutation.line);
            let key = match path.as_slice() {
                [base, field] if *base == package && PACKAGE_FIELDS.contains(field) => format!("package.{field}"),
                [base] if program.bindings.contains_key(*base) => (*base).to_owned(),
                [base, ..] if *base == package && path.len() > 1 && !GRAPH_MEMBERS.contains(&path[1]) => continue,
                [first, .., last] if GRAPH_MEMBERS.contains(last) || *first == package => {
                    return Err(unsupported(line, format!("code changes `{}`", path.join("."))));
                }
                _ => continue,
            };
            match &mutation.appended {
                Some(value) => env.appended.entry(key).or_default().push((mutation.end, value.clone())),
                None if key.starts_with("package.") => {
                    return Err(unsupported(line, format!("code changes `{}`", path.join("."))));
                }
                None => env.changed.entry(key).or_default().push((mutation.end, mutation.line)),
            }
        }
        Ok(env)
    }

    /// A package field's value with what top-level code appends to it.
    pub fn field(&self, field: &str, value: Option<&Expr>) -> Option<Expr> {
        let appended: Vec<Expr> = self
            .appended
            .get(&format!("package.{field}"))
            .into_iter()
            .flatten()
            .map(|(_, value)| value.clone())
            .collect();
        match (value, appended.is_empty()) {
            (None, true) => None,
            (Some(value), true) => Some(value.clone()),
            (value, false) => Some(Expr::Concat(value.cloned().into_iter().chain(appended).collect())),
        }
    }

    /// `expr` with a constant it names replaced by its value.
    pub fn resolve(&self, expr: &Expr) -> Result<Expr, Unsupported> {
        let mut expr = expr.clone();
        for _ in 0..32 {
            let Some(name) = expr.identifier() else {
                return match expr {
                    Expr::Opaque { line, what } => Err(unsupported(Some(line), format!("the manifest uses {what}"))),
                    expr => Ok(expr),
                };
            };
            let line = expr.line();
            // Changes made before this use apply to it; later ones don't.
            let position = expr.position().unwrap_or(usize::MAX);
            self.expansions.set(self.expansions.get() + 1);
            if self.expansions.get() > MAX_EXPANSIONS {
                return Err(unsupported(line, "the manifest's constants expand too far to read".into()));
            }
            let Some(binding) = self.program.bindings.get(name) else {
                return Err(unsupported(line, format!("`{name}` isn't a top-level constant of the manifest")));
            };
            if binding.conditional {
                return Err(unsupported(Some(binding.line), format!("`{name}` is declared inside `#if`")));
            }
            if let Some((_, changed)) = self.changed.get(name).into_iter().flatten().find(|(end, _)| *end <= position) {
                return Err(unsupported(Some(*changed), format!("code changes `{name}`")));
            }
            let appended: Vec<Expr> = self
                .appended
                .get(name)
                .into_iter()
                .flatten()
                .filter(|(end, _)| *end <= position)
                .map(|(_, value)| value.clone())
                .collect();
            expr = if appended.is_empty() {
                binding.value.clone()
            } else {
                Expr::Concat([vec![binding.value.clone()], appended].concat())
            };
        }
        Err(unsupported(expr.line(), "constants refer to each other in a cycle".into()))
    }

    /// The elements of an array literal, concatenation or constant naming one.
    pub fn list(&self, expr: &Expr, what: &str) -> Result<Vec<Expr>, Unsupported> {
        match self.resolve(expr)? {
            Expr::Array(items) => Ok(items),
            Expr::Concat(parts) => parts.iter().try_fold(Vec::new(), |mut all, part| {
                all.extend(self.list(part, what)?);
                Ok(all)
            }),
            other => Err(unsupported(other.line(), format!("{what} isn't an array"))),
        }
    }

    /// A string literal, or a constant naming one.
    pub fn string(&self, expr: &Expr, what: &str) -> Result<String, Unsupported> {
        match self.resolve(expr)? {
            Expr::Str(value) => Ok(value),
            other => Err(unsupported(other.line(), format!("{what} isn't a string literal"))),
        }
    }

    /// The string argument `label`, if present.
    pub fn optional_string(&self, args: &[crate::syntax::Arg], label: &str, what: &str) -> Result<Option<String>, Unsupported> {
        argument(args, label).map(|value| self.string(value, what)).transpose()
    }
}

#[cfg(test)]
mod tests;
