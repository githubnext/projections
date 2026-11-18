//! The `Package(…)` initializer's products, dependencies and targets.

use super::{Env, unsupported};
use crate::manifest::Unsupported;
use crate::manifest::{Dependency, Manifest, Product, Requirement, Source, identity};
use crate::syntax::{Arg, Expr, argument};

pub(super) fn package(env: &Env, args: &[Arg]) -> Result<Manifest, Unsupported> {
    let name = argument(args, "name").ok_or_else(|| unsupported(None, "the package has no `name`".into()))?;
    Ok(Manifest {
        name: env.string(name, "the package's `name`")?,
        tools_version: None,
        products: each(env, args, "products", product)?,
        dependencies: each(env, args, "dependencies", dependency)?,
        targets: each(env, args, "targets", target)?,
    })
}

/// Each element of the package's `field`, read by `read`.
fn each<T>(env: &Env, args: &[Arg], field: &str, read: fn(&Env, &Expr) -> Result<T, Unsupported>) -> Result<Vec<T>, Unsupported> {
    let Some(value) = env.field(field, argument(args, field)) else {
        return Ok(Vec::new());
    };
    env.list(&value, &format!("`{field}`"))?
        .iter()
        .map(|item| read(env, item))
        .collect()
}

/// An element that must be an implicit member call (`.target(…)`): its name and arguments.
fn call(env: &Env, expr: &Expr, what: &str) -> Result<(String, Vec<Arg>), Unsupported> {
    let resolved = env.resolve(expr)?;
    match resolved.member_call() {
        Some((name, args)) => Ok((name.to_owned(), args.to_vec())),
        None => Err(unsupported(
            resolved.line(),
            format!("{what} isn't a `.{what}(…)` call this reader knows"),
        )),
    }
}

fn required(env: &Env, args: &[Arg], label: &str, what: &str) -> Result<String, Unsupported> {
    let value = argument(args, label).ok_or_else(|| unsupported(None, format!("{what} has no `{label}`")))?;
    env.string(value, &format!("{what}'s `{label}`"))
}

fn names(env: &Env, args: &[Arg], label: &str, what: &str) -> Result<Vec<String>, Unsupported> {
    let Some(value) = argument(args, label) else {
        return Ok(Vec::new());
    };
    env.list(value, what)?.iter().map(|item| env.string(item, what)).collect()
}

fn product(env: &Env, expr: &Expr) -> Result<Product, Unsupported> {
    let (kind, args) = call(env, expr, "product")?;
    if !matches!(kind.as_str(), "library" | "executable" | "plugin") {
        return Err(unsupported(expr.line(), format!("`.{kind}` isn't a product this reader knows")));
    }
    let name = required(env, &args, "name", "a product")?;
    let linkage = match (kind.as_str(), argument(&args, "type")) {
        ("library", None) => Some("automatic".to_owned()),
        ("library", Some(linkage)) => Some(member(env, linkage, "a library's `type`")?),
        _ => None,
    };
    let targets = names(env, &args, "targets", &format!("product `{name}`'s `targets`"))?;
    Ok(Product {
        name,
        kind,
        linkage,
        targets,
    })
}

/// An implicit member (`.dynamic`, `.linux`), lowercased as SwiftPM writes it.
fn member(env: &Env, expr: &Expr, what: &str) -> Result<String, Unsupported> {
    match env.resolve(expr)? {
        Expr::Path { implicit: true, names, .. } if names.len() == 1 => Ok(names[0].to_lowercase()),
        other => Err(unsupported(other.line(), format!("{what} isn't a member such as `.name`"))),
    }
}

fn dependency(env: &Env, expr: &Expr) -> Result<Dependency, Unsupported> {
    let (kind, args) = call(env, expr, "package")?;
    if kind != "package" {
        return Err(unsupported(
            expr.line(),
            format!("`.{kind}` isn't a package dependency this reader knows"),
        ));
    }
    let name = env.optional_string(&args, "name", "a package's `name`")?;
    let (source, identity) = if let Some(url) = env.optional_string(&args, "url", "a package's `url`")? {
        (Source::Repository(url.clone()), identity(&url))
    } else if let Some(path) = env.optional_string(&args, "path", "a package's `path`")? {
        (Source::Local(normalized(&path)), identity(&path))
    } else if let Some(id) = env.optional_string(&args, "id", "a package's `id`")? {
        (Source::Registry(id.clone()), id.to_lowercase())
    } else {
        return Err(unsupported(expr.line(), "a package dependency has no `url`, `path` or `id`".into()));
    };
    let requirement = match source {
        Source::Local(_) => Requirement::Local,
        _ => requirement(env, &args, expr)?,
    };
    Ok(Dependency {
        identity,
        name,
        source,
        requirement,
    })
}

/// A relative path with `.` segments and redundant separators removed.
fn normalized(path: &str) -> String {
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty() && *part != ".").collect();
    let joined = parts.join("/");
    if path.starts_with('/') { format!("/{joined}") } else { joined }
}

fn requirement(env: &Env, args: &[Arg], expr: &Expr) -> Result<Requirement, Unsupported> {
    let invalid = |error: anyhow::Error| unsupported(expr.line(), format!("{error:#}"));
    for (label, read) in [
        ("from", Requirement::up_to_next_major as fn(&str) -> anyhow::Result<Requirement>),
        ("exact", Requirement::exact),
    ] {
        if let Some(value) = argument(args, label) {
            return read(&version(env, value)?).map_err(invalid);
        }
    }
    if let Some(branch) = env.optional_string(args, "branch", "a package's `branch`")? {
        return Ok(Requirement::Branch(branch));
    }
    if let Some(revision) = env.optional_string(args, "revision", "a package's `revision`")? {
        return Ok(Requirement::Revision(revision));
    }
    let Some(unlabeled) = args.iter().find(|arg| arg.label.is_none()) else {
        return Err(unsupported(expr.line(), "a package dependency has no version requirement".into()));
    };
    match env.resolve(&unlabeled.value)? {
        Expr::Range { lower, upper, closed } => {
            let (lower, upper) = (version(env, &lower)?, version(env, &upper)?);
            if closed {
                Requirement::closed(&lower, &upper)
            } else {
                Requirement::half_open(&lower, &upper)
            }
            .map_err(invalid)
        }
        value => named_requirement(env, &value).map_err(|error| match error {
            Some(error) => error,
            None => unsupported(value.line(), "a package's version requirement isn't one this reader knows".into()),
        }),
    }
}

/// `.upToNextMajor(from:)`, `.upToNextMinor(from:)`, `.exact(_)`, `.branch(_)` or `.revision(_)`.
fn named_requirement(env: &Env, value: &Expr) -> Result<Requirement, Option<Unsupported>> {
    let (name, args) = value.member_call().ok_or(None)?;
    let first = args.first().map(|arg| &arg.value).ok_or(None)?;
    let invalid = |error: anyhow::Error| Some(unsupported(value.line(), format!("{error:#}")));
    match name {
        "upToNextMajor" => Requirement::up_to_next_major(&version(env, first).map_err(Some)?).map_err(invalid),
        "upToNextMinor" => Requirement::up_to_next_minor(&version(env, first).map_err(Some)?).map_err(invalid),
        "exact" => Requirement::exact(&version(env, first).map_err(Some)?).map_err(invalid),
        "branch" => Ok(Requirement::Branch(env.string(first, "a branch").map_err(Some)?)),
        "revision" => Ok(Requirement::Revision(env.string(first, "a revision").map_err(Some)?)),
        _ => Err(None),
    }
}

/// A version: a string literal, or `Version(major, minor, patch)`.
fn version(env: &Env, expr: &Expr) -> Result<String, Unsupported> {
    match env.resolve(expr)? {
        Expr::Str(value) => Ok(value),
        Expr::Call { callee, args, line } if matches!(callee.as_ref(), Expr::Path { implicit: false, names, .. } if names == &["Version"]) =>
        {
            let parts: Option<Vec<String>> = args
                .iter()
                .map(|arg| match &arg.value {
                    Expr::Number(number) if arg.label.is_none() => Some(number.clone()),
                    _ => None,
                })
                .collect();
            parts
                .filter(|parts| parts.len() == 3)
                .map(|parts| parts.join("."))
                .ok_or_else(|| unsupported(Some(line), "a `Version(…)` isn't three numbers".into()))
        }
        other => Err(unsupported(other.line(), "a version isn't a string literal".into())),
    }
}

mod targets;
use targets::target;
